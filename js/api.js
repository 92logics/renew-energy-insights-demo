/* Demo by 92 Logics. In-browser MOCK REST API mirroring api/openapi.yaml.
   Every request is scoped by tenant (in production: JWT claim from Cognito/OIDC, enforced by an
   API Gateway authorizer + row-level tenant keys). Responses are computed from simulated data. */
'use strict';
(function () {
  const D = window.RENEW_DATA, M = window.RENEW_ML;
  const cache = {};
  const meter = hh => (cache[hh.id] ||= D.simulateMeter(hh));

  function handle(method, path, auth) {
    const t0 = performance.now();
    const res = (status, body) => ({ status, body, ms: +(performance.now() - t0).toFixed(1) });
    if (method !== 'GET') return res(405, { error: 'demo API is read-only' });
    const m = path.match(/^\/v1\/tenants\/([a-z]+)(\/.*)?$/);
    if (!m) return res(404, { error: 'not found' });
    const [, tenantId, rest = ''] = m;
    if (!D.RETAILERS[tenantId]) return res(404, { error: 'unknown tenant' });
    if (auth.tenant !== tenantId) return res(403, { error: 'token tenant claim does not match path tenant (isolation enforced)' });
    const tenant = D.RETAILERS[tenantId];
    if (rest === '' || rest === '/config') return res(200, { id: tenant.id, name: tenant.name, theme: tenant.theme, tariff: tenant.tariff, features: tenant.features, locale: tenant.locale });
    if (rest === '/households') return res(200, D.HOUSEHOLDS[tenantId].map(h => ({ id: h.id, label: h.label })));
    const h = rest.match(/^\/households\/([A-Z]{2}-\d{4})\/(readings|recommendations|summary)$/);
    if (h) {
      const hh = D.HOUSEHOLDS[tenantId].find(x => x.id === h[1]);
      if (!hh) return res(404, { error: 'household not in this tenant' });
      const days = meter(hh);
      if (h[2] === 'readings') {
        const d = D.DAYS - 1, date = D.dayDate(d).toISOString().slice(0, 10);
        return res(200, { meterId: hh.id, date, intervalMinutes: 30, unit: 'kWh', readings: days[d].kwh.map((v, s) => ({ start: D.slotTime(s), kWh: v })) });
      }
      if (h[2] === 'recommendations') return res(200, { meterId: hh.id, modelVersion: 'shift-heuristic-0.3-demo', items: M.recommend(tenant, hh, days, false) });
      const last7 = days.slice(-7); let kwh = 0, cost = 0;
      last7.forEach(d => d.kwh.forEach((v, s) => { kwh += v; cost += v * D.rateAt(tenant, s); }));
      return res(200, { meterId: hh.id, period: 'P7D', kWh: +kwh.toFixed(1), costEur: +(cost + 7 * tenant.tariff.standing).toFixed(2) });
    }
    if (rest === '/market/price-forecast') return res(200, { unit: 'EUR/MWh', source: 'simulated day-ahead', model: '0.6*mean7 + 0.4*persistence', slots: M.forecastDay(D.MARKET.price, D.DAYS).map((p, s) => ({ start: D.slotTime(s), price: +p.toFixed(1) })) });
    return res(404, { error: 'not found' });
  }
  window.RENEW_API = { handle };
})();
