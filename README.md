# TracePredict

TracePredict combines incident reporting, predictive triage, investigation, and resolution in one Next.js application. It builds on TraceVault’s PostgreSQL incident system and pgvector historical search. The prediction module estimates severity, ranks cause categories, and estimates minutes from report to resolution.

**Security Ops** adds a team-scoped security case queue fed by signed alert webhooks. It includes alert correlation, an interactive service impact map, restricted evidence, and a searchable audit log. [Open the Security Ops setup and demo guide](docs/security-ops.md).

## Run locally

Use Node.js 20+, Docker Desktop or a PostgreSQL database with pgvector, and npm. The following commands work in PowerShell.

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
docker compose up -d
npm.cmd run db:init -- --demo-users
npm.cmd run ml:train -- --demo
npm.cmd run dev
```

In another terminal run `npm.cmd run ops:worker` to process alerts, acknowledgement escalations, and restricted evidence expiry.

Set a unique `AUTH_SECRET` in `.env.local` before starting. If you already have a TraceVault database connected, use `npm.cmd run db:migrate` to add predictions without resetting it.

Open [TracePredict](http://localhost:3000) and sign in as `jaanhavi@tracevault.io` with `Password@123` after initializing locally with `--demo-users`. The admin demo login is `admin@tracevault.io` with the same password. Use those credentials only for local demos.

1. Open **Incidents** and start a report such as “Payment API outage.” Describe failing requests after a rollout and select the affected services.
2. Click **Get intake prediction**, choose the recorded severity, and create the incident. The incident detail page keeps the original prediction with the investigation context.
3. Claim or assign the incident, add investigation events, and record the resolution. The incident detail page shows the recorded cause and actual duration. The dashboard shows evaluated model performance.

Install Ollama and run `ollama pull nomic-embed-text` for semantic incident search. Run `npm.cmd run embeddings:backfill` to index seeded incidents. Prediction uses its own feature pipeline and works without Ollama.

## Train on historical data

```powershell
npm.cmd run db:migrate
npm.cmd run ml:export 
npm.cmd run ml:train -- .models/training.json
npm.cmd run ml:test
npm.cmd run typecheck
```

The export reports resolution coverage and label counts. You can also train on an approved JSON array that conforms to [the training schema](ml/contracts.ts). Keep exports and trained artifacts private. Nearest-neighbor artifacts contain the training features, including intake wording. The default model location is `.models/incident-model.json`. Set `INCIDENT_MODEL_PATH` for a different path.

The bundled PostgreSQL seed contains seven incidents. The synthetic demo uses 800 generated examples and displays that origin alongside every prediction and model report. Its test metrics describe the generated patterns. Keep a real model withheld until timestamped history supports chronological evaluation and baseline comparisons.

## Behavior and verification

- [Architecture, targets, evaluation, and failure cases](docs/prediction.md)
- [HTTP API](API.md)
- [TraceVault database documentation and existing demonstrations](docs/README.md)

Run `npm.cmd run ml:test` for the prediction unit tests. The archived SQL and API suites are available through `npm run test:all` in Bash. That command resets the configured database, so point it at a disposable local instance. With a seeded app already running, `node tests/api.test.mjs` runs API checks without the reset wrapper and creates an incident as part of the suite.
