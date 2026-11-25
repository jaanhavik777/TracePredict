import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { AuthError, HttpError } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { alertInput } from "./contracts";
import { redactSummary } from "./redaction";
import { alertHash } from "./webhook";

type Alert = z.infer<typeof alertInput>;
type Source = { team_id: string; provider: string; service_id: number | null; repository: string | null };

export async function acceptDelivery(
  sourceId: string, provider: "signed" | "github",
  build: (source: Source) => { alert: Alert; group?: string; issueUrl?: string } | null,
) {
  return withTransaction(async (client) => {
    const { rows: [source] } = await client.query<Source>(
      "SELECT team_id, provider, service_id, repository FROM ops.sources WHERE source_id = $1 AND enabled FOR UPDATE", [sourceId],
    );
    if (!source || source.provider !== provider) throw new AuthError(401, "Alert source is disabled or unknown");
    const input = build(source);
    if (!input) return { ignored: true as const };
    const { alert, group, issueUrl } = input;
    if (source.service_id !== null && alert.serviceId !== source.service_id) throw new HttpError(400, "Use the service assigned to this connection");
    const hash = alertHash(JSON.stringify(alert));
    const { rows: [previous] } = await client.query<{ delivery_id: string; case_id: string | null; payload_hash: string }>(
      "SELECT delivery_id, case_id, payload_hash FROM ops.deliveries WHERE source_id = $1 AND event_id = $2",
      [sourceId, alert.eventId],
    );
    if (previous) {
      if (previous.payload_hash !== hash) throw new HttpError(409, "Event ID already used for a different alert");
      await client.query("UPDATE ops.deliveries SET duplicate_count = duplicate_count + 1 WHERE delivery_id = $1", [previous.delivery_id]);
      return { deliveryId: previous.delivery_id, caseId: previous.case_id, duplicate: true };
    }
    const { rows: [old] } = await client.query<{ case_id: string; payload_hash: string }>(
      "SELECT case_id, payload_hash FROM ops.alerts WHERE source_id = $1 AND external_id = $2", [sourceId, alert.eventId],
    );
    if (old) {
      if (old.payload_hash !== hash) throw new HttpError(409, "Event ID already used for a different alert");
      return { deliveryId: null, caseId: old.case_id, duplicate: true };
    }
    const { rowCount } = await client.query(
      `SELECT FROM services s WHERE s.service_id = $1 AND
        (NOT EXISTS (SELECT FROM ops.teams WHERE team_id = $2 AND customer_workspace)
         OR EXISTS (SELECT FROM ops.team_services WHERE service_id = s.service_id AND team_id = $2))
         AND NOT EXISTS (SELECT FROM ops.team_services WHERE service_id = s.service_id AND team_id <> $2)`,
      [alert.serviceId, source.team_id],
    );
    if (!rowCount) throw new HttpError(400, "Unknown workspace service");
    const deliveryId = randomUUID();
    await client.query(
      `INSERT INTO ops.deliveries (delivery_id, team_id, source_id, event_id, payload_hash, payload, source_group)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [deliveryId, source.team_id, sourceId, alert.eventId, hash, {
        ...alert, title: redactSummary(alert.title).slice(0, 160), message: redactSummary(alert.message).slice(0, 600),
        ...(issueUrl ? { issueUrl } : {}),
      }, group ?? null],
    );
    return { deliveryId, caseId: null, duplicate: false };
  });
}
