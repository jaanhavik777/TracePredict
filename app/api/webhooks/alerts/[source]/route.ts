import { NextResponse } from "next/server";
import { HttpError, handleError } from "@/lib/auth";
import { resourceId } from "@/lib/ops/access";
import { alertInput } from "@/lib/ops/contracts";
import { acceptDelivery } from "@/lib/ops/intake";
import { checkSignature, readAlertBody } from "@/lib/ops/webhook";

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
    const result = await acceptDelivery(sourceId, "signed", () => ({ alert }));
    return NextResponse.json(result, { status: result.duplicate ? 200 : 202 });
  } catch (error) {
    return handleError(error);
  }
}
