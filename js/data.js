/* Demo by 92 Logics. ALL DATA IS FICTIONAL AND SIMULATED.
   Retailers, households, meters, prices and carbon figures below are invented
   for demonstration only and do not represent any real company or person. */
'use strict';

// Deterministic PRNG so every visitor sees the same simulated data.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function gauss(rnd) { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

const SLOTS = 48;            // half-hour intervals per day
const DAYS = 28;             // simulated history
const DEMO_END = new Date(Date.UTC(2026, 9, 25)); // fixed "today" for reproducibility

/* White-label tenant configuration. In production this lives in a per-tenant
   config store (e.g. DynamoDB/SSM) and is never shared across tenants. */
const RETAILERS = {
  brightwatt: {
    id: 'brightwatt', name: 'Brightwatt Energy (fictional)', short: 'Brightwatt',
    theme: { primary: '#0b6e4f', accent: '#f2a541', bg: '#f4faf7', ink: '#10261d' },
    logo: 'bolt', currency: 'EUR', locale: 'en-IE', defaultLang: 'en',
    tariff: { name: 'SmartSaver ToU', standing: 0.62, bands: [
      { id: 'night', from: 46, to: 16, rate: 0.205 },  // 23:00-08:00
      { id: 'peak', from: 34, to: 38, rate: 0.452 },   // 17:00-19:00
      { id: 'day', rate: 0.338 } ] },
    features: { dynamicPrices: true, evSmartCharge: true, community: false },
  },
  meitheal: {
    id: 'meitheal', name: 'Meitheal Community Power (fictional co-op)', short: 'Meitheal',
    theme: { primary: '#4338ca', accent: '#22c55e', bg: '#f5f5ff', ink: '#1e1b4b' },
    logo: 'leaf', currency: 'EUR', locale: 'en-IE', defaultLang: 'en',
    tariff: { name: 'Community Flex', standing: 0.55, bands: [
      { id: 'night', from: 46, to: 16, rate: 0.188 },
      { id: 'peak', from: 34, to: 38, rate: 0.476 },
      { id: 'day', rate: 0.321 } ] },
    features: { dynamicPrices: true, evSmartCharge: false, community: true },
  },
  harbour: {
    id: 'harbour', name: 'Harbour Electric (fictional)', short: 'Harbour',
    theme: { primary: '#0e5a8a', accent: '#e4572e', bg: '#f3f8fc', ink: '#0b2233' },
    logo: 'wave', currency: 'EUR', locale: 'en-IE', defaultLang: 'pl',
    tariff: { name: 'Night Boost', standing: 0.68, bands: [
      { id: 'night', from: 4, to: 10, rate: 0.149 },   // 02:00-05:00 boost
      { id: 'peak', from: 34, to: 38, rate: 0.489 },
      { id: 'day', rate: 0.352 } ] },
    features: { dynamicPrices: false, evSmartCharge: true, community: false },
  },
};

// Fictional households per tenant (no real people or addresses).
const HOUSEHOLDS = {
  brightwatt: [
    { id: 'BW-1001', label: 'Household A · 3-bed semi', appliances: ['ev', 'dishwasher', 'washer'], baseKw: 0.32 },
    { id: 'BW-1002', label: 'Household B · apartment', appliances: ['dishwasher', 'immersion'], baseKw: 0.18 },
    { id: 'BW-1003', label: 'Household C · detached + heat pump', appliances: ['heatpump', 'washer', 'dryer'], baseKw: 0.40 },
  ],
  meitheal: [
    { id: 'MC-2001', label: 'Member 01 · terrace', appliances: ['washer', 'dryer', 'immersion'], baseKw: 0.25 },
    { id: 'MC-2002', label: 'Member 02 · bungalow + EV', appliances: ['ev', 'heatpump'], baseKw: 0.30 },
  ],
  harbour: [
    { id: 'HE-3001', label: 'Customer X · apartment + EV', appliances: ['ev', 'dishwasher'], baseKw: 0.22 },
    { id: 'HE-3002', label: 'Customer Y · family home', appliances: ['washer', 'dryer', 'dishwasher', 'immersion'], baseKw: 0.35 },
  ],
};

const APPLIANCES = {
  ev:         { kw: 7.0, slots: 6, label: 'EV charging', flexible: true },
  dishwasher: { kw: 1.8, slots: 3, label: 'Dishwasher', flexible: true },
  washer:     { kw: 2.0, slots: 3, label: 'Washing machine', flexible: true },
  dryer:      { kw: 2.5, slots: 2, label: 'Tumble dryer', flexible: true },
  immersion:  { kw: 3.0, slots: 3, label: 'Immersion water heater', flexible: true },
  heatpump:   { kw: 1.6, slots: 8, label: 'Heat pump (pre-heat)', flexible: true },
};

