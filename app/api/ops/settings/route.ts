import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, HttpError, handleError } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { actor, audit, jsonBody } from "@/lib/ops/access";
import { categories, memberRoles } from "@/lib/ops/contracts";
import { redactSummary } from "@/lib/ops/redaction";
import { webhookKey } from "@/lib/ops/webhook";

const teamId = z.string().uuid();
const name = z.string().trim().min(2).max(80);
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("team"), name }),
  z.object({ action: z.literal("membership"), teamId, userId: z.number().int().positive(), role: z.enum(memberRoles) }),
  z.object({ action: z.literal("remove"), teamId, userId: z.number().int().positive() }),
  z.object({ action: z.literal("source"), teamId, name }),
  z.object({ action: z.literal("revoke"), sourceId: z.string().uuid() }),
  z.object({ action: z.literal("retention"), teamId, days: z.number().int().min(7).max(365) }),
  z.object({ action: z.literal("runbook"), category: z.enum(categories), name, steps: z.array(z.string().trim().min(3).max(250)).min(1).max(20) }),
]);

export async function GET(req: NextRequest) {
  try {
    if (!(await actor(req)).admin) throw new AuthError(403, "Administrator access required");
    const [members, sources, runbooks, retention] = await Promise.all([
      query(`SELECT m.team_id, m.user_id, m.role, u.full_name, u.is_active
             FROM ops.members m JOIN users u USING (user_id) ORDER BY u.full_name`),
      query(`SELECT source_id, team_id, name, enabled, created_at
             FROM ops.sources ORDER BY created_at DESC`),
      query(`SELECT DISTINCT ON (category) category, name, version, steps FROM ops.runbooks ORDER BY category, version DESC`),
      query("SELECT team_id, retention_days FROM ops.teams ORDER BY name"),
    ]);
    return NextResponse.json({ members, sources, runbooks, retention }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await actor(req);
    if (!user.admin) throw new AuthError(403, "Administrator access required");
    const body = actions.parse(await jsonBody(req));
    const response = await withTransaction(async (client) => {
      switch (body.action) {
        case "team": {
          const id = randomUUID();
          await client.query("INSERT INTO ops.teams (team_id, name) VALUES ($1, $2)", [id, body.name]);
          await audit(client, id, user.id, "TEAM_CREATED", id);
          return { teamId: id };
        }
        case "membership":
          await client.query(
            `INSERT INTO ops.members (team_id, user_id, role) VALUES ($1, $2, $3)
             ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
            [body.teamId, body.userId, body.role],
          );
          if (body.role === "AUDITOR") {
            await client.query("UPDATE ops.cases SET owner_id = NULL WHERE team_id = $1 AND owner_id = $2", [body.teamId, body.userId]);
          }
          await client.query(
            "INSERT INTO ops.audit (team_id, actor_id, action, subject_user_id, membership_role) VALUES ($1, $2, 'MEMBERSHIP_SET', $3, $4)",
            [body.teamId, user.id, body.userId, body.role],
          );
          return { saved: true };
        case "remove": {
          const deleted = await client.query<{ role: string }>(
            "DELETE FROM ops.members WHERE team_id = $1 AND user_id = $2 RETURNING role", [body.teamId, body.userId],
          );
          if (!deleted.rowCount) throw new HttpError(404, "Membership not found");
          await client.query("UPDATE ops.cases SET owner_id = NULL WHERE team_id = $1 AND owner_id = $2", [body.teamId, body.userId]);
          await client.query(
            "INSERT INTO ops.audit (team_id, actor_id, action, subject_user_id, membership_role) VALUES ($1, $2, 'MEMBERSHIP_REMOVED', $3, $4)",
            [body.teamId, user.id, body.userId, deleted.rows[0].role],
          );
          return { saved: true };
        }
        case "source": {
          const id = randomUUID();
          const key = webhookKey(id);
          await client.query("INSERT INTO ops.sources (source_id, team_id, name) VALUES ($1, $2, $3)", [id, body.teamId, body.name]);
          await audit(client, body.teamId, user.id, "SOURCE_CREATED", id);
          return { sourceId: id, path: `/api/webhooks/alerts/${id}`, key };
        }
        case "revoke": {
          const { rows: [source] } = await client.query<{ team_id: string }>(
            "UPDATE ops.sources SET enabled = FALSE WHERE source_id = $1 AND enabled RETURNING team_id", [body.sourceId],
          );
          if (!source) throw new HttpError(404, "Enabled source not found");
          await audit(client, source.team_id, user.id, "SOURCE_REVOKED", body.sourceId);
          return { saved: true };
        }
        case "retention": {
          const change = await client.query("UPDATE ops.teams SET retention_days = $2 WHERE team_id = $1", [body.teamId, body.days]);
          if (!change.rowCount) throw new HttpError(404, "Team not found");
          await audit(client, body.teamId, user.id, "RETENTION_POLICY_CHANGED", body.teamId);
          return { saved: true };
        }
        case "runbook": {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["runbook:" + body.category]);
          const id = randomUUID();
          await client.query(
            `INSERT INTO ops.runbooks (runbook_id, category, version, name, steps)
             SELECT $1, $2, coalesce(max(version), 0) + 1, $3, $4 FROM ops.runbooks WHERE category = $2`,
            [id, body.category, redactSummary(body.name).slice(0, 80), body.steps.map((step) => redactSummary(step).slice(0, 250))],
          );
          await audit(client, null, user.id, "RUNBOOK_PUBLISHED", id);
          return { saved: true };
        }
      }
    });
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}
