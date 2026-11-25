import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, HttpError, handleError } from "@/lib/auth";
import { resourceId } from "@/lib/ops/access";
import { alertInput } from "@/lib/ops/contracts";
import { acceptDelivery } from "@/lib/ops/intake";
import { readAlertBody, webhookKey } from "@/lib/ops/webhook";

const announcement = z.object({ repository: z.object({ full_name: z.string() }) });
const issueEvent = announcement.extend({
  action: z.string(),
  issue: z.object({
    number: z.number().int().positive(),
    title: z.string().trim().min(1).max(500),
    created_at: z.string().datetime({ offset: true }),
  }),
});

export async function POST(req: Request, { params }: { params: Promise<{ source: string }> }) {
  try {
    const id = resourceId((await params).source).toLowerCase();
    const body = await readAlertBody(req, 128 * 1024);
    const signature = req.headers.get("x-hub-signature-256") ?? "";
    const expected = createHmac("sha256", webhookKey(id)).update(body).digest();
    if (!/^sha256=[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"))) {
      throw new AuthError(401, "Invalid GitHub signature");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      throw new HttpError(400, "Invalid GitHub payload");
    }
    const event = req.headers.get("x-github-event");
    const result = await acceptDelivery(id, "github", (source) => {
      const repo = source.repository;
      if (!repo || !source.service_id || announcement.parse(payload).repository.full_name.toLowerCase() !== repo.toLowerCase()) {
        throw new AuthError(403, "This connection belongs to a different repository");
      }
      if (event !== "issues") return null;
      const { action, issue } = issueEvent.parse(payload);
      if (action !== "opened") return null;
      return {
        // One issue in a repository maps to one case. A redelivery is idempotent.
        alert: alertInput.parse({
          eventId: `issue:${issue.number}`, serviceId: source.service_id, environment: "production", severity: 2,
          category: "OTHER", title: `#${issue.number} ${issue.title}`.slice(0, 160),
          occurredAt: issue.created_at, message: "Issue opened on GitHub",
        }),
        group: `github:${id}:${issue.number}`, issueUrl: `https://github.com/${repo}/issues/${issue.number}`,
      };
    });
    const { duplicate, ignored } = result;
    return NextResponse.json(result, { status: ignored || duplicate ? 200 : 202 });
  } catch (error) {
    return handleError(error);
  }
}