function slotTime(s) { const h = Math.floor(s / 2), m = s % 2 ? '30' : '00'; return String(h).padStart(2, '0') + ':' + m; }
function dayDate(d) { const dt = new Date(DEMO_END); dt.setUTCDate(dt.getUTCDate() - (DAYS - 1 - d)); return dt; }

/* Simulated wholesale day-ahead price (EUR/MWh) and grid carbon intensity (gCO2/kWh).
   Shape: overnight trough, morning ramp, evening peak, random wind days. */
function simulateMarket() {
  const rnd = mulberry32(42);
  const price = [], carbon = [];
  for (let d = 0; d < DAYS + 1; d++) {     // +1 = tomorrow (forecast target)
    const wind = 0.25 + rnd() * 0.75;         // 0.25 calm .. 1 very windy
    const p = [], c = [];
    for (let s = 0; s < SLOTS; s++) {
      const h = s / 2;
      let shape = 75 + 35 * Math.exp(-Math.pow((h - 18) / 1.6, 2)) + 18 * Math.exp(-Math.pow((h - 8.5) / 1.4, 2)) - 30 * Math.exp(-Math.pow((h - 3.5) / 2.5, 2));
      shape *= (1.25 - 0.55 * wind);
      p.push(Math.max(5, shape + gauss(rnd) * 6));
      c.push(Math.max(60, 420 - 260 * wind + 60 * Math.exp(-Math.pow((h - 18) / 2, 2)) + gauss(rnd) * 15));
    }
    price.push(p); carbon.push(c);
  }
  return { price, carbon };
}
const MARKET = simulateMarket();

/* Simulated smart-meter half-hourly import (kWh per 30 min). */
function simulateMeter(hh) {
  const rnd = mulberry32(hashStr(hh.id));
  const days = [];
  for (let d = 0; d < DAYS; d++) {
    const weekend = [0, 6].includes(dayDate(d).getUTCDay());
    const kwh = new Array(SLOTS).fill(0);
    for (let s = 0; s < SLOTS; s++) {
      const h = s / 2;
      const morning = Math.exp(-Math.pow((h - (weekend ? 9.5 : 7.5)) / 1.2, 2)) * 0.9;
      const evening = Math.exp(-Math.pow((h - 18.5) / 2.0, 2)) * 1.4;
      const kw = hh.baseKw + morning + evening + Math.abs(gauss(rnd)) * 0.08;
      kwh[s] = kw * 0.5;
    }
    const events = [];
    for (const a of hh.appliances) {
      const A = APPLIANCES[a];
      const p = { ev: 0.55, dishwasher: 0.8, washer: weekend ? 0.8 : 0.4, dryer: weekend ? 0.6 : 0.3, immersion: 0.9, heatpump: 1 }[a];
      if (rnd() > p) continue;
      // Habitual start: most loads start in the evening peak (the behaviour RENEW-style services target).
      let start = { ev: 36, dishwasher: 40, washer: weekend ? 22 : 36, dryer: 40, immersion: 34, heatpump: 32 }[a];
      start += Math.round(gauss(rnd) * 2);
      if (rnd() < 0.2) start = 46 - A.slots; // sometimes already off-peak
      start = Math.max(0, Math.min(SLOTS - A.slots, start));
      for (let k = 0; k < A.slots; k++) kwh[start + k] += A.kw * 0.5;
      events.push({ appliance: a, start, slots: A.slots });
    }
    days.push({ kwh: kwh.map(v => +v.toFixed(3)), events });
  }
  return days;
}

function bandFor(tariff, s) {
  for (const b of tariff.bands) {
    if (b.from === undefined) continue;
    const inBand = b.from < b.to ? (s >= b.from && s < b.to) : (s >= b.from || s < b.to);
    if (inBand) return b;
  }
  return tariff.bands.find(b => b.from === undefined);
}
function rateAt(tenant, s) { return bandFor(tenant.tariff, s).rate; }

window.RENEW_DATA = { mulberry32, hashStr, gauss, SLOTS, DAYS, DEMO_END, RETAILERS, HOUSEHOLDS, APPLIANCES, MARKET, simulateMeter, slotTime, dayDate, bandFor, rateAt };
