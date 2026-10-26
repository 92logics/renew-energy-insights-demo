# Target architecture: white-label energy-insights platform (demo write-up by 92 Logics)

> This is an illustrative design that accompanies a demo with fictional data. It is not a description of any client's system.

## 1. Goals and constraints
- Help households move flexible load (EV, wet appliances, immersion, heat-pump pre-heat) off-peak, using half-hourly smart-meter data, tariffs, wholesale prices and grid carbon intensity.
- Serve many electricity retailers or aggregators from one platform, with strict tenant isolation, per-tenant branding, configuration, analytics and localisation.
- Be event-driven and serverless, so cost scales to zero in pilots and up nationally. Data stays in an EU region (e.g. eu-west-1 Ireland), with GDPR by design.
- Make every recommendation explainable and measurable, with performance reported per model version and tenant.

## 2. Components (AWS, or equivalent)
| Layer | Service | Notes |
|---|---|---|
| Device ingest | **AWS IoT Core** (MQTT 3.1.1/5 over TLS 1.2+, X.509 per device or gateway; Fleet Provisioning) | IoT policy variables restrict each thing to `ei/${tenant}/meters/${iot:Connection.Thing.ThingName}/#` |
| Bulk ingest | S3 presigned upload / SFTP (Transfer Family) for retailer or DSO half-hourly files | Same validation Lambda via S3 event |
| Stream processing | IoT Rule → **Lambda** `validate-enrich` (Python/Node) → Kinesis Data Streams for high volume | JSON-schema validation, idempotency (meterId+seq in DynamoDB with TTL), DLQ on SQS, enrichment with tariff band / price / carbon |
| Time-series & lake | **Amazon Timestream** (hot 30-min series) + **S3** Parquet lake partitioned `tenant=/date=`; Glue catalog, Athena | KMS key per tenant; S3 Object Lock for audit extracts |
| Market data | **EventBridge Scheduler** → Lambda `market-ingest` | Day-ahead prices, carbon intensity, aggregator / demand-response signals |
| ML | **Step Functions** nightly: feature build → **SageMaker** training / batch transform; low-latency inference via Lambda container or SageMaker Serverless Inference | Model registry, approval gates, Model Monitor drift alerts, shadow / A-B by tenant |
| APIs | **API Gateway** REST + WebSocket, Lambda authorizer, **Cognito** (or retailer OIDC federation) | Tenant claim in JWT, enforced at authorizer and data layer; throttling and usage plans per tenant |
| Config | DynamoDB `tenant-config` + AppConfig feature flags | Theme, tariffs, languages, features, recommendation rules |
| Front ends | React PWA + React Native (or Flutter) apps, CloudFront + WAF, white-label build-time and run-time theming | WCAG 2.2 AA, i18n (ICU messages), offline cache |
| Notifications | EventBridge → SNS / Pinpoint push, email, SMS | "Your cheapest window tonight is 01:30–04:30" |
| Observability | CloudWatch metrics and logs (EMF), X-Ray / OpenTelemetry traces, dashboards per tenant, SLO alarms, PagerDuty/Opsgenie | Runbooks for incidents and recovery |
| Delivery | IaC (AWS CDK or Terraform), GitHub Actions/CodePipeline, multi-account (dev/test/prod) with Control Tower | Automated tests, SAST/DAST, dependency scanning, signed artefacts |

## 3. MQTT topic scheme and payload
```
ei/{tenantId}/meters/{meterId}/readings      # device → cloud, QoS 1
ei/{tenantId}/meters/{meterId}/status        # heartbeat / firmware / RSSI
ei/{tenantId}/households/{hhId}/signals      # cloud → HAN device (e.g. EV charger schedule), QoS 1, retained
ei/{tenantId}/broadcast/price                # day-ahead price & carbon for local automation
```
```json
{ "tenant": "brightwatt", "meterId": "BW-1001", "seq": 18234, "ts": "2026-10-25T17:30:00Z",
  "slot": 35, "importKwh": 1.42, "exportKwh": 0.0, "unit": "kWh/30min", "fw": "sim-1.4" }
```
Validation rules include matching the topic and payload tenant and meter, an ISO-8601 timestamp, a value range of 0–25 kWh per 30 min, and a monotonic `seq`. Duplicates (QoS 1 redelivery) are dropped idempotently. Late or out-of-order readings are upserted by `(meterId, ts)`.

## 4. Multi-tenancy
- **Identity:** a tenant claim in every token, with a Lambda authorizer that rejects any path or tenant mismatch (the demo's 403).
- **Data:** a partition key prefix `tenant#`, per-tenant KMS keys, S3 prefixes with IAM conditions, and Athena workgroups per tenant. Silo accounts are optional for large retailers.
- **Config:** branding, tariffs, languages and feature flags per tenant. No code fork per retailer.
- **Analytics:** aggregations are computed per tenant only. Cross-tenant benchmarking would need anonymised, consented and k-anonymous aggregates.

## 5. Security and data protection
Security and data-protection controls follow OWASP ASVS L2 for the APIs and apps. Encryption is applied in transit (TLS 1.2+) and at rest (KMS). Access is least-privilege IAM, with secrets in Secrets Manager. WAF, Shield and GuardDuty are enabled, alongside Security Hub with CIS benchmarks. Audit trails use CloudTrail with Object Lock.

GDPR controls cover data minimisation, with pseudonymised meter IDs in the analytics zone. They also include defined retention periods, DPIA support, data-subject request tooling (export and delete by household), EU-only processing, and a processor role under a DPA with the controller. Change management is aligned to ISO 27001-style controls: tickets, peer review, CAB for production and audit evidence.

## 6. Performance targets (illustrative, to be agreed in the pilot)
| Metric | Target |
|---|---|
| Ingest → dashboard (p95) | < 5 s for streamed readings |
| API read (p95) | < 300 ms |
| Recommendation inference (p95) | < 200 ms per household (online), nightly batch for all |
| Dashboard first load on 4G | < 2.5 s LCP |
| Throughput | 1 M meters × 48 readings/day ≈ 560 msg/s average, burst ×10 |
| Availability | 99.9 % monthly for the APIs; RPO 15 min / RTO 4 h |

## 7. MLOps and transparent performance reporting
Every model card records its data window, features, metrics (MAE/MAPE for forecasts; precision/recall for load detection; realised vs predicted savings for recommendations), fairness checks across household types, and the approval record. Releases are gated on beating the current baseline against pilot data. Post-deployment, the system monitors drift and the realised shift in kWh (measured against a counterfactual baseline), and publishes both in a per-tenant report.

## 8. Cost and sustainability notes
- Serverless and pay-per-use, so a pilot costs very little. Graviton/arm64 Lambdas and Parquet compression are used, with S3 lifecycle rules moving data to Glacier and Timestream retention tiers.
- Batch ML runs are scheduled into low-carbon or low-price hours, which applies the platform's own principle to itself.
- Workloads are right-sized using Compute Optimizer and the AWS Customer Carbon Footprint Tool, with the results reported each quarter.

## 9. What the browser demo implements vs mocks
| Real in demo | Mocked |
|---|---|
| Simulation, disaggregation, forecast, back-test, recommendations, tenant config and isolation checks, PWA offline | Broker (in-memory pub/sub with MQTT wildcard semantics), REST API (in-browser handler), auth (tenant claim selector), storage (memory/localStorage) |
