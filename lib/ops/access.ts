import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { z } from "zod";
import { AuthError, HttpError, getSession } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import type { SecurityCase, TeamRole } from "./contracts";

export function resourceId(value: string) {
  if (!z.string().uuid().safeParse(value).success) throw new HttpError(404, "Record not found");
  return value;
}

export function jsonBody(req: Request): Promise<unknown> {
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(400, "Send an application/json request");
  }
  return req.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body");
  });
}

export async function actor(req: NextRequest) {
  const session = await getSession(req);
  if (!session) throw new AuthError(401, "Not authenticated");
  const [record] = await query<{ user_id: number; role_name: string }>(
    `SELECT u.user_id, r.role_name FROM users u JOIN roles r USING (role_id)
     WHERE u.user_id = $1 AND u.is_active`, [session.userId],
  );
  if (!record) throw new AuthError(401, "Account is inactive");
  return { id: record.user_id, admin: record.role_name === "ADMIN" };
}

export function workspace<T>(userId: number, fn: (client: PoolClient) => Promise<T>) {
  return withTransaction(async (client) => {
    await client.query("SET LOCAL ROLE tracepredict_ops");
    await client.query("SELECT set_config('tracepredict.actor_id', $1, true)", [String(userId)]);
    return fn(client);
  });
}

export async function teamRole(client: PoolClient, teamId: string) {
  const result = await client.query<{ role: TeamRole | null }>(
    "SELECT ops.access($1) AS role FROM ops.teams WHERE team_id = $1", [teamId],
  );
  const role = result.rows[0]?.role;
  if (!role) throw new HttpError(404, "Team not found");
  return role;
}

export function requireWrite(role: TeamRole) {
  if (role === "AUDITOR") throw new AuthError(403, "Auditors have read-only case access");
}

export function requireSensitive(role: TeamRole) {
  if (role !== "ADMIN" && role !== "LEAD") throw new AuthError(403, "Lead access required");
}

export async function loadCase(client: PoolClient, caseId: string, lock = false) {
  const { rows: [record] } = await client.query<SecurityCase>(
    `SELECT c.*, s.service_name, t.name AS team_name FROM ops.cases c
     JOIN services s USING (service_id) JOIN ops.teams t USING (team_id) WHERE c.case_id = $1
     ${lock ? "FOR UPDATE OF c" : ""}`, [caseId],
  );
  if (!record) throw new HttpError(404, "Case not found");
  return record;
}

export async function loadWritableCase(client: PoolClient, caseId: string) {
  const record = await loadCase(client, caseId);
  requireWrite(await teamRole(client, record.team_id));
  return loadCase(client, caseId, true);
}

export async function audit(client: PoolClient, teamId: string | null, actorId: number | null, action: string, target: string | null) {
  await client.query(
    "INSERT INTO ops.audit (team_id, actor_id, action, target) VALUES ($1, $2, $3, $4)",
    [teamId, actorId, action, target],
  );
}

export async function auditDenied(error: unknown, actorId: number, action: string, target: string) {
  if ((error instanceof AuthError && error.status === 403) || (error instanceof HttpError && error.status === 404)) {
    await query(
      "INSERT INTO ops.audit (actor_id, action, target) VALUES ($1, $2, $3)",
      [actorId, action, target],
    );
  }
}
