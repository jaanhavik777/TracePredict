import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { HttpError } from "@/lib/auth";

export const productSignupEnabled = () => process.env.TRACEPREDICT_SIGNUP !== "disabled";
export const deploymentMode = () => process.env.TRACEPREDICT_HOSTED === "1";
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function limitAuth(req: Request, scope: "signup" | "login", max: number) {
  // Hosted ingress replaces the header before forwarding. Local installations keep a shared bucket.
  const ip = deploymentMode() ? req.headers.get("x-trace-client")?.slice(0, 64) ?? "unknown" : "local";
  const key = digest(ip);
  const [record] = await query<{ attempts: number }>(
    `INSERT INTO ops.auth_limits (scope, subject, window_start) VALUES ($1, $2, date_trunc('hour', now()))
     ON CONFLICT (scope, subject) DO UPDATE SET
       attempts = CASE WHEN ops.auth_limits.window_start = EXCLUDED.window_start THEN ops.auth_limits.attempts + 1 ELSE 1 END,
       window_start = EXCLUDED.window_start RETURNING attempts`,
    [scope, key],
  );
  if (record.attempts > max) throw new HttpError(429, "Too many attempts. Try again later.");
}

export async function addWorkspaceService(client: PoolClient, teamId: string, name: string) {
  // The legacy catalog uses only an opaque identifier for workspace services.
  const { rows: [service] } = await client.query<{ service_id: number }>(
    `INSERT INTO services (service_name, criticality, service_status)
     VALUES ($1, 'MEDIUM', 'ACTIVE') RETURNING service_id`,
    ["workspace/" + randomUUID()],
  );
  await client.query("INSERT INTO ops.team_services (team_id, service_id, name) VALUES ($1, $2, $3)",
    [teamId, service.service_id, name]);
  return service.service_id;
}

export async function acceptInvite(client: PoolClient, token: string, email: string, userId: number) {
  const { rows: [invite] } = await client.query<{ team_id: string; role: string }>(
    `DELETE FROM ops.workspace_invites WHERE token_hash = $1 AND email = $2
     AND expires_at > clock_timestamp() RETURNING team_id, role`, [digest(token), email.toLowerCase()],
  );
  if (!invite) throw new HttpError(400, "This invitation is invalid, expired, or assigned to another email");
  await client.query(
    "INSERT INTO ops.members (team_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [invite.team_id, userId, invite.role],
  );
  await client.query("INSERT INTO ops.audit (team_id, actor_id, action) VALUES ($1, $2, 'INVITE_ACCEPTED')", [invite.team_id, userId]);
  return invite.team_id;
}
