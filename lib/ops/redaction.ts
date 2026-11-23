// Shared summaries are still reviewed by the author. This masks common secrets
// before text is copied to case lists, alerts, evidence summaries, or exports.
export function redactSummary(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b((?:api[_ -]?key|password|passwd|secret|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[IP redacted]");
}
