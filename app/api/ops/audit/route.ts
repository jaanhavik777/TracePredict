import { NextRequest, NextResponse } from "next/server";
import { actor, resourceId, teamRole, workspace } from "@/lib/ops/access";
import { AuthError, handleError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await actor(req);
    const selected = req.nextUrl.searchParams.get("team");
    const team = selected ? resourceId(selected) : null;
    const action = req.nextUrl.searchParams.get("action")?.trim().slice(0, 60) || null;
    const audit = await workspace(user.id, async (client) => {
      if (team && await teamRole(client, team) === "RESPONDER") throw new AuthError(403, "Audit access required");
      const { rows } = await client.query(
        `SELECT audit_id, team_id, actor_id, action, target, recorded_at, subject_user_id, membership_role FROM ops.audit
         WHERE ($1::uuid IS NULL OR team_id = $1) AND ($2::text IS NULL OR strpos(action, upper($2)) > 0)
         ORDER BY audit_id DESC LIMIT 100`, [team, action],
      );
      return rows;
    });
    return NextResponse.json({ audit }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}
