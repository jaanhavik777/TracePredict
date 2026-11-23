import type { PoolClient } from "pg";

const identity = "6bae44c1-b61e-4c52-bb06-69ce448a0382";
const operations = "6bae44c1-b61e-4c52-bb06-69ce448a0383";
const identityCase = "6bae44c1-b61e-4c52-bb06-69ce448a0384";
const operationsCase = "6bae44c1-b61e-4c52-bb06-69ce448a0385";
const source = "6bae44c1-b61e-4c52-bb06-69ce448a0386";

export async function withDemo(client: PoolClient) {
  // Demo workspaces are explicit and can coexist with other teams.
  await client.query(
    "INSERT INTO ops.teams (team_id, name) VALUES ($1, 'Identity & Trust'), ($2, 'Platform Reliability') ON CONFLICT (team_id) DO NOTHING",
    [identity, operations],
  );
  await client.query(
    `INSERT INTO ops.members (team_id, user_id, role)
     SELECT CASE WHEN email = 'krishna@tracevault.io' THEN $2::uuid ELSE $1::uuid END, user_id,
       CASE email WHEN 'jaanhavi@tracevault.io' THEN 'LEAD' WHEN 'kushi@tracevault.io' THEN 'AUDITOR' ELSE 'RESPONDER' END
     FROM users WHERE email IN ('jaanhavi@tracevault.io', 'kushi@tracevault.io', 'krishna@tracevault.io')
     ON CONFLICT DO NOTHING`, [identity, operations],
  );
  await client.query(
    "INSERT INTO ops.sources (source_id, team_id, name) VALUES ($1, $2, 'Identity monitor demo') ON CONFLICT DO NOTHING",
    [source, identity],
  );
  await client.query(
    `INSERT INTO ops.cases (case_id, team_id, service_id, environment, title, category, severity, status, last_signal_at)
     SELECT $1, $2, service_id, 'production', 'Unexpected permission changes in Auth Service', 'ACCESS', 4, 'INVESTIGATING',
       CURRENT_TIMESTAMP - INTERVAL '20 minutes' FROM services WHERE service_name = 'Auth Service'
     ON CONFLICT DO NOTHING`, [identityCase, identity],
  );
  await client.query(
    `INSERT INTO ops.cases (case_id, team_id, service_id, environment, title, category, severity)
     SELECT $1, $2, service_id, 'production', 'Order Service availability review', 'AVAILABILITY', 2
     FROM services WHERE service_name = 'Order Service' ON CONFLICT DO NOTHING`, [operationsCase, operations],
  );
  await client.query(
    `INSERT INTO ops.alerts (alert_id, case_id, source_id, team_id, external_id, payload_hash, title, message, severity, occurred_at)
     SELECT '6bae44c1-b61e-4c52-bb06-69ce448a0387', case_id, $1, team_id, 'demo-seed', 'sample',
       'Unexpected role membership change', 'Identity monitor observed a privileged role membership change outside a planned window.',
       4, CURRENT_TIMESTAMP - INTERVAL '20 minutes'
     FROM ops.cases WHERE case_id = $2 ON CONFLICT DO NOTHING`, [source, identityCase],
  );
  const evidenceId = "6bae44c1-b61e-4c52-bb06-69ce448a0388";
  const { rowCount } = await client.query(
    `INSERT INTO ops.evidence (evidence_id, case_id, team_id, author_id, summary, has_restricted)
     SELECT $1, c.case_id, c.team_id, u.user_id, 'Permission change verified in the identity audit log. Internal reference held in restricted evidence.', TRUE
     FROM ops.cases c CROSS JOIN users u WHERE c.case_id = $2 AND u.email = 'jaanhavi@tracevault.io'
     ON CONFLICT DO NOTHING`, [evidenceId, identityCase],
  );
  if (rowCount) {
    await client.query(
      `INSERT INTO ops.restricted_evidence (evidence_id, team_id, detail)
       VALUES ($1, $2, 'Synthetic audit reference: IDENTITY-DEMO-042. Actor reference: fictional-demo-reviewer.')`,
      [evidenceId, identity],
    );
    await client.query("INSERT INTO ops.audit (team_id, action, target) VALUES ($1, 'ALERT_RECEIVED', $2), ($1, 'EVIDENCE_ADDED', $3)",
      [identity, identityCase, evidenceId]);
  }
}
