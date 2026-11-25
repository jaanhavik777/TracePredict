import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, HttpError, handleError } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { addWorkspaceService, digest } from "@/lib/product";
import { actor, audit, jsonBody, workspace } from "@/lib/ops/access";
import { acceptDelivery } from "@/lib/ops/intake";
import { webhookKey } from "@/lib/ops/webhook";

const teamId = z.string().uuid();
const name = z.string().trim().min(2).max(80);
const serviceId = z.number().int().positive();
const repo = z.string().trim().max(140).regex(/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/)
  .refine((value) => ![".", ".."].includes(value.split("/")[1]));
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("service"), teamId, name }),
  z.object({ action: z.literal("invite"), teamId, email: z.string().trim().email().max(150), role: z.enum(["RESPONDER", "AUDITOR"]) }),
  z.object({ action: z.literal("signed"), teamId, name, serviceId }),
  z.object({ action: z.literal("github"), teamId, name, serviceId, repository: repo }),
  z.object({ action: z.literal("revoke"), teamId, sourceId: z.string().uuid() }),
  z.object({ action: z.literal("test"), teamId, sourceId: z.string().uuid() }),
]);

export async function GET(req: NextRequest) {
  try {
    const user = await actor(req);
    const result = await workspace(user.id, async (client) => {
      const { rows: teams } = await client.query(
        "SELECT team_id, name, ops.access(team_id) AS role FROM ops.teams WHERE customer_workspace ORDER BY name",
      );
      const { rows: services } = await client.query("SELECT team_id, service_id, name FROM ops.team_services ORDER BY name");
      const { rows: connections } = await client.query(
        `SELECT s.source_id, s.team_id, s.name, s.enabled, s.provider, s.repository, s.service_id,
           (SELECT max(d.received_at) FROM ops.deliveries d WHERE d.source_id = s.source_id) AS last_delivery
         FROM ops.sources s JOIN ops.teams t USING (team_id)
         WHERE t.customer_workspace AND ops.access(s.team_id) IN ('ADMIN', 'LEAD') ORDER BY s.name`,
      );
      return { teams, services, connections };
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await actor(req);
    const body = command.parse(await jsonBody(req));
    const result = await withTransaction(async (client) => {
      await client.query("SELECT set_config('tracepredict.actor_id', $1, true)", [String(user.id)]);
      const [team] = (await client.query<{ role: string | null }>(
        "SELECT ops.access(team_id) AS role FROM ops.teams WHERE team_id = $1 AND customer_workspace", [body.teamId],
      )).rows;
      if (!team?.role) throw new HttpError(404, "Workspace not found");
      if (!["LEAD", "ADMIN"].includes(team.role)) throw new AuthError(403, "Only workspace leads can manage connections");
      switch (body.action) {
        case "service":
          return { serviceId: await addWorkspaceService(client, body.teamId, body.name) };
        case "invite": {
          const token = randomBytes(32).toString("hex");
          await client.query(
            "INSERT INTO ops.workspace_invites (token_hash, team_id, email, role) VALUES ($1, $2, $3, $4)",
            [digest(token), body.teamId, body.email.toLowerCase(), body.role],
          );
          await audit(client, body.teamId, user.id, "INVITE_CREATED", body.teamId);
          return { invitePath: "/signup?invite=" + token };
        }
        case "test": {
          const { rows: [source] } = await client.query<{ provider: "signed" | "github"; service_id: number }>(
            "SELECT provider, service_id FROM ops.sources WHERE team_id = $1 AND source_id = $2 AND enabled",
            [body.teamId, body.sourceId],
          );
          if (!source) throw new HttpError(404, "Enabled connection not found");
          return { test: source };
        }
        case "revoke": {
          const update = await client.query(
            "UPDATE ops.sources SET enabled = FALSE WHERE team_id = $1 AND source_id = $2 AND enabled", [body.teamId, body.sourceId],
          );
          if (!update.rowCount) throw new HttpError(404, "Enabled connection not found");
          await audit(client, body.teamId, user.id, "SOURCE_REVOKED", body.sourceId);
          return { revoked: true };
        }
        default: {
          const { rowCount } = await client.query(
            "SELECT FROM ops.team_services WHERE team_id = $1 AND service_id = $2", [body.teamId, body.serviceId],
          );
          if (!rowCount) throw new HttpError(400, "Choose a service from this workspace");
          const id = randomUUID();
          const key = webhookKey(id);
          const repository = body.action === "github" ? body.repository : null;
          await client.query(
            "INSERT INTO ops.sources (source_id, team_id, name, provider, service_id, repository) VALUES ($1, $2, $3, $4, $5, $6)",
            [id, body.teamId, body.name, body.action, body.serviceId, repository],
          );
          await audit(client, body.teamId, user.id, "SOURCE_CREATED", id);
          return { key, path: `/api/webhooks/alerts/${repository ? "github/" : ""}${id}` };
        }
      }
    });
    if (body.action === "test" && result.test) {
      const eventId = randomUUID();
      const delivery = await acceptDelivery(body.sourceId, result.test.provider, () => ({
        alert: { eventId, serviceId: result.test.service_id, environment: "development", title: "Connection test issue",
          severity: 2, category: "OTHER", occurredAt: new Date().toISOString(), message: "Test delivery from workspace setup" },
        group: eventId,
      }));
      return NextResponse.json(delivery, { status: 202 });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}
