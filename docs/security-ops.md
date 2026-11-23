# Security operations

Security Ops is the team-scoped workflow for security incidents. It uses the existing TracePredict sign-in and service catalog. The original Incidents and semantic Search pages handle the shared operational incident records. Security cases, alert payload summaries, and evidence stay in the Security Ops workspace, outside the shared embedding and training pipelines.

## Local demo

From an existing local install, run `npm run db:migrate` and `npm run ops:demo`. A fresh database created with `npm run db:init -- --demo-users` already includes two demo teams. Use the local demo password `Password@123`.

| Account | Demo scope |
| --- | --- |
| `jaanhavi@tracevault.io` | Identity & Trust lead. Investigate, view restricted evidence, and export redacted case data. |
| `kushi@tracevault.io` | Identity & Trust auditor. Read cases, shared evidence, and the team audit log. |
| `krishna@tracevault.io` | Platform Reliability responder. Open and investigate cases in that team. |
| `admin@tracevault.io` | Global administrator. Manage teams, memberships, and alert sources. Review all audit activity. |

Open **Security Ops**. The seeded identity case has an alert and a restricted evidence example. Select a service in **Service impact** to inspect its dependency path and deployments preceding intake. The map traverses up to four hops and distinguishes direct impact from downstream services that may be affected. The dependency catalog reflects its current state.

## Response coordination

Assign the case to an active responder or lead and record a handoff reason. Acknowledge the case or start investigation to meet its severity-based deadline. Critical cases have 15 minutes, high cases have one hour, medium cases have four hours, and low cases have one day. The worker records overdue acknowledgements once and surfaces them in the escalation queue. A rising severity can tighten the deadline.

New cases pin the current runbook version for their category. An administrator can publish new checklists in **Teams & sources**. The response timeline records acknowledgements, handoffs, checklist changes, and follow-ups. After resolution, leads and administrators can download an audited Markdown postmortem draft based on the recorded resolution, timeline, and follow-ups.

## Signed alert intake

Set `TRACEPREDICT_WEBHOOK_SECRET` to an independent random secret of at least 32 characters before starting the app. As an administrator, open **Security Ops → Teams & sources** and create a source for its owning team. Copy the per-source key when it is displayed. To revoke a credential, revoke the source and create a replacement.

Send JSON to `POST /api/webhooks/alerts/{sourceId}` with a UTC Unix timestamp in seconds in `X-Trace-Timestamp`. Set `X-Trace-Signature` to `sha256=<hex>`, where the hex value is the HMAC-SHA256 of the timestamp, a literal dot, and the exact UTF-8 request body. Use the displayed source key as a UTF-8 string.

```json
{
  "eventId": "monitor-event-42",
  "serviceId": 5,
  "environment": "production",
  "title": "Unplanned privileged role change",
  "category": "ACCESS",
  "severity": 4,
  "occurredAt": "2026-11-23T10:30:00Z",
  "message": "Synthetic alert summary. Review the identity audit log."
}
```

The service must exist in the catalog. The signing window is five minutes in either direction. The receiver returns 202 with a delivery ID when it stores a new alert in the queue. A matching retry returns 200 with `duplicate: true`. Reusing the ID with changed content returns 409. The worker groups open cases by team, service, environment, and category within a rolling 15-minute window based on database receipt time.

Run `npm run ops:worker` in a separate process. Workers claim available deliveries with row locks, correlate alerts transactionally, and retry failures with backoff. Deliveries that fail five times appear in **Reports**, where administrators can requeue them. The report also shows queue depth, heartbeat, P95 queue-to-case latency, duplicates, response times, recurring categories, source volume, and overdue follow-ups.

Run `npm run ops:send-demo -- http://127.0.0.1:3037` to send two distinct alerts and one retry of the first alert. Pass your own local server URL if using another port.

## Access and verification

The migration creates a PostgreSQL `NOLOGIN NOBYPASSRLS` role and grants it to the application database owner. The migration login needs permission to create and grant roles. Authenticated workspace operations assume the restricted role for the duration of a transaction and set the actor from the verified session. PostgreSQL policies check active users and current team membership. Scope applies to case detail, searches, counts, exports, alert records, and evidence. Restricted detail has a separate table and policy. The verified webhook and administrator provisioning use the trusted application connection.

Case views, evidence actions, downloads, membership changes, and source changes generate audit records. Runtime role permissions allow audit reads or append operations according to role. Database owners remain trusted. Review shared evidence summaries before saving them. Pattern-based redaction covers familiar credentials, email addresses, and IPv4 addresses. Restricted evidence is access-controlled and stored as plaintext in the development database. The worker removes expired restricted details according to the team's retention policy and records each expiry in the audit log.

Run `npm run ops:test` for signature, graph, and redaction checks. Run `npm run ops:test:api` against a seeded local app with the worker running. It verifies concurrent deliveries, failure recovery, revoked credentials, cross-team reads and exports, restricted evidence, retention, and response coordination. Set `TV_BASE_URL` if the server uses another port. The suite creates and removes temporary team records.

The administrator dashboard compares saved predictions with observed severity, recorded cause, and resolution duration by service and model version. These operational outcomes sit alongside the held-out baseline comparisons. The dashboard also displays scoring availability, errors, and latency. The demo model uses synthetic data.
