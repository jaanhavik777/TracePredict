import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, handleError, hashPassword, setSessionCookie, signSession } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { acceptInvite, addWorkspaceService, limitAuth, productSignupEnabled } from "@/lib/product";
import { jsonBody } from "@/lib/ops/access";

const input = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(150).transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(72).refine((value) => Buffer.byteLength(value) <= 72, "Use at most 72 bytes"),
  workspace: z.string().trim().min(2).max(80).optional(),
  invite: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).refine((value) => value.invite || value.workspace, { message: "Choose a workspace name", path: ["workspace"] });

export async function POST(req: NextRequest) {
  try {
    const body = input.parse(await jsonBody(req));
    if (!body.invite && !productSignupEnabled()) throw new HttpError(503, "Workspace registration is currently closed");
    await limitAuth(req, "signup", 12);
    const hash = await hashPassword(body.password);
    const user = await withTransaction(async (client) => {
      const { rows: [account] } = await client.query<{ user_id: number }>(
        `INSERT INTO users (role_id, full_name, email, password_hash)
         SELECT role_id, $1, $2, $3 FROM roles WHERE role_name = 'CUSTOMER' RETURNING user_id`,
        [body.fullName, body.email, hash],
      );
      if (body.invite) {
        await acceptInvite(client, body.invite, body.email, account.user_id);
      } else {
        const teamId = randomUUID();
        await client.query("INSERT INTO ops.teams (team_id, name, customer_workspace) VALUES ($1, $2, TRUE)", [teamId, body.workspace]);
        await client.query("INSERT INTO ops.members (team_id, user_id, role) VALUES ($1, $2, 'LEAD')", [teamId, account.user_id]);
        await addWorkspaceService(client, teamId, "Application");
        await client.query("INSERT INTO ops.audit (team_id, actor_id, action) VALUES ($1, $2, 'WORKSPACE_CREATED')", [teamId, account.user_id]);
      }
      return { userId: account.user_id, role: "CUSTOMER" as const, fullName: body.fullName, email: body.email };
    });
    const response = NextResponse.json(user, { status: 201 });
    setSessionCookie(response, await signSession(user));
    return response;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return handleError(new HttpError(409, "An account with this email already exists. Sign in to continue."));
    return handleError(error);
  }
}
