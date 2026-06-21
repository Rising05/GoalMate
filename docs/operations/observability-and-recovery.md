# GoalMate Observability and Recovery Runbook

## Platform decision

- Metrics and alerts: Prometheus plus Alertmanager; Grafana is the dashboard layer.
- Structured logs: JSON to stdout, collected by the deployment platform into Loki or an equivalent log store.
- Error tracking: Sentry in production, configured to discard request bodies, cookies, authorization headers, goal text, check-in text and payment payloads before sending events.
- Correlation: clients may supply safe `x-request-id` and `x-trace-id`; otherwise the API generates them and returns both headers. `ai_jobs`, `ai_call_logs` and `email_logs` retain the trace ID.

Production must set `METRICS_TOKEN`; Prometheus reads it from a secret file. `/health` is liveness, `/health/readiness` checks required dependencies, and `/metrics` exposes Prometheus text. Do not expose `/metrics` directly to the public internet.

## Alert ownership

`ops/observability/goalmate-alerts.yml` is the source of truth. The primary receiver is the on-call operations webhook; the secondary receiver should be the engineering incident channel. Provider failure, Redis outage, payment backlog and API 5xx alerts are paging events. Latency, queue backlog and MySQL rollback alerts are warning events during staffed hours.

## Incident workflow

1. Record alert start time, environment and trace/request IDs. Never paste raw user content or credentials into the incident channel.
2. Check `/health/readiness`, then `/metrics`, then JSON logs filtered by `traceId`.
3. For a failed AI operation, query the admin AI Job and AI call-log endpoints by Job/user/goal and inspect error category, attempt, prompt version and provider request ID.
4. For queue loss or Redis recovery, run `POST /admin/queues/reconcile` first with `dryRun=true` and an audit reason, then run it without dry-run. Only persisted `QUEUED` rows are re-enqueued; terminal rows are untouched.
5. For payment alerts, stop automatic entitlement changes if signature or amount validation is suspect. Reprocess only by provider event ID and preserve idempotency.
6. Close the incident with impact, root cause, trace IDs, remediation and follow-up owner.

## Backup policy

- Run `ops/mysql/backup.sh` daily. It uses a consistent transactional dump, SHA-256 sidecar, atomic rename and 14-day local retention by default.
- MySQL binlog is enabled in Docker with row format and seven-day retention. Production must archive binlogs outside the database host for point-in-time recovery.
- Run `ops/storage/backup-local.sh` while local storage remains in use. P1-1 must replace this with bucket versioning/soft delete and lifecycle policies.
- Store backups in a different failure domain with encryption, immutable retention and access audit. Redis is never a backup source or the sole source of job state.
- Alert if the newest successful backup is older than 26 hours or checksum verification fails.

## Restore procedure

1. Select the latest full dump before the incident and verify its `.sha256` file.
2. Restore into a new database first with `ops/mysql/restore-drill.sh`; never test a backup by overwriting production.
3. Apply archived binlogs up to the chosen recovery timestamp when PITR is required.
4. Validate Prisma migration count, critical table counts, foreign keys and a read-only application smoke test.
5. Quiesce writes, switch the application to the restored database, run readiness checks, then resume workers.
6. Record measured RPO/RTO and schedule remediation when targets are missed.

Current targets for the early-user stage are RPO 24 hours without binlog archive (15 minutes with archive) and RTO 60 minutes. A restore drill is required quarterly and after material schema or backup-tool changes.
