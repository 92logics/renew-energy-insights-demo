/* Demo by 92 Logics. In-browser MOCK of an MQTT ingestion path.
   It mimics the shape of the production design described in README.md / docs/architecture.md
   (meter gateway -> AWS IoT Core MQTT topic -> IoT Rule -> Lambda validate/enrich -> Timestream/S3
   -> API Gateway/WebSocket). Nothing here connects to a real broker or to AWS. */
'use strict';
(function () {
  // Minimal MQTT-style topic matcher: supports '+' (single level) and '#' (multi level).
  function topicMatches(filter, topic) {
    const f = filter.split('/'), t = topic.split('/');
    for (let i = 0; i < f.length; i++) {
      if (f[i] === '#') return true;
      if (i >= t.length) return false;
      if (f[i] !== '+' && f[i] !== t[i]) return false;
    }
    return f.length === t.length;
  }

  class MockBroker {
    constructor() { this.subs = []; this.stats = { published: 0, delivered: 0 }; }
    subscribe(filter, qos, handler) { const s = { filter, qos, handler }; this.subs.push(s); return () => { this.subs = this.subs.filter(x => x !== s); }; }
    publish(topic, payload, opts = {}) {
      this.stats.published++;
      for (const s of this.subs) if (topicMatches(s.filter, topic)) { this.stats.delivered++; s.handler(topic, payload, { qos: Math.min(s.qos, opts.qos ?? 0), dup: !!opts.dup }); }
    }
  }

  // Schema for a meter reading message (JSON payload on ei/{tenant}/meters/{meterId}/readings).
  function validate(msg) {
    const errs = [];
    if (typeof msg !== 'object' || msg === null) return ['payload is not a JSON object'];
    if (!/^[A-Z]{2}-\d{4}$/.test(msg.meterId || '')) errs.push('meterId missing/invalid');
    if (typeof msg.ts !== 'string' || isNaN(Date.parse(msg.ts))) errs.push('ts not ISO-8601');
    if (typeof msg.importKwh !== 'number' || msg.importKwh < 0 || msg.importKwh > 25) errs.push('importKwh out of range 0..25');
    if (typeof msg.seq !== 'number') errs.push('seq missing');
    return errs;
  }

  /* Pipeline stages (each would be its own Lambda / step in production):
     validate -> dedupe (idempotency on meterId+seq) -> tenant isolation check -> enrich (tariff band + price + carbon)
     -> store (time-series) -> aggregate (rolling KPIs) -> push to subscribed dashboards. */
  class Pipeline {
    constructor(broker, D, getTenant) {
      this.D = D; this.getTenant = getTenant; this.seen = new Set();
      this.store = []; this.rejected = []; this.log = [];
      this.metrics = { accepted: 0, rejected: 0, duplicates: 0, crossTenantBlocked: 0, latencyMs: [] };
      this.listeners = [];
      broker.subscribe('ei/+/meters/+/readings', 1, (topic, raw, meta) => this.ingest(topic, raw, meta));
    }
    onChange(fn) { this.listeners.push(fn); }
    emit(ev) { this.log.unshift(ev); this.log.length = Math.min(this.log.length, 60); this.listeners.forEach(f => f(ev)); }
    ingest(topic, raw, meta) {
      const t0 = performance.now();
      const [, tenantId, , meterId] = topic.split('/');
      let msg; try { msg = JSON.parse(raw); } catch { msg = null; }
      const errs = msg ? validate(msg) : ['payload is not valid JSON'];
      if (errs.length) { this.metrics.rejected++; this.rejected.unshift({ topic, raw, errs }); return this.emit({ kind: 'rejected', topic, errs }); }
      if (msg.meterId !== meterId || msg.tenant !== tenantId) { this.metrics.crossTenantBlocked++; return this.emit({ kind: 'blocked', topic, errs: ['topic/payload tenant or meter mismatch (isolation policy)'] }); }
      const key = meterId + ':' + msg.seq;
      if (this.seen.has(key)) { this.metrics.duplicates++; return this.emit({ kind: 'duplicate', topic, errs: ['duplicate seq (QoS1 redelivery) dropped idempotently'] }); }
      this.seen.add(key);
      const tenant = this.D.RETAILERS[tenantId];
      const slot = msg.slot;
      const band = this.D.bandFor(tenant.tariff, slot);
      const enriched = { ...msg, band: band.id, rate: band.rate, costEur: +(msg.importKwh * band.rate).toFixed(4), gCO2: Math.round(msg.importKwh * this.D.MARKET.carbon[this.D.DAYS - 1][slot]) };
      this.store.push(enriched); if (this.store.length > 2000) this.store.shift();
      this.metrics.accepted++;
      this.metrics.latencyMs.push(performance.now() - t0); if (this.metrics.latencyMs.length > 200) this.metrics.latencyMs.shift();
      this.emit({ kind: 'accepted', topic, msg: enriched, qos: meta.qos });
    }
  }

  // Simulated fleet of meter gateways publishing accelerated-time readings.
  class MeterFleet {
    constructor(broker, D) { this.broker = broker; this.D = D; this.timer = null; this.slot = 0; this.seq = {}; this.faults = true; }
    start(tenantIds, intervalMs = 700) {
      this.stop();
      this.timer = setInterval(() => this.tick(tenantIds), intervalMs);
    }
    stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
    running() { return !!this.timer; }
    tick(tenantIds) {
      const D = this.D; const day = D.DAYS - 1; const s = this.slot;
      for (const t of tenantIds) for (const hh of D.HOUSEHOLDS[t]) {
        const kwh = (this._cache ||= {})[hh.id] ||= D.simulateMeter(hh);
        const seq = (this.seq[hh.id] = (this.seq[hh.id] || 0) + 1);
        const msg = { tenant: t, meterId: hh.id, seq, slot: s, ts: new Date(D.DEMO_END.getTime() + s * 1800e3).toISOString(), importKwh: kwh[day].kwh[s], unit: 'kWh/30min', fw: 'sim-1.4' };
        const topic = `ei/${t}/meters/${hh.id}/readings`;
        this.broker.publish(topic, JSON.stringify(msg), { qos: 1 });
        if (this.faults) {
          const r = Math.random();
          if (r < 0.04) this.broker.publish(topic, JSON.stringify(msg), { qos: 1, dup: true });                 // QoS1 redelivery
          else if (r < 0.06) this.broker.publish(topic, JSON.stringify({ ...msg, seq: seq + 1e6, importKwh: -3 }), { qos: 1 }); // bad reading
          else if (r < 0.07) this.broker.publish(topic, '{"meterId": "BROKEN', { qos: 1 });                  // corrupt payload
        }
      }
      this.slot = (s + 1) % D.SLOTS;
    }
  }

  window.RENEW_MQTT = { topicMatches, MockBroker, Pipeline, MeterFleet, validate };
})();
