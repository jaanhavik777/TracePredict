import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, handleError, AuthError } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { actor, jsonBody } from "@/lib/ops/access";
import { acceptInvite } from "@/lib/product";

export async function POST(req: NextRequest) {
  try {
    const current = await actor(req);
    const session = await getSession(req);
    if (session?.role !== "CUSTOMER") throw new AuthError(403, "Sign in with a workspace account");
    const { invite } = z.object({ invite: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await jsonBody(req));
    const teamId = await withTransaction(async (client) => {
      const { rows: [user] } = await client.query<{ email: string }>("SELECT email FROM users WHERE user_id = $1", [current.id]);
      return acceptInvite(client, invite, user.email, current.id);
    });
    return NextResponse.json({ teamId });
  } catch (error) {
    return handleError(error);
  }
}
