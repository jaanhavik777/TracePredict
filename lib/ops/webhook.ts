import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AuthError, HttpError } from "@/lib/auth";

const maxBytes = 12_288;
const maxClockSkewSeconds = 300;

export function webhookKey(sourceId: string) {
  const master = process.env.TRACEPREDICT_WEBHOOK_SECRET;
  if (!master || master.length < 32) {
    throw new HttpError(503, "Alert intake needs TRACEPREDICT_WEBHOOK_SECRET configured");
  }
  return createHmac("sha256", master).update("tracepredict:alert:v1:" + sourceId).digest("hex");
}

export function signAlert(key: string, timestamp: string, body: Uint8Array) {
  return createHmac("sha256", key).update(timestamp + ".").update(body).digest("hex");
}

export function validAlertSignature(key: string, timestamp: string, header: string, body: Uint8Array, now = Date.now()) {
  if (!/^\d{10}$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > maxClockSkewSeconds) return false;
  return timingSafeEqual(Buffer.from(header.slice(7), "hex"), Buffer.from(signAlert(key, timestamp, body), "hex"));
}

export function alertHash(normalizedBody: string) {
  return createHash("sha256").update(normalizedBody).digest("hex");
}

export async function readAlertBody(req: Request) {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(400, "Send an application/json alert");
  }
  if (Number(req.headers.get("content-length")) > maxBytes) throw new HttpError(413, "Alert body too large");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing alert body");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "Alert body too large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    reader.releaseLock();
  }
}

export function checkSignature(req: Request, sourceId: string, body: Uint8Array) {
  if (!validAlertSignature(webhookKey(sourceId), req.headers.get("x-trace-timestamp") ?? "",
    req.headers.get("x-trace-signature") ?? "", body)) {
    throw new AuthError(401, "Invalid alert signature");
  }
}
