import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { HttpError } from "@/lib/auth";

function key() {
  const secret = process.env.TRACEPREDICT_EVIDENCE_KEY;
  if (secret && secret.length >= 32) return createHash("sha256").update(secret).digest();
  if (process.env.TRACEPREDICT_HOSTED === "1") throw new HttpError(503, "Restricted evidence encryption is unavailable");
  return null;
}

export function protectEvidence(value: string, teamId: string, evidenceId: string) {
  const encryption = key();
  if (!encryption) return value;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryption, nonce);
  cipher.setAAD(Buffer.from(teamId + "/" + evidenceId));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function revealEvidence(value: string, teamId: string, evidenceId: string) {
  if (!value.startsWith("v1:")) return value;
  const encryption = key();
  if (!encryption) throw new HttpError(503, "Restricted evidence encryption is unavailable");
  const stored = Buffer.from(value.slice(3), "base64");
  const cipher = createDecipheriv("aes-256-gcm", encryption, stored.subarray(0, 12));
  cipher.setAAD(Buffer.from(teamId + "/" + evidenceId));
  cipher.setAuthTag(stored.subarray(12, 28));
  return Buffer.concat([cipher.update(stored.subarray(28)), cipher.final()]).toString("utf8");
}
