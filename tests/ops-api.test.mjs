import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const base = new URL(process.env.TV_BASE_URL ?? "http://127.0.0.1:3037");
const database = new URL(process.env.DATABASE_URL);
if (![base.hostname, database.hostname].every((host) => ["localhost", "127.0.0.1", "[::1]"].includes(host))) {
  throw new Error("This suite requires a local demo app and database");
}

async function call(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, json: await response.json() };
}

async function login(email) {
  const result = await call("/api/auth/login", { method: "POST", body: { email, password: "Password@123" } });
  assert.equal(result.status, 200, email);
  return result.headers.get("set-cookie").split(";")[0];
}

async function until(read) {
  for (let attempt = 0; attempt < 35; attempt++) {
    const result = await read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error("Background processing did not reach the expected state");
}

test("signed intake through investigation, with team and evidence isolation", async () => {
  const pool = new pg.Pool({ connectionString: database.href });
  const teams = [];
  const targets = [];
  const runbookVersions = [];
  const suffix = randomUUID().slice(0, 8);
  const [admin, lead, auditor, responder] = await Promise.all(
    ["admin", "jaanhavi", "kushi", "krishna"].map((name) => login(name + "@tracevault.io")),
  );
  const settings = (body) => call("/api/ops/settings", { method: "POST", cookie: admin, body });
  try {
    const { json: directory } = await call("/api/users", { cookie: admin });
    const idOf = (name) => directory.users.find((user) => user.email === name + "@tracevault.io").user_id;
    const leadId = idOf("jaanhavi");
    const responderId = idOf("krishna");
    for (const name of ["Isolation alpha", "Isolation beta"]) {
      const result = await settings({ action: "team", name: name + " " + suffix });
      assert.equal(result.status, 200, JSON.stringify(result.json));
      teams.push(result.json.teamId);
    }
    const [alpha, beta] = teams;
    for (const [teamId, userId, role] of [
      [alpha, leadId, "LEAD"], [alpha, idOf("kushi"), "AUDITOR"], [beta, responderId, "RESPONDER"],
    ]) {
      assert.equal((await settings({ action: "membership", teamId, userId, role })).status, 200);
    }
    const workspace = await call("/api/ops?teamId=" + alpha, { cookie: lead });
    assert.equal(workspace.status, 200, JSON.stringify(workspace.json));
    assert.deepEqual(workspace.json.stats, { active: 0, critical: 0, resolved: 0, alerts: 0 });
    const serviceId = workspace.json.services.find((service) => service.service_name === "Auth Service").service_id;
    const fixtureCase = { teamId: alpha, serviceId, severity: 2, category: "INTEGRITY", environment: "staging" };
    const before = await call("/api/ops", { method: "POST", cookie: lead, body: { ...fixtureCase, title: "First runbook case" } });
    assert.equal(before.status, 201, JSON.stringify(before.json));
    const beforePath = "/api/ops/cases/" + before.json.caseId;
    const firstRunbook = (await call(beforePath, { cookie: lead })).json.coordination.runbook;
    const versionName = "Verification runbook " + suffix;
    const version = await settings({ action: "runbook", category: "INTEGRITY", name: versionName, steps: ["Verify record integrity."] });
    assert.equal(version.status, 200, JSON.stringify(version.json));
    const { rows: [published] } = await pool.query("SELECT runbook_id FROM ops.runbooks WHERE name = $1", [versionName]);
    runbookVersions.push(published.runbook_id);
    targets.push(published.runbook_id);
    assert.deepEqual((await call(beforePath, { cookie: lead })).json.coordination.runbook, firstRunbook);
    const after = await call("/api/ops", { method: "POST", cookie: lead, body: { ...fixtureCase, title: "Second runbook case" } });
    assert.equal(after.status, 201);
    const currentRunbook = (await call("/api/ops/cases/" + after.json.caseId, { cookie: lead })).json.coordination.runbook;
    assert.equal(currentRunbook.name, versionName);
    assert.equal(currentRunbook.version, firstRunbook.version + 1);

    const source = await settings({ action: "source", teamId: alpha, name: "Test monitor" });
    assert.equal(source.status, 200, JSON.stringify({ status: source.status, error: source.json.error }));
    const secondSource = await settings({ action: "source", teamId: alpha, name: "Second monitor" });
    assert.equal(secondSource.status, 200);
    const event = {
      eventId: "first", serviceId, severity: 3, title: "Review permission changes " + suffix,
      category: "ACCESS", environment: "staging", message: "Contact test@example.com", occurredAt: new Date().toISOString(),
    };
    function signed(receiver, event, timestamp = String(Math.floor(Date.now() / 1000))) {
      const raw = JSON.stringify(event);
      const hash = createHmac("sha256", receiver.key).update(timestamp + "." + raw).digest("hex");
      return call(receiver.path, { method: "POST", body: raw, headers: {
        "x-trace-timestamp": timestamp, "x-trace-signature": "sha256=" + hash,
      } });
    }
    assert.equal((await call(source.json.path, { method: "POST", body: event })).status, 401);
    assert.equal((await signed(source.json, event, String(Math.floor(Date.now() / 1000) - 301))).status, 401);
    const deliveries = await Promise.all([
      signed(source.json, event), signed(source.json, event),
      signed(secondSource.json, { ...event, eventId: "repeat", severity: 4 }),
    ]);
    assert.deepEqual(deliveries.map((result) => result.status).sort(), [200, 202, 202], JSON.stringify(deliveries.map(({status, json}) => ({status, json}))));
    const deliveryIds = [...new Set(deliveries.map((result) => result.json.deliveryId))];
    assert.equal(deliveryIds.length, 2);
    const processed = await until(async () => {
      const { rows } = await pool.query(
        "SELECT status, case_id FROM ops.deliveries WHERE delivery_id = ANY($1::uuid[])", [deliveryIds],
      );
      return rows.length === 2 && rows.every((row) => row.status === "PROCESSED") ? rows : null;
    });
    assert.equal(new Set(processed.map((row) => row.case_id)).size, 1);
    const caseId = processed[0].case_id;
    targets.push(caseId);
    assert.equal((await signed(source.json, { ...event, message: "Different content" })).status, 409);
    const endpoint = "/api/ops/cases/" + caseId;
    const grouped = await call(endpoint, { cookie: lead });
    assert.equal(grouped.status, 200, JSON.stringify(grouped.json));
    assert.equal(grouped.json.signals.length, 2);
    assert.equal(grouped.json.case.severity, 4);
    assert.equal(grouped.json.impact.nodes.some((item) => item.service_id === serviceId && item.relation === "AFFECTED"), true);
    assert.ok(grouped.json.signals.every((signal) => !signal.message.includes("test@example.com")));
    assert.equal((await call(endpoint, { cookie: responder })).status, 404);
    assert.equal((await call(endpoint + "?format=json", { cookie: responder })).status, 404);
    assert.deepEqual((await call("/api/ops?q=" + suffix, { cookie: responder })).json.cases, []);
    assert.deepEqual((await call("/api/ops?teamId=" + beta, { cookie: responder })).json.stats, {
      active: 0, critical: 0, resolved: 0, alerts: 0,
    });

    assert.equal((await call(endpoint, { method: "PATCH", body: { status: "INVESTIGATING" }, cookie: auditor })).status, 403);
    const coordinate = (body, cookie = lead) => call(endpoint + "/coordination", { method: "POST", cookie, body });
    assert.equal((await coordinate({ action: "handoff", ownerId: responderId, note: "Cross-team case transfer" })).status, 400);
    assert.equal((await coordinate({ action: "handoff", ownerId: leadId, note: "Identity team review" })).status, 200);
    assert.equal((await coordinate({ action: "check", step: 0, checked: true })).status, 200);
    await pool.query("UPDATE ops.cases SET ack_due_at = now() - interval '1 minute' WHERE case_id = $1", [caseId]);
    await until(async () => (await call(endpoint, { cookie: lead })).json.case?.escalated_at);
    assert.equal((await coordinate({ action: "acknowledge" })).status, 200);
    assert.equal((await call(endpoint, { method: "PATCH", body: { status: "INVESTIGATING" }, cookie: lead })).status, 200);
    const evidence = await call(endpoint + "/evidence", {
      method: "POST", cookie: lead, body: { summary: "Verified from analyst@example.com", restricted: "Synthetic private case note" },
    });
    assert.equal(evidence.status, 201, JSON.stringify(evidence.json));
    targets.push(evidence.json.evidenceId);
    const restricted = endpoint + "/evidence?id=" + evidence.json.evidenceId;
    assert.equal((await call(restricted, { cookie: auditor })).status, 403);
    assert.equal((await call(restricted, { cookie: responder })).status, 404);
    assert.equal((await call(restricted, { cookie: lead })).json.detail, "Synthetic private case note");
    const exportResult = await call(endpoint + "?format=json", { cookie: lead });
    assert.equal(exportResult.status, 200);
    assert.match(exportResult.headers.get("content-disposition"), /^attachment/);
    assert.doesNotMatch(JSON.stringify(exportResult.json), /Synthetic private case note|analyst@example.com/);
    assert.equal((await call(endpoint, {
      method: "PATCH", body: { status: "RESOLVED", resolution: "Reviewed simulated policy change." }, cookie: lead,
    })).status, 200);
    assert.equal((await coordinate({ action: "followup", title: "Update permission review", ownerId: leadId, dueOn: "2024-01-02" })).status, 200);
    const report = await call("/api/ops/reports?team=" + alpha, { cookie: lead });
    assert.equal(report.status, 200, JSON.stringify(report.json));
    assert.equal(report.json.reliability.processed, 2);
    assert.equal(report.json.reliability.duplicates, 1);
    assert.equal(report.json.followups[0].title, "Update permission review");
    assert.equal((await coordinate({ action: "complete", followupId: report.json.followups[0].followup_id })).status, 200);
    const postmortem = await fetch(new URL(endpoint + "?format=postmortem", base), { headers: { cookie: lead } });
    assert.equal(postmortem.status, 200);
    const draft = await postmortem.text();
    assert.match(draft, /Reviewed simulated policy change/);
    assert.match(draft, /\[x\] Update permission review/);
    assert.doesNotMatch(draft, /Synthetic private case note/);
    const scopedAudit = await call("/api/ops/audit?team=" + alpha, { cookie: auditor });
    assert.ok(scopedAudit.json.audit.some((item) => item.action === "RESTRICTED_EVIDENCE_VIEWED"));
    assert.ok(scopedAudit.json.audit.some((item) => item.action === "POSTMORTEM_EXPORTED"));
    const systemAudit = await call("/api/ops/audit?action=DENIED", { cookie: admin });
    assert.ok(systemAudit.json.audit.some((item) => item.action === "EXPORT_DENIED" && item.target === caseId));

    const direct = await pool.connect();
    try {
      await direct.query("BEGIN");
      await direct.query("SET LOCAL ROLE tracepredict_ops");
      await direct.query("SELECT set_config('tracepredict.actor_id', $1, true)", [String(responderId)]);
      assert.equal((await direct.query("SELECT case_id FROM ops.cases WHERE case_id = $1", [caseId])).rowCount, 0);
      assert.equal((await direct.query("SELECT detail FROM ops.restricted_evidence WHERE evidence_id = $1", [evidence.json.evidenceId])).rowCount, 0);
    } finally {
      await direct.query("ROLLBACK");
      direct.release();
    }

    assert.equal((await settings({ action: "revoke", sourceId: source.json.sourceId })).status, 200);
    assert.equal((await signed(source.json, { ...event, eventId: "revoked" })).status, 401);
    assert.equal((await settings({ action: "retention", teamId: alpha, days: 7 })).status, 200);
    await pool.query("UPDATE ops.evidence SET recorded_at = now() - interval '8 days' WHERE evidence_id = $1", [evidence.json.evidenceId]);
    await until(async () => {
      const current = await call(endpoint, { cookie: lead });
      return current.json.evidence?.some((item) => item.evidence_id === evidence.json.evidenceId && !item.has_restricted);
    });
    assert.equal((await call(restricted, { cookie: lead })).status, 404);
    const delivery = randomUUID();
    await pool.query(
      `INSERT INTO ops.deliveries (delivery_id, team_id, source_id, event_id, payload_hash, payload, attempts, available_at)
       VALUES ($1, $2, $3, 'fixture-failed', 'synthetic', '{}'::jsonb, 4, now())`,
      [delivery, alpha, secondSource.json.sourceId],
    );
    await until(async () => (await pool.query("SELECT status FROM ops.deliveries WHERE delivery_id = $1", [delivery])).rows[0]?.status === "FAILED");
    assert.equal((await call("/api/ops/reports", { method: "POST", cookie: lead, body: { deliveryId: delivery } })).status, 403);
    await pool.query("UPDATE ops.deliveries SET payload = $2 WHERE delivery_id = $1",
      [delivery, { ...event, eventId: "fixture-failed" }]);
    assert.equal((await call("/api/ops/reports", { method: "POST", cookie: admin, body: { deliveryId: delivery } })).status, 200);
    await until(async () => (await pool.query("SELECT status FROM ops.deliveries WHERE delivery_id = $1", [delivery])).rows[0]?.status === "PROCESSED");
    assert.equal((await call("/api/predictions/outcomes", { cookie: admin })).status, 200);
    assert.equal((await settings({ action: "remove", teamId: alpha, userId: leadId })).status, 200);
    assert.equal((await call(endpoint, { cookie: lead })).status, 404);
  } finally {
    try {
      for (const table of ["audit", "restricted_evidence", "evidence", "alerts", "deliveries", "cases", "sources", "members", "teams"]) {
        await pool.query(`DELETE FROM ops.${table} WHERE team_id = ANY($1::uuid[])`, [teams]);
      }
      await pool.query("DELETE FROM ops.audit WHERE team_id IS NULL AND target = ANY($1::uuid[])", [targets]);
      await pool.query("DELETE FROM ops.runbooks WHERE runbook_id = ANY($1::uuid[])", [runbookVersions]);
    } finally {
      await pool.end();
    }
  }
});
