# Energy Insights: white-label smart-meter demo (by 92 Logics)

> **Demo by 92 Logics.** All retailers, households, meters, prices and carbon figures are **fictional and simulated**.
> This project is not affiliated with, endorsed by or built for any university, research project, network operator or electricity retailer.

**Live demo:** https://92logics.github.io/renew-energy-insights-demo/

This is a working demo of a multi-retailer (multi-tenant) energy-insights product. It helps households move flexible electricity use away from peak periods, using half-hourly smart-meter data, time-of-use and wholesale price signals, and transparent ML-style recommendations. It runs entirely in the browser as an installable, offline-capable PWA. The AWS serverless target architecture it imitates is described below and in [`docs/architecture.md`](docs/architecture.md).

## What you can try

| Area | What it shows |
|---|---|
| **Home** (household app) | Per-retailer branding, the current tariff band (Europe/Dublin time), 7-day kWh / € / peak share / CO₂, yesterday's half-hourly usage coloured by tariff band with the price overlay, a 28-day weekday × half-hour heatmap, and tomorrow's cheapest and greenest 3-hour window. Every chart has a table alternative. |
| **Save** (recommendations) | Personalised "move X from 18:00 to 23:00" suggestions with € per run, € per month, kWh shifted, CO₂ and confidence. You can toggle tomorrow's dynamic-price forecast where the retailer's feature flag allows it. A **model card** reports detection precision/recall/F1 against the simulator's ground truth and the price-forecast back-test MAPE against a seasonal-naive baseline. |
| **Live data** (mock MQTT) | Simulated meter gateways publish QoS-1 JSON to `ei/{tenant}/meters/{meterId}/readings` on an in-browser broker with `+`/`#` wildcard matching. The pipeline validates the schema, de-duplicates redeliveries, enforces tenant isolation (try *Send cross-tenant spoof*), enriches each reading with tariff band, € and gCO₂, stores it and updates the dashboard. Faults are injected on purpose. |
| **Retailer admin** | Tenant configuration (brand colour, tariff rates, feature flags, default language) saved per tenant, plus portfolio analytics restricted to that tenant's households. |
| **API & pipeline** | A mock REST API mirroring [`api/openapi.yaml`](api/openapi.yaml). Changing the token's tenant claim returns **403**. Includes the architecture diagram. |

Three fictional tenants are included: *Brightwatt Energy*, *Meitheal Community Power* (a co-op) and *Harbour Electric*. Each has its own theme, tariff (night/day/peak or a 02:00–05:00 boost), feature flags and default language. Harbour defaults to Polish to show localisation. Deep link: `?tenant=meitheal#save`.

## How the "ML" works (and its limits)

1. **Load disaggregation**: a per-slot 25th-percentile baseline, runs of excess load, and nearest-centroid classification on (kW, duration) against appliance signatures (EV, wet appliances, immersion, heat-pump pre-heat). It is scored against simulator ground truth.
2. **Day-ahead price forecast**: 0.6 × 7-day same-slot mean + 0.4 × persistence, back-tested over 14 simulated days (MAPE shown in the app).
3. **Recommendation**: compares the habitual start (median of detected runs) with the cheapest allowed window per appliance (for example, an EV must finish by 07:00). Saving = Δ cost × observed frequency.

These are deliberately simple, explainable baselines that run in the browser. In a real deployment they would be replaced or benchmarked by trained models (e.g. gradient-boosted or sequence models) validated on real pilot data. Each model would be versioned in a registry, monitored for drift, and reported per tenant.

## Target AWS serverless / event-driven architecture (sketch)

```
Smart meters / HAN gateways ──MQTT (TLS, X.509 per device)──► AWS IoT Core
   topic: ei/{tenant}/meters/{meterId}/readings      │  IoT policy: device may only publish to its own topic
                                                         ▼
                                    IoT Rule ─► Lambda "validate-enrich" (schema, idempotency on meterId+seq,
                                                         │   tenant check, tariff band, price, carbon)
                         invalid ─► SQS DLQ + CloudWatch alarm
                                                         ▼
          Timestream (hot, 30-min series)  +  S3 data lake (Parquet, partitioned tenant/date)  ◄── Glue/Athena
                                                         ▲
  EventBridge schedules ─► Lambda "market-ingest" (day-ahead prices, carbon intensity, aggregator/DR signals)
                                                         ▼
     Step Functions nightly: features ─► SageMaker training / batch inference ─► recommendations table (DynamoDB)
                                                         ▼
  API Gateway (REST + WebSocket) + Cognito/OIDC (tenant claim) + Lambda authorizer ─► per-tenant data access
                                                         ▼
        White-label web PWA + mobile apps (React / React Native), config from tenant store, CloudFront + WAF
  Observability: CloudWatch metrics/logs, X-Ray traces, SLO alarms · IaC: AWS CDK/Terraform · CI/CD: GitHub Actions
```

The full write-up is in [`docs/architecture.md`](docs/architecture.md). It covers the topic scheme, payload schema, multi-tenancy model, security and GDPR controls, performance targets, MLOps, cost and sustainability notes.

## Run locally

Static files only, with no build step:

```bash
python3 -m http.server 8080   # then open http://localhost:8080/
```

## Accessibility and UX

There is a skip link, keyboard-reachable controls, visible focus, ARIA labels on charts with table alternatives, and colour plus text labels for tariff bands. Reduced-motion is respected, the layout is mobile-first with a bottom navigation bar, and the UI is multilingual (EN/PL). The target is WCAG 2.2 AA. A production build would add automated axe checks in CI and usability testing with representative users.

## Licence and data

The code is MIT-licensed demo code by 92 Logics. All data is generated by a seeded pseudo-random simulator in `js/data.js`. It contains no real customer, meter, price or carbon data.
