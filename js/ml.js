/* Demo by 92 Logics. "ML-style" recommendation engine running entirely in the browser
   on SIMULATED data. It is deliberately transparent: every number shown in the UI
   (detection precision/recall, forecast MAPE, savings) is computed here and can be
   inspected. In production the same stages would run as versioned models behind an
   inference endpoint with MLOps (registry, drift monitoring, pilot validation). */
'use strict';
(function () {
  const D = window.RENEW_DATA;

  // 1) Load disaggregation: detect flexible-load events from the half-hourly profile.
  //    Baseline = rolling 20th percentile of the day; events = runs above baseline + threshold.
  //    Each run is classified by nearest centroid in (mean kW, duration) space.
  function baseProfile(days) {
    // Per-slot 25th percentile across all history = the household's "non-flexible" profile.
    const out = [];
    for (let s = 0; s < D.SLOTS; s++) { const v = days.map(d => d.kwh[s] * 2).sort((a, b) => a - b); out.push(v[Math.floor(v.length * 0.25)]); }
    return out;
  }
  function detectEvents(dayKwh, applianceHints, base) {
    const kw = dayKwh.map(v => v * 2);
    const excess = kw.map((v, i) => v - base[i]);
    const runs = []; let cur = null;
    for (let s = 0; s < kw.length; s++) {
      if (excess[s] > 0.9) { if (!cur) cur = { start: s, slots: 0, sum: 0 }; cur.slots++; cur.sum += excess[s]; }
      else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    return runs.map(r => {
      const meanKw = r.sum / r.slots;
      let best = null, bestD = Infinity;
      for (const a of applianceHints) {
        const A = D.APPLIANCES[a];
        const dist = Math.pow((meanKw - A.kw) / 2, 2) + Math.pow((r.slots - A.slots) / 3, 2);
        if (dist < bestD) { bestD = dist; best = a; }
      }
      return { appliance: best, start: r.start, slots: r.slots, meanKw: +meanKw.toFixed(2), confidence: +Math.max(0.35, 1 - bestD).toFixed(2) };
    });
  }

  // Evaluate detection against simulator ground truth (transparent performance reporting).
  function evaluateDetection(hh, days) {
    let tp = 0, fp = 0, fn = 0; const base = baseProfile(days);
    for (const day of days) {
      const det = detectEvents(day.kwh, hh.appliances, base);
      const truth = day.events.map(e => ({ ...e, matched: false }));
      for (const e of det) {
        const m = truth.find(t => !t.matched && Math.abs(t.start - e.start) <= 2);
        if (m) { m.matched = true; tp++; } else fp++;
      }
      fn += truth.filter(t => !t.matched).length;
    }
    const precision = tp / Math.max(1, tp + fp), recall = tp / Math.max(1, tp + fn);
    return { tp, fp, fn, precision, recall, f1: 2 * precision * recall / Math.max(1e-9, precision + recall) };
  }

  // 2) Day-ahead price forecast: blend of same-slot 7-day mean and yesterday (persistence).
  //    Back-tested on the last 14 simulated days against a seasonal-naive baseline.
  function forecastDay(price, d) {
    const out = [];
    for (let s = 0; s < D.SLOTS; s++) {
      let m = 0; for (let k = 1; k <= 7; k++) m += price[d - k][s]; m /= 7;
      out.push(0.6 * m + 0.4 * price[d - 1][s]);
    }
    return out;
  }
  function backtest() {
    const P = D.MARKET.price; let mapeModel = 0, mapeNaive = 0, n = 0, rankHits = 0, days = 0;
    for (let d = D.DAYS - 14; d < D.DAYS; d++) {
      const f = forecastDay(P, d);
      for (let s = 0; s < D.SLOTS; s++) {
        mapeModel += Math.abs(f[s] - P[d][s]) / P[d][s];
        mapeNaive += Math.abs(P[d - 7][s] - P[d][s]) / P[d][s];
        n++;
      }
      // Does the forecast pick a truly cheap window? (cheapest 3h of forecast within actual cheapest 25%)
      const fw = cheapestWindow(f, 6, 0, 48), q = [...P[d]].sort((a, b) => a - b)[12];
      const actual = P[d].slice(fw.start, fw.start + 6).reduce((a, b) => a + b, 0) / 6;
      if (actual <= q * 1.1) rankHits++; days++;
    }
    return { mapeModel: mapeModel / n, mapeNaive: mapeNaive / n, windowHitRate: rankHits / days, days };
  }
  function cheapestWindow(series, len, from, to) {
    let best = { start: from, cost: Infinity };
    for (let s = from; s + len <= to; s++) {
      const c = series.slice(s, s + len).reduce((a, b) => a + b, 0);
      if (c < best.cost) best = { start: s, cost: c };
    }
    return best;
  }

  // 3) Recommendations: habitual start (median of detected events) vs best allowed window.
  const ALLOWED = { ev: [42, 62], dishwasher: [40, 64], washer: [0, 48], dryer: [0, 48], immersion: [0, 48], heatpump: [8, 34] };
  function priceSeries(tenant, useDynamic) {
    if (useDynamic && tenant.features.dynamicPrices) {
      const f = forecastDay(D.MARKET.price, D.DAYS);   // tomorrow's forecast, EUR/MWh
      return f.map(p => +(0.14 + p / 1000 * 1.9).toFixed(4)); // illustrative retail pass-through EUR/kWh
    }
    return Array.from({ length: D.SLOTS }, (_, s) => D.rateAt(tenant, s));
  }
  function recommend(tenant, hh, days, useDynamic) {
    const prices = priceSeries(tenant, useDynamic);
    const carbon = D.MARKET.carbon[D.DAYS - 1];
    const recent = days.slice(-14);
    const byApp = {}; const base = baseProfile(days);
    for (const day of recent) for (const e of detectEvents(day.kwh, hh.appliances, base)) (byApp[e.appliance] ||= []).push(e);
    const recs = [];
    for (const [a, evs] of Object.entries(byApp)) {
      const A = D.APPLIANCES[a]; if (!A.flexible) continue;
      const starts = evs.map(e => e.start).sort((x, y) => x - y), habitual = starts[Math.floor(starts.length / 2)];
      const kwhPerSlot = A.kw * 0.5;
      const ext = [...prices, ...prices], extC = [...carbon, ...carbon];
      const [lo, hi] = ALLOWED[a];
      const best = cheapestWindow(ext, A.slots, lo, Math.min(hi, 96 - A.slots));
      const costAt = st => ext.slice(st, st + A.slots).reduce((x, y) => x + y, 0) * kwhPerSlot;
      const co2At = st => extC.slice(st, st + A.slots).reduce((x, y) => x + y, 0) * kwhPerSlot / 1000;
      const saving = costAt(habitual) - costAt(best.start);
      const perMonth = saving * (evs.length / 14) * 30;
      if (saving <= 0.02) continue;
      const conf = evs.reduce((x, e) => x + e.confidence, 0) / evs.length * Math.min(1, evs.length / 5);
      recs.push({
        appliance: a, label: A.label, timesPer2Weeks: evs.length,
        habitualStart: D.slotTime(habitual % 48), suggestedStart: D.slotTime(best.start % 48),
        savingPerRun: +saving.toFixed(2), savingPerMonth: +perMonth.toFixed(2),
        co2KgPerMonth: +((co2At(habitual) - co2At(best.start)) * (evs.length / 14) * 30).toFixed(1),
        peakKwhShiftedPerMonth: +(A.kw * A.slots * 0.5 * (evs.length / 14) * 30).toFixed(0),
        confidence: +conf.toFixed(2),
      });
    }
    return recs.sort((x, y) => y.savingPerMonth - x.savingPerMonth);
  }

  window.RENEW_ML = { baseProfile, detectEvents, evaluateDetection, forecastDay, backtest, cheapestWindow, recommend, priceSeries };
})();
