import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AuthError, HttpError, handleError } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { resourceId } from "@/lib/ops/access";
import { alertInput } from "@/lib/ops/contracts";
import { redactSummary } from "@/lib/ops/redaction";
import { alertHash, checkSignature, readAlertBody } from "@/lib/ops/webhook";

export async function POST(req: Request, { params }: { params: Promise<{ source: string }> }) {
  try {
    const sourceId = resourceId((await params).source).toLowerCase();
    const raw = await readAlertBody(req);
    checkSignature(req, sourceId, raw);
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new HttpError(400, "Invalid alert JSON");
    }
    const alert = alertInput.parse(payload);
    const hash = alertHash(JSON.stringify(alert));

    const result = await withTransaction(async (client) => {
      const { rows: [source] } = await client.query<{ team_id: string }>(
        "SELECT team_id FROM ops.sources WHERE source_id = $1 AND enabled FOR UPDATE", [sourceId],
      );
      if (!source) throw new AuthError(401, "Alert source is disabled or unknown");
      const { rows: [previous] } = await client.query<{ delivery_id: string; case_id: string | null; payload_hash: string }>(
        "SELECT delivery_id, case_id, payload_hash FROM ops.deliveries WHERE source_id = $1 AND event_id = $2",
        [sourceId, alert.eventId],
      );
      if (previous) {
        if (previous.payload_hash !== hash) throw new HttpError(409, "Event ID already used for a different alert");
        await client.query("UPDATE ops.deliveries SET duplicate_count = duplicate_count + 1 WHERE delivery_id = $1", [previous.delivery_id]);
        return { deliveryId: previous.delivery_id, caseId: previous.case_id, duplicate: true };
      }
      // Preserve idempotence across the migration from synchronous ingestion.
      const { rows: [old] } = await client.query<{ case_id: string; payload_hash: string }>(
        "SELECT case_id, payload_hash FROM ops.alerts WHERE source_id = $1 AND external_id = $2",
        [sourceId, alert.eventId],
      );
      if (old) {
        if (old.payload_hash !== hash) throw new HttpError(409, "Event ID already used for a different alert");
        return { deliveryId: null, caseId: old.case_id, duplicate: true };
      }
      const [service] = (await client.query("SELECT 1 FROM services WHERE service_id = $1", [alert.serviceId])).rows;
      if (!service) throw new HttpError(400, "Unknown service");
      const deliveryId = randomUUID();
      await client.query(
        `INSERT INTO ops.deliveries (delivery_id, team_id, source_id, event_id, payload_hash, payload)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [deliveryId, source.team_id, sourceId, alert.eventId, hash, {
          ...alert, title: redactSummary(alert.title).slice(0, 160), message: redactSummary(alert.message).slice(0, 600),
        }],
      );
      return { deliveryId, caseId: null, duplicate: false };
    });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 202 });
  } catch (error) {
    return handleError(error);
  }
}
