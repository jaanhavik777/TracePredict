import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "@/lib/db";
import { audit } from "./access";
import { alertInput } from "./contracts";
import { caseEvent } from "./coordination";

type Delivery = {
  delivery_id: string; team_id: string; source_id: string;
  payload: unknown; payload_hash: string; received_at: Date; attempts: number;
};

async function processAlert(client: PoolClient, job: Delivery) {
  const alert = alertInput.parse(job.payload);
  const teamId = job.team_id;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [JSON.stringify([teamId, alert.serviceId, alert.environment, alert.category])]);
  const { rows: [open] } = await client.query<{ case_id: string }>(
    `SELECT case_id FROM ops.cases
     WHERE team_id = $1 AND service_id = $2 AND environment = $3 AND category = $4
       AND status <> 'RESOLVED' AND last_signal_at BETWEEN $5::timestamptz - INTERVAL '15 minutes'
         AND $5::timestamptz + INTERVAL '15 minutes'
     ORDER BY last_signal_at DESC LIMIT 1 FOR UPDATE`,
    [teamId, alert.serviceId, alert.environment, alert.category, job.received_at],
  );
  const caseId = open?.case_id ?? randomUUID();
  if (open) {
    await client.query(
      `UPDATE ops.cases SET last_signal_at = greatest(last_signal_at, $2), severity = greatest(severity, $3)
       WHERE case_id = $1`, [caseId, job.received_at, alert.severity],
    );
  } else {
    await client.query(
      `INSERT INTO ops.cases (case_id, team_id, service_id, environment, title, category, severity, last_signal_at, opened_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [caseId, teamId, alert.serviceId, alert.environment, alert.title, alert.category, alert.severity, job.received_at],
    );
    await audit(client, teamId, null, "CASE_GROUP_OPENED", caseId);
  }
  await client.query(
    `INSERT INTO ops.alerts (alert_id, case_id, source_id, team_id, external_id, payload_hash, title, message, severity, occurred_at, received_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [randomUUID(), caseId, job.source_id, teamId, alert.eventId, job.payload_hash, alert.title, alert.message,
      alert.severity, alert.occurredAt, job.received_at],
  );
  await caseEvent(client, { case_id: caseId, team_id: teamId }, null, "ALERT_RECEIVED", alert.title);
  await audit(client, teamId, null, "ALERT_RECEIVED", caseId);
  return caseId;
}

export async function workDelivery() {
  return withTransaction(async (client) => {
    const { rows: [job] } = await client.query<Delivery>(
      `SELECT delivery_id, team_id, source_id, payload, payload_hash, received_at, attempts
       FROM ops.deliveries WHERE status = 'QUEUED' AND available_at <= clock_timestamp()
       ORDER BY available_at, delivery_id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!job) return false;
    await client.query("SAVEPOINT process_delivery");
    try {
      const caseId = await processAlert(client, job);
      await client.query(
        `UPDATE ops.deliveries SET status = 'PROCESSED', case_id = $2, attempts = attempts + 1,
         processed_at = clock_timestamp(), failure_code = NULL, payload = NULL WHERE delivery_id = $1`,
        [job.delivery_id, caseId],
      );
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT process_delivery");
      const attempts = job.attempts + 1;
      const code = (error as { code?: unknown }).code;
      const failure = typeof code === "string" && /^[A-Z0-9_]{5,25}$/.test(code) ? code : "PROCESSING_ERROR";
      await client.query(
        `UPDATE ops.deliveries SET attempts = $2, failure_code = $3,
         status = CASE WHEN $2 >= 5 THEN 'FAILED' ELSE 'QUEUED' END,
         available_at = clock_timestamp() + make_interval(secs => $4) WHERE delivery_id = $1`,
        [job.delivery_id, attempts, failure, 5 * 2 ** (attempts - 1)],
      );
      if (attempts >= 5) await audit(client, job.team_id, null, "DELIVERY_FAILED", job.delivery_id);
    }
    return true;
  });
}

export async function enforceCasePolicies() {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO ops.worker_health (worker, last_seen_at) VALUES ('operations', clock_timestamp())
       ON CONFLICT (worker) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
    );
    const { rows: overdue } = await client.query<{ case_id: string; team_id: string }>(
      `UPDATE ops.cases SET escalated_at = clock_timestamp()
       WHERE case_id IN (SELECT case_id FROM ops.cases
          WHERE status <> 'RESOLVED' AND acknowledged_at IS NULL AND escalated_at IS NULL
            AND ack_due_at < clock_timestamp() LIMIT 100 FOR UPDATE SKIP LOCKED)
       RETURNING case_id, team_id`,
    );
    for (const record of overdue) {
      await caseEvent(client, record, null, "ACK_ESCALATED", "Acknowledgement deadline passed");
      await audit(client, record.team_id, null, "ACK_ESCALATED", record.case_id);
    }
    const { rows: expired } = await client.query<{ evidence_id: string; team_id: string }>(
      `WITH expired AS (
        SELECT e.evidence_id FROM ops.evidence e JOIN ops.teams t USING (team_id)
        WHERE has_restricted AND e.recorded_at < clock_timestamp() - make_interval(days => t.retention_days)
        LIMIT 100 FOR UPDATE OF e SKIP LOCKED
      ), removed AS (
        DELETE FROM ops.restricted_evidence r USING expired x WHERE r.evidence_id = x.evidence_id RETURNING r.evidence_id
      )
      UPDATE ops.evidence e SET has_restricted = false FROM removed r WHERE e.evidence_id = r.evidence_id
      RETURNING e.evidence_id, e.team_id`,
    );
    for (const item of expired) await audit(client, item.team_id, null, "RESTRICTED_EVIDENCE_EXPIRED", item.evidence_id);
  });
}
