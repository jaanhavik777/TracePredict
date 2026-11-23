import type { Prediction } from "@/ml/contracts";

export default function PredictionPanel({ result }: { result: Prediction }) {
  return (
    <section className="card" aria-label="Intake prediction">
      <h2>Intake prediction</h2>
      {result.source === "synthetic" && (
        <p className="muted">Demo model trained on synthetic incidents. Use the recorded evidence for operational decisions.</p>
      )}
      <dl className="grid2">
        <div><dt>Suggested severity</dt><dd>{result.severity ?? "Unavailable"}</dd></div>
        <div><dt>Estimated time to resolution</dt><dd>{result.minutes === null ? "Unavailable" : `${result.minutes} min`}</dd></div>
        <div><dt>Likely cause categories</dt><dd>{result.causes.map((cause) => cause.replaceAll("_", " ")).join(", ") || "Unavailable"}</dd></div>
      </dl>
      <p className="muted">
        {result.factors.length
          ? `Inputs that changed an estimate when omitted: ${result.factors.join(", ")}.`
          : "No individual input materially changed the displayed estimates when omitted."}
      </p>
      <small className="muted">Model {result.version}</small>
    </section>
  );
}
