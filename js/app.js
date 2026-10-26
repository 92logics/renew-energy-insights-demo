/* Demo by 92 Logics — Energy Insights white-label PWA. Fictional, simulated data only. */
'use strict';
(function () {
  const D = window.RENEW_DATA, M = window.RENEW_ML, Q = window.RENEW_MQTT, API = window.RENEW_API, I18N = window.RENEW_I18N;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = v => '€' + v.toFixed(2);

  // ---- state (tenant overrides persisted per tenant: isolation by key prefix) ----
  const state = { tenant: 'brightwatt', hh: null, lang: null, view: 'home', dynamic: false, meterCache: {} };
  const overridesKey = t => 'renew-demo:tenant:' + t;
  function tenantCfg(id) {
    const base = D.RETAILERS[id];
    let o = {}; try { o = JSON.parse(localStorage.getItem(overridesKey(id)) || '{}'); } catch {}
    const cfg = JSON.parse(JSON.stringify(base));
    if (o.primary) cfg.theme.primary = o.primary;
    if (o.rates) cfg.tariff.bands.forEach(b => { if (o.rates[b.id] != null) b.rate = o.rates[b.id]; });
    return cfg;
  }
  const T = () => tenantCfg(state.tenant);
  const t = k => (I18N[state.lang] || I18N.en)[k] || I18N.en[k] || k;
  const hhObj = () => D.HOUSEHOLDS[state.tenant].find(h => h.id === state.hh);
  const meter = hh => (state.meterCache[hh.id] ||= D.simulateMeter(hh));
  const rate = (cfg, s) => D.bandFor(cfg.tariff, s).rate;

  // ---- broker + pipeline (one shared mock broker; pipeline enforces tenant isolation) ----
  const broker = new Q.MockBroker();
  const pipeline = new Q.Pipeline(broker, D, () => state.tenant);
  const fleet = new Q.MeterFleet(broker, D);

  // ---- theming ----
  const LOGOS = {
    bolt: c => `<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="${c}"/><path d="M22 5 10 23h8l-2 12 12-18h-8z" fill="#fff"/></svg>`,
    leaf: c => `<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="20" fill="${c}"/><path d="M11 28c0-11 8-17 19-17-1 11-7 18-17 18m0 0 9-9" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>`,
    wave: c => `<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="6" fill="${c}"/><path d="M5 24c5-6 10 6 15 0s10 6 15 0M5 16c5-6 10 6 15 0s10 6 15 0" stroke="#fff" stroke-width="2.5" fill="none"/></svg>`,
  };
  function applyTheme() {
    const cfg = T(), r = document.documentElement.style;
    for (const [k, v] of Object.entries(cfg.theme)) r.setProperty('--' + k, v);
    document.querySelector('meta[name=theme-color]').setAttribute('content', cfg.theme.primary);
    $('#brand').innerHTML = LOGOS[cfg.logo](cfg.theme.primary) + `<div>${esc(cfg.short)} <span class="sr">energy insights</span><small>${esc(cfg.name)} · white-label config</small></div>`;
    document.documentElement.lang = state.lang;
  }
  function applyI18n() { document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); }); }

  // ---- pickers ----
  function fillPickers() {
    $('#tenantSel').innerHTML = Object.values(D.RETAILERS).map(r => `<option value="${r.id}">${esc(r.short)}</option>`).join('');
    $('#tenantSel').value = state.tenant;
    $('#hhSel').innerHTML = D.HOUSEHOLDS[state.tenant].map(h => `<option value="${h.id}">${esc(h.id + ' · ' + h.label)}</option>`).join('');
    $('#hhSel').value = state.hh;
    $('#langSel').value = state.lang;
  }
  function setTenant(id, keepLang) {
    state.tenant = id; state.hh = D.HOUSEHOLDS[id][0].id;
    if (!keepLang) state.lang = D.RETAILERS[id].defaultLang;
    fillPickers(); applyTheme(); applyI18n(); render();
  }

  // ---- helpers ----
  function dublinSlot() {
    try {
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
      const h = +p.find(x => x.type === 'hour').value % 24, m = +p.find(x => x.type === 'minute').value;
      return h * 2 + (m >= 30 ? 1 : 0);
    } catch { return 36; }
  }
  function weekStats(cfg, days) {
    let kwh = 0, cost = 0, peak = 0, co2 = 0;
    days.slice(-7).forEach((d, i) => d.kwh.forEach((v, s) => {
      kwh += v; cost += v * rate(cfg, s); if (D.bandFor(cfg.tariff, s).id === 'peak') peak += v;
      co2 += v * D.MARKET.carbon[D.DAYS - 7 + i][s] / 1000;
    }));
    return { kwh, cost: cost + 7 * cfg.tariff.standing, peakShare: peak / kwh, co2 };
  }
  const bandColor = id => ({ night: 'var(--night)', day: 'var(--day)', peak: 'var(--peak)' }[id]);

  // ---- charts (SVG, with table alternatives for accessibility) ----
  function dayChart(cfg, kwh, prices) {
    const W = 720, H = 240, pad = 34, bw = (W - pad * 2) / 48, maxK = Math.max(...kwh) * 1.1, maxP = Math.max(...prices) * 1.15;
    let bars = '', line = '';
    kwh.forEach((v, s) => {
      const h = (v / maxK) * (H - pad * 2), b = D.bandFor(cfg.tariff, s).id;
      bars += `<rect x="${pad + s * bw + 1}" y="${H - pad - h}" width="${bw - 2}" height="${h}" fill="${bandColor(b)}"><title>${D.slotTime(s)} · ${v.toFixed(2)} kWh · ${b}</title></rect>`;
    });
    line = prices.map((p, s) => `${pad + s * bw + bw / 2},${H - pad - (p / maxP) * (H - pad * 2)}`).join(' ');
    const ticks = [0, 12, 24, 36, 47].map(s => `<text x="${pad + s * bw}" y="${H - 12}" font-size="11" fill="#55635c">${D.slotTime(s)}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('chart_day'))}">
      <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#bbb"/>${bars}
      <polyline points="${line}" fill="none" stroke="#111" stroke-width="2" stroke-dasharray="4 3"/>${ticks}
      <text x="${pad}" y="16" font-size="11" fill="#55635c">kWh / 30 min (bars) · €/kWh tariff (dashed)</text></svg>`;
  }
  function heatmap(days) {
    const W = 720, H = 190, pad = 40, cw = (W - pad - 10) / 48, ch = (H - 40) / 7;
    const sums = Array.from({ length: 7 }, () => new Array(48).fill(0)), counts = new Array(7).fill(0);
    days.forEach((d, i) => { const wd = (D.dayDate(i).getUTCDay() + 6) % 7; counts[wd]++; d.kwh.forEach((v, s) => sums[wd][s] += v); });
    const avg = sums.map((r, i) => r.map(v => v / Math.max(1, counts[i])));
    const mx = Math.max(...avg.flat());
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let cells = '';
    avg.forEach((r, i) => r.forEach((v, s) => {
      const a = (v / mx); cells += `<rect x="${pad + s * cw}" y="${10 + i * ch}" width="${cw - .5}" height="${ch - 1}" fill="var(--primary)" fill-opacity="${(0.08 + 0.92 * a).toFixed(2)}"><title>${names[i]} ${D.slotTime(s)} avg ${v.toFixed(2)} kWh</title></rect>`;
    }));
    const lbl = names.map((n, i) => `<text x="4" y="${10 + i * ch + ch * .7}" font-size="11" fill="#55635c">${n}</text>`).join('');
    const ticks = [0, 12, 24, 36].map(s => `<text x="${pad + s * cw}" y="${H - 8}" font-size="11" fill="#55635c">${D.slotTime(s)}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('chart_week'))}">${cells}${lbl}${ticks}</svg>`;
  }

  // ---- views ----
  function viewHome() {
    const cfg = T(), hh = hhObj(), days = meter(hh), st = weekStats(cfg, days);
    const slot = dublinSlot(), band = D.bandFor(cfg.tariff, slot);
    const y = days[D.DAYS - 1], prices = y.kwh.map((_, s) => rate(cfg, s));
    // tomorrow's cheapest+greenest 3h: normalised blend of forecast price and carbon
    const f = M.forecastDay(D.MARKET.price, D.DAYS), c = D.MARKET.carbon[D.DAYS - 1];
    const fMax = Math.max(...f), cMax = Math.max(...c), score = f.map((p, s) => p / fMax + c[s] / cMax);
    const w = M.cheapestWindow(score, 6, 0, 48);
    const yTable = y.kwh.map((v, s) => `<tr><td>${D.slotTime(s)}</td><td>${v.toFixed(3)}</td><td>${D.bandFor(cfg.tariff, s).id}</td><td>${rate(cfg, s).toFixed(3)}</td></tr>`).join('');
    return `<h1>${esc(cfg.short)} · ${esc(hh.label)}</h1>
    <div class="card now" data-testid="now"><div><div class="muted small">${t('now_label')} · Europe/Dublin ${D.slotTime(slot)}</div>
      <div><span class="pill ${band.id}">${t('band_' + band.id)}</span> <strong>${eur(band.rate)}/kWh</strong> · ${esc(cfg.tariff.name)}</div>
      <div class="small">${t('green_hint')}: <strong data-testid="green-window">${D.slotTime(w.start)}–${D.slotTime((w.start + 6) % 48)}</strong></div></div></div>
    <div class="grid" style="margin-top:14px">
      <div class="card kpi"><div class="l">${t('kpi_usage')}</div><div class="v" data-testid="kpi-kwh">${st.kwh.toFixed(1)} kWh</div></div>
      <div class="card kpi"><div class="l">${t('kpi_cost')}</div><div class="v" data-testid="kpi-cost">${eur(st.cost)}</div><div class="d">incl. standing charge</div></div>
      <div class="card kpi"><div class="l">${t('kpi_peak')}</div><div class="v">${(st.peakShare * 100).toFixed(0)}%</div><div class="bar"><span style="width:${(st.peakShare * 100).toFixed(0)}%"></span></div></div>
      <div class="card kpi"><div class="l">${t('kpi_co2')}</div><div class="v">${st.co2.toFixed(1)} kg</div><div class="d">simulated grid intensity</div></div>
    </div>
    <div class="grid2" style="margin-top:14px">
      <section class="card"><h2>${t('chart_day')}</h2>${dayChart(cfg, y.kwh, prices)}
        <div class="legend"><span><i style="background:var(--night)"></i>${t('band_night')}</span><span><i style="background:var(--day)"></i>${t('band_day')}</span><span><i style="background:var(--peak)"></i>${t('band_peak')}</span></div>
        <details><summary>${t('table_view')}</summary><table><thead><tr><th>Start</th><th>kWh</th><th>Band</th><th>€/kWh</th></tr></thead><tbody>${yTable}</tbody></table></details></section>
      <section class="card"><h2>${t('chart_week')}</h2>${heatmap(days)}<p class="small muted">Average kWh per half hour by weekday. Darker = more use.</p></section>
    </div>`;
  }

  function viewSave() {
    const cfg = T(), hh = hhObj(), days = meter(hh);
    const recs = M.recommend(cfg, hh, days, state.dynamic);
    const ev = M.evaluateDetection(hh, days), bt = M.backtest();
    const total = recs.reduce((a, r) => a + r.savingPerMonth, 0);
    const done = JSON.parse(sessionStorage.getItem('renew-demo:accepted') || '[]');
    const list = recs.length ? recs.map((r, i) => `<div class="card rec" data-testid="rec">
        <div><div><strong>${t('rec_move')} ${esc(r.label)}</strong> ${t('rec_from')} ${r.habitualStart} ${t('rec_to')} <strong>${r.suggestedStart}</strong></div>
        <div class="meta">${r.timesPer2Weeks}× in 14 days · ~${r.peakKwhShiftedPerMonth} kWh/month moved · −${r.co2KgPerMonth} kg CO₂/month · ${t('rec_conf')} ${(r.confidence * 100).toFixed(0)}%</div>
        <div class="row" style="margin-top:6px">${done.includes(hh.id + r.appliance) ? `<span class="small" role="status">✓ ${t('rec_done')}</span>` : `<button class="btn" data-accept="${r.appliance}">${t('rec_accept')}</button>`} <button class="btn ghost" data-dismiss="${i}">${t('rec_dismiss')}</button></div></div>
        <div style="text-align:right"><div class="small muted">${t('rec_save')}</div><div class="save">${eur(r.savingPerMonth)}<span class="small">${t('rec_month')}</span></div><div class="small muted">${eur(r.savingPerRun)} per run</div></div></div>`).join('') : `<p>${t('no_recs')}</p>`;
    return `<h1>${t('recs_title')}</h1><p class="muted">${t('recs_intro')}</p>
      <div class="row card"><label class="row"><input type="checkbox" id="dynToggle" ${state.dynamic ? 'checked' : ''} ${cfg.features.dynamicPrices ? '' : 'disabled'}> ${t('dynamic')}</label>
        ${cfg.features.dynamicPrices ? '' : '<span class="small muted">(disabled for this retailer by tenant feature flag)</span>'}
        <span style="margin-left:auto"><strong data-testid="total-saving">${eur(total)}</strong>${t('rec_month')} potential</span></div>
      <div style="display:grid;gap:10px;margin-top:12px" id="recList">${list}</div>
      <section class="card" style="margin-top:14px" data-testid="model-card"><h2>${t('model_title')}</h2>
      <table><tbody>
        <tr><th>Stage 1 · load disaggregation</th><td>Per-slot 25th-percentile baseline, excess-load runs, nearest-centroid appliance classification on (kW, duration). Validated against simulator ground truth for this household: precision <strong>${(ev.precision * 100).toFixed(0)}%</strong>, recall <strong>${(ev.recall * 100).toFixed(0)}%</strong>, F1 ${(ev.f1 * 100).toFixed(0)}% (TP ${ev.tp}, FP ${ev.fp}, FN ${ev.fn}).</td></tr>
        <tr><th>Stage 2 · day-ahead price forecast</th><td>0.6 × 7-day same-slot mean + 0.4 × persistence. Back-test over ${bt.days} simulated days: MAPE <strong>${(bt.mapeModel * 100).toFixed(1)}%</strong> vs seasonal-naive baseline ${(bt.mapeNaive * 100).toFixed(1)}%. Cheapest-3h window hit rate ${(bt.windowHitRate * 100).toFixed(0)}%.</td></tr>
        <tr><th>Stage 3 · recommendation</th><td>Habitual start (median of detected runs) vs cheapest allowed window per appliance (e.g. EV must finish by 07:00). Saving = Δ tariff cost × frequency. Confidence = mean classification confidence × evidence weight.</td></tr>
        <tr><th>Limits</th><td>Simulated data only. Production models would be trained and benchmarked on real pilot data, versioned in a model registry, monitored for drift, with performance reported per tenant.</td></tr>
      </tbody></table></section>`;
  }

  let liveTimer = null;
  function viewLive() {
    const m = pipeline.metrics, lat = m.latencyMs.length ? m.latencyMs.reduce((a, b) => a + b, 0) / m.latencyMs.length : 0;
    const mine = pipeline.store.filter(r => r.tenant === state.tenant);
    const hhRows = mine.filter(r => r.meterId === state.hh).slice(-48);
    const kwhToday = hhRows.reduce((a, r) => a + r.importKwh, 0), costToday = hhRows.reduce((a, r) => a + r.costEur, 0);
    const logs = pipeline.log.filter(e => e.topic.split('/')[1] === state.tenant || e.kind !== 'accepted').slice(0, 40).map(e =>
      `<div class="${e.kind === 'accepted' ? 'ok' : e.kind === 'duplicate' ? 'dup' : 'bad'}">[${e.kind}] ${esc(e.topic)} ${e.msg ? `slot ${D.slotTime(e.msg.slot)} ${e.msg.importKwh} kWh → ${e.msg.band} €${e.msg.costEur} qos${e.qos}` : esc((e.errs || []).join('; '))}</div>`).join('');
    return `<h1>${t('live_title')}</h1>
      <p class="muted small">Simulated meter gateways publish JSON to <code>ei/{tenant}/meters/{meterId}/readings</code> (QoS 1) on an in-browser mock broker. The pipeline validates, de-duplicates, enforces tenant isolation, enriches with tariff band, price and carbon, stores, and pushes to this dashboard. One half-hour slot every 0.7 s. Faults (duplicates, bad readings, corrupt payloads) are injected on purpose.</p>
      <div class="row"><button class="btn" id="streamBtn" data-testid="stream">${fleet.running() ? t('stop') : t('start')}</button>
        <button class="btn warn" id="spoofBtn" data-testid="spoof">${t('spoof')}</button></div>
      <div class="grid" style="margin-top:12px">
        <div class="card kpi"><div class="l">Accepted</div><div class="v" data-testid="accepted">${m.accepted}</div></div>
        <div class="card kpi"><div class="l">Rejected (schema)</div><div class="v">${m.rejected}</div></div>
        <div class="card kpi"><div class="l">Duplicates dropped</div><div class="v">${m.duplicates}</div></div>
        <div class="card kpi"><div class="l">Cross-tenant blocked</div><div class="v" data-testid="blocked">${m.crossTenantBlocked}</div></div>
        <div class="card kpi"><div class="l">Avg pipeline latency</div><div class="v">${lat.toFixed(2)} ms</div><div class="d">in-browser</div></div>
      </div>
      <div class="grid2" style="margin-top:12px">
        <section class="card"><h2>${esc(state.hh)} · streamed today</h2><p><strong>${kwhToday.toFixed(2)} kWh</strong> · <strong>${eur(costToday)}</strong> across ${hhRows.length} half-hours</p>
          ${hhRows.length ? dayChart(T(), Array.from({ length: 48 }, (_, s) => (hhRows.find(r => r.slot === s) || { importKwh: 0 }).importKwh), Array.from({ length: 48 }, (_, s) => rate(T(), s))) : '<p class="muted">Start the stream to see readings arrive.</p>'}</section>
        <section class="card"><h2>Message log (this tenant + rejections)</h2><div class="log" aria-live="off" data-testid="log">${logs || '<div>—</div>'}</div></section>
      </div>`;
  }

  function viewAdmin() {
    const cfg = T(), base = D.RETAILERS[state.tenant];
    const rows = D.HOUSEHOLDS[state.tenant].map(hh => {
      const days = meter(hh), st = weekStats(cfg, days), recs = M.recommend(cfg, hh, days, false);
      return { hh, st, pot: recs.reduce((a, r) => a + r.savingPerMonth, 0), n: recs.length };
    });
    const tot = rows.reduce((a, r) => ({ kwh: a.kwh + r.st.kwh, cost: a.cost + r.st.cost, pot: a.pot + r.pot }), { kwh: 0, cost: 0, pot: 0 });
    const bandInputs = cfg.tariff.bands.map(b => `<label class="small">${t('band_' + b.id)} €/kWh <input type="number" step="0.001" min="0" max="2" data-band="${b.id}" value="${b.rate}" style="width:110px"></label>`).join(' ');
    return `<h1>${t('admin_title')}</h1>
      <p class="muted small">Each retailer is an isolated tenant: own theme, tariff, feature flags, language default, households and analytics. Changes here are stored only in this browser under this tenant's key.</p>
      <div class="grid2">
      <section class="card"><h2>White-label & tariff</h2>
        <div class="row"><label class="small">Brand colour <input type="color" id="colorIn" value="${cfg.theme.primary}" data-testid="color"></label></div>
        <div class="row" style="margin-top:8px">${bandInputs}</div>
        <div class="row" style="margin-top:10px"><button class="btn" id="saveCfg" data-testid="save-config">Save tenant config</button><button class="btn ghost" id="resetCfg">Reset</button></div>
        <details style="margin-top:10px"><summary>Tenant config (JSON)</summary><pre data-testid="config-json">${esc(JSON.stringify({ ...cfg, households: D.HOUSEHOLDS[state.tenant].length }, null, 2))}</pre></details>
      </section>
      <section class="card"><h2>Portfolio analytics · ${esc(base.short)} only</h2>
        <div class="grid"><div class="kpi"><div class="l">Households</div><div class="v">${rows.length}</div></div><div class="kpi"><div class="l">kWh, 7 days</div><div class="v">${tot.kwh.toFixed(0)}</div></div><div class="kpi"><div class="l">Shift potential</div><div class="v" data-testid="portfolio-potential">${eur(tot.pot)}<span class="small">/mo</span></div></div></div>
        <table style="margin-top:10px"><thead><tr><th>Household</th><th>kWh 7d</th><th>Peak share</th><th>Suggestions</th><th>€/mo potential</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.hh.id)}</td><td>${r.st.kwh.toFixed(1)}</td><td>${(r.st.peakShare * 100).toFixed(0)}%</td><td>${r.n}</td><td>${eur(r.pot)}</td></tr>`).join('')}</tbody></table>
      </section></div>`;
  }

  const ENDPOINTS = ['/config', '/households', '/households/{hh}/summary', '/households/{hh}/readings', '/households/{hh}/recommendations', '/market/price-forecast'];
  function viewApi() {
    return `<h1>${t('api_title')}</h1>
      <div class="grid2">
      <section class="card"><h2>Try the mock REST API</h2>
        <p class="small muted">Mirrors <a href="https://github.com/92logics/renew-energy-insights-demo/blob/main/api/openapi.yaml">api/openapi.yaml</a>. Change the token's tenant claim to see isolation enforced (403).</p>
        <div class="row"><label class="small">Token tenant claim <select id="tokTenant" data-testid="token-tenant">${Object.keys(D.RETAILERS).map(k => `<option ${k === state.tenant ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
          <label class="small">Endpoint <select id="epSel" data-testid="endpoint">${ENDPOINTS.map(e => `<option>${e}</option>`).join('')}</select></label>
          <button class="btn" id="runApi" data-testid="run-api">GET</button></div>
        <p class="small"><code id="reqLine"></code></p><pre id="apiOut" data-testid="api-out">—</pre></section>
      <section class="card"><h2>Target architecture (AWS serverless, event-driven)</h2>
        <svg class="chart" viewBox="0 0 560 330" role="img" aria-label="Architecture: meters to IoT Core MQTT to Lambda to time-series store to API Gateway to apps">
          ${[['Smart meters / gateways', 10, 20], ['AWS IoT Core (MQTT, X.509)', 200, 20], ['IoT Rule → Lambda validate/enrich', 390, 20], ['Market & carbon feeds (EventBridge schedule)', 10, 120], ['Timestream / S3 data lake (per-tenant keys)', 200, 120], ['ML: SageMaker / Lambda inference', 390, 120], ['API Gateway (REST + WebSocket) + Cognito', 200, 220], ['Retailer-branded web + mobile PWA', 390, 220], ['Observability: CloudWatch, X-Ray, alarms', 10, 220]].map(([l, x, y]) => `<g><rect x="${x}" y="${y}" width="160" height="62" rx="10" fill="#fff" stroke="var(--primary)" stroke-width="2"/><foreignObject x="${x + 6}" y="${y + 6}" width="148" height="52"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:11px;line-height:1.25">${l}</div></foreignObject></g>`).join('')}
          <g stroke="#555" stroke-width="1.6" fill="none" marker-end="url(#a)"><path d="M170 51h30"/><path d="M360 51h30"/><path d="M470 82v38"/><path d="M390 151h-30"/><path d="M170 151h30"/><path d="M280 182v38"/><path d="M360 251h30"/></g>
          <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 10 5 0 10z" fill="#555"/></marker></defs>
          <text x="10" y="320" font-size="11" fill="#55635c">Illustrative target design. This demo runs the equivalent stages as mocks in the browser.</text>
        </svg>
        <p class="small">Full write-up, data model, topic scheme, security and cost notes: <a href="https://github.com/92logics/renew-energy-insights-demo/blob/main/docs/architecture.md">docs/architecture.md</a>.</p></section></div>`;
  }

  const VIEWS = { home: viewHome, save: viewSave, live: viewLive, admin: viewAdmin, api: viewApi };
  function render() {
    const v = VIEWS[state.view] ? state.view : 'home';
    $('#main').innerHTML = VIEWS[v]();
    document.querySelectorAll('.tabs a').forEach(a => a.toggleAttribute('aria-current', a.dataset.view === v) || (a.dataset.view === v && a.setAttribute('aria-current', 'page')));
    document.querySelectorAll('.tabs a').forEach(a => { if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    bind(v);
  }
  function toast(msg) { const d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }

  function bind(v) {
    if (v === 'save') {
      const dt = $('#dynToggle'); if (dt) dt.onchange = () => { state.dynamic = dt.checked; render(); };
      document.querySelectorAll('[data-accept]').forEach(b => b.onclick = () => {
        const k = JSON.parse(sessionStorage.getItem('renew-demo:accepted') || '[]'); k.push(state.hh + b.dataset.accept);
        sessionStorage.setItem('renew-demo:accepted', JSON.stringify(k)); toast(t('rec_done')); render();
      });
      document.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = () => b.closest('.rec').remove());
    }
    if (v === 'live') {
      $('#streamBtn').onclick = () => { if (fleet.running()) fleet.stop(); else fleet.start(Object.keys(D.RETAILERS)); render(); };
      $('#spoofBtn').onclick = () => {
        const other = Object.keys(D.RETAILERS).find(k => k !== state.tenant);
        broker.publish(`ei/${other}/meters/${state.hh}/readings`, JSON.stringify({ tenant: state.tenant, meterId: state.hh, seq: 9e9, slot: 0, ts: new Date().toISOString(), importKwh: 1.2 }), { qos: 1 });
        render();
      };
      clearInterval(liveTimer); liveTimer = setInterval(() => { if (state.view === 'live') render(); }, 1000);
    } else clearInterval(liveTimer);
    if (v === 'admin') {
      $('#colorIn').oninput = e => document.documentElement.style.setProperty('--primary', e.target.value);
      $('#saveCfg').onclick = () => {
        const rates = {}; document.querySelectorAll('[data-band]').forEach(i => rates[i.dataset.band] = +i.value);
        localStorage.setItem(overridesKey(state.tenant), JSON.stringify({ primary: $('#colorIn').value, rates }));
        applyTheme(); render(); toast('Saved for ' + state.tenant + ' only');
      };
      $('#resetCfg').onclick = () => { localStorage.removeItem(overridesKey(state.tenant)); applyTheme(); render(); };
    }
    if (v === 'api') {
      const run = () => {
        const ep = $('#epSel').value.replace('{hh}', state.hh), path = `/v1/tenants/${state.tenant}${ep}`;
        const r = API.handle('GET', path, { tenant: $('#tokTenant').value });
        $('#reqLine').textContent = `GET ${path}  →  ${r.status} (${r.ms} ms)`;
        let body = JSON.stringify(r.body, null, 2); if (body.length > 6000) body = body.slice(0, 6000) + '\n…';
        $('#apiOut').textContent = body;
      };
      $('#runApi').onclick = run; run();
    }
  }

  // ---- routing & init ----
  function route() { state.view = (location.hash || '#home').slice(1); render(); $('#main').focus({ preventScroll: true }); }
  function init() {
    const params = new URLSearchParams(location.search);
    const tq = params.get('tenant'); state.tenant = D.RETAILERS[tq] ? tq : 'brightwatt';
    state.hh = D.HOUSEHOLDS[state.tenant][0].id;
    state.lang = params.get('lang') || D.RETAILERS[state.tenant].defaultLang;
    fillPickers(); applyTheme(); applyI18n();
    $('#tenantSel').onchange = e => setTenant(e.target.value);
    $('#hhSel').onchange = e => { state.hh = e.target.value; render(); };
    $('#langSel').onchange = e => { state.lang = e.target.value; applyTheme(); applyI18n(); render(); };
    window.addEventListener('hashchange', route);
    const off = () => { $('#offlineBar').hidden = navigator.onLine; }; window.addEventListener('online', off); window.addEventListener('offline', off); off();
    let deferred; window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
    $('#installBtn').onclick = () => deferred && deferred.prompt();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    state.view = (location.hash || '#home').slice(1); render();
    window.__renewDemo = { state, pipeline, fleet, broker };
  }
  init();
})();
