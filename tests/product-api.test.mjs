import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
const app = new URL(process.env.TV_BASE_URL ?? "http://127.0.0.1:3037");
const db = new URL(process.env.DATABASE_URL);
const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (!local.has(app.hostname) || !local.has(db.hostname)) throw new Error("Use a disposable local app and database");

async function request(path, body, cookie, headers = {}) {
  const result = await fetch(new URL(path, app), {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const json = result.headers.get("content-type")?.includes("json") ? await result.json() : null;
  return { status: result.status, json, cookie: result.headers.get("set-cookie")?.split(";")[0] };
}

test("signup, repository issues, invitation, and workspace isolation", async () => {
  const pool = new pg.Pool({ connectionString: db.href });
  const suffix = randomUUID();
  const email = (name) => `test-${name}-${suffix}@example.test`;
  const payload = (name) => ({ fullName: "Test " + name, email: email(name), password: "local-fixture-password" });
  const teams = [];
  const serviceIds = [];
  const accountIds = [];
  const workspaceName = "Workspace test " + suffix;
  try {
    assert.equal((await request("/")).status, 200);
    assert.equal((await request("/demo")).status, 200);
    const first = await request("/api/auth/signup", { ...payload("lead"), workspace: workspaceName });
    const second = await request("/api/auth/signup", { ...payload("outsider"), workspace: workspaceName });
    for (const account of [first, second]) {
      assert.equal(account.status, 201, JSON.stringify(account.json));
      accountIds.push(account.json.userId);
    }
    const [one, two] = await Promise.all([first, second].map(async ({ cookie }) => {
      const detail = await request("/api/workspace", undefined, cookie);
      assert.equal(detail.status, 200, JSON.stringify(detail.json));
      assert.equal(detail.json.teams.length, 1);
      assert.equal(detail.json.services.length, 1);
      teams.push(detail.json.teams[0].team_id);
      serviceIds.push(detail.json.services[0].service_id);
      return { cookie, teamId: detail.json.teams[0].team_id, serviceId: detail.json.services[0].service_id };
    }));
    assert.notEqual(one.teamId, two.teamId);
    assert.equal((await request("/api/incidents", undefined, one.cookie)).status, 403);
    const credentials = await request("/api/workspace", {
      action: "github", name: "Example repo", teamId: one.teamId, serviceId: one.serviceId, repository: "test-org/example",
    }, one.cookie);
    assert.equal(credentials.status, 200, JSON.stringify({ status: credentials.status, error: credentials.json?.error }));
    assert.equal((await request("/api/workspace", {
      action: "signed", teamId: one.teamId, name: "Foreign service", serviceId: two.serviceId,
    }, one.cookie)).status, 400);
    assert.equal((await request("/api/workspace", {
      action: "signed", teamId: one.teamId, name: "Foreign workspace", serviceId: one.serviceId,
    }, two.cookie)).status, 404);
    function github(number, repository = "test-org/example") {
      const raw = JSON.stringify({ action: "opened", repository: { full_name: repository },
        issue: { number, title: "Example issue " + number, body: "ignored raw body", created_at: "2026-11-23T10:00:00Z" } });
      const signature = createHmac("sha256", credentials.json.key).update(raw).digest("hex");
      return request(credentials.json.path, raw, undefined, { "x-hub-signature-256": "sha256=" + signature, "x-github-event": "issues" });
    }
    assert.equal((await github(1, "other/example")).status, 403);
    assert.equal((await github(1)).status, 202);
    assert.equal((await github(1)).status, 200);
    assert.equal((await github(2)).status, 202);
    let cases = [];
    for (let i = 0; i < 40 && cases.length < 2; i++) {
      const result = await request("/api/ops", undefined, one.cookie);
      assert.equal(result.status, 200, JSON.stringify(result.json));
      cases = result.json.cases;
      if (cases.length < 2) await new Promise((resolve) => setTimeout(resolve, 350));
    }
    assert.equal(cases.length, 2);
    const endpoint = "/api/ops/cases/" + cases[0].case_id;
    const owned = await request(endpoint, undefined, one.cookie);
    assert.equal(owned.status, 200, JSON.stringify(owned.json));
    assert.match(owned.json.signals[0].issue_url, /^https:\/\/github\.com\/test-org\/example\/issues\/[12]$/);
    assert.doesNotMatch(JSON.stringify(owned.json), /ignored raw body/);
    assert.equal((await request(endpoint, undefined, two.cookie)).status, 404);
    assert.equal((await request("/api/ops/reports?team=" + one.teamId, undefined, two.cookie)).status, 404);
    assert.deepEqual((await request("/api/ops", undefined, two.cookie)).json.cases, []);

    const generic = await request("/api/workspace", {
      action: "signed", teamId: one.teamId, name: "Example alerting tool", serviceId: one.serviceId,
    }, one.cookie);
    assert.equal(generic.status, 200);
    assert.equal(generic.json.serviceId, one.serviceId);
    const body = JSON.stringify({ eventId: suffix, serviceId: one.serviceId, environment: "staging",
      category: "OTHER", severity: 2, title: "Signed connection test", message: "Sample alert", occurredAt: new Date().toISOString() });
    const time = String(Math.floor(Date.now() / 1000));
    const signed = createHmac("sha256", generic.json.key).update(time + "." + body).digest("hex");
    const genericDelivery = await request(generic.json.path, body, undefined, {
      "x-trace-timestamp": time, "x-trace-signature": "sha256=" + signed,
    });
    assert.equal(genericDelivery.status, 202);
    let genericStatus;
    for (let i = 0; i < 25; i++) {
      const { rows: [delivery] } = await pool.query("SELECT status FROM ops.deliveries WHERE delivery_id = $1", [genericDelivery.json.deliveryId]);
      genericStatus = delivery?.status;
      if (genericStatus === "PROCESSED") break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.equal(genericStatus, "PROCESSED");

    const evidence = await request(endpoint + "/evidence", { summary: "Integration evidence", restricted: "Private fixture detail" }, one.cookie);
    assert.equal(evidence.status, 201, JSON.stringify(evidence.json));
    const detailPath = endpoint + "/evidence?id=" + evidence.json.evidenceId;
    assert.equal((await request(detailPath, undefined, one.cookie)).json.detail, "Private fixture detail");
    assert.equal((await request(detailPath, undefined, two.cookie)).status, 404);
    if (process.env.TRACEPREDICT_EVIDENCE_KEY) {
      const { rows: [stored] } = await pool.query("SELECT detail FROM ops.restricted_evidence WHERE evidence_id = $1", [evidence.json.evidenceId]);
      assert.match(stored.detail, /^v1:/);
      assert.doesNotMatch(stored.detail, /Private fixture detail/);
    }

    const invitation = await request("/api/workspace", { action: "invite", teamId: one.teamId, email: email("invite"), role: "AUDITOR" }, one.cookie);
    assert.equal(invitation.status, 200);
    const invite = new URL(invitation.json.invitePath, app).searchParams.get("invite");
    assert.equal((await request("/api/workspace/join", { invite }, two.cookie)).status, 400);
    const joined = await request("/api/auth/signup", { ...payload("invite"), invite });
    assert.equal(joined.status, 201, JSON.stringify(joined.json));
    accountIds.push(joined.json.userId);
    assert.equal((await request("/api/workspace/join", { invite }, joined.cookie)).status, 400);
    assert.equal((await request(endpoint, undefined, joined.cookie)).status, 200);
  } finally {
    try {
      await pool.query("DELETE FROM ops.audit WHERE actor_id = ANY($1::int[])", [accountIds]);
      for (const table of ["audit", "restricted_evidence", "evidence", "alerts", "deliveries", "cases", "workspace_invites", "sources", "members", "team_services", "teams"]) {
        await pool.query(`DELETE FROM ops.${table} WHERE team_id = ANY($1::uuid[])`, [teams]);
      }
      await pool.query("DELETE FROM services WHERE service_id = ANY($1::int[]) AND service_name LIKE 'workspace/%'", [serviceIds]);
      await pool.query("DELETE FROM users WHERE user_id = ANY($1::int[])", [accountIds]);
    } finally { await pool.end(); }
  }
});
