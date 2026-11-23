"use client";

import { useEffect, useState } from "react";
import type { Model, Task } from "@/ml/model";

type Report = Pick<Model, "version" | "source" | "rows" | "split"> & {
  tasks: (Omit<Model["models"][Task], "training"> & { task: Task })[];
};
const labels = { severity: "Severity", cause: "Root cause", minutes: "Resolution duration" };

export default function ModelPerformance() {
  const [report, setReport] = useState<Report | null>();
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/api/predictions").then((response) => {
      if (!response.ok) throw new Error("Model report unavailable");
      return response.json();
    }).then(setReport).catch(() => setError(true));
  }, []);

  return (
    <section className="card" style={{ overflowX: "auto" }}>
      <h2>Prediction performance</h2>
      {error ? <p role="alert">Model report unavailable.</p> : report === undefined ? <p>Loading model report…</p>
        : !report ? <p>No trained model is configured.</p> : <>
          <p>{report.source === "synthetic" ? "Synthetic demo evaluation" : "Historical evaluation"} · {report.rows} records · Model {report.version}</p>
          <p className="muted">Held-out period starts {report.split.testStart.slice(0, 10)}.</p>
          <table className="table">
            <thead><tr><th>Target</th><th>Selected method</th><th>Held-out records</th><th>Held-out result</th><th>Prediction</th></tr></thead>
            <tbody>{report.tasks.map(({ task, method, enabled, test }) => (
              <tr key={task}>
                <td>{labels[task]}</td><td>{method}</td><td>{test.rows}</td>
                <td>{test.macroF1 !== undefined ? `Macro F1 ${test.macroF1.toFixed(2)}`
                  : test.mae !== undefined ? `MAE ${test.mae.toFixed(1)} min · RMSE ${test.rmse?.toFixed(1)} min` : "Unavailable"}</td>
                <td>{enabled ? "Enabled" : "Withheld"}</td>
              </tr>
            ))}</tbody>
          </table>
          {report.tasks.map(({ task, test, validation, testBaseline }) => (
            <details key={task}>
              <summary>{labels[task]} evaluation</summary>
              <p>Held-out baseline · {testBaseline?.macroF1 !== undefined
                ? `Macro F1 ${testBaseline.macroF1.toFixed(2)}`
                : testBaseline?.mae !== undefined ? `MAE ${testBaseline.mae.toFixed(1)} min` : "Unavailable"}</p>
              <ul>{Object.entries(validation).map(([method, metrics]) => (
                <li key={method}>{method} · {metrics.macroF1 !== undefined
                  ? `validation macro F1 ${metrics.macroF1.toFixed(2)}`
                  : `validation MAE ${metrics.mae?.toFixed(1) ?? "unavailable"} min`}</li>
              ))}</ul>
              {test.classes && <table className="table">
                <thead><tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1</th><th>Support</th></tr></thead>
                <tbody>{Object.entries(test.classes).map(([label, metrics]) => (
                  <tr key={label}><td>{label}</td><td>{metrics.precision.toFixed(2)}</td><td>{metrics.recall.toFixed(2)}</td>
                    <td>{metrics.f1.toFixed(2)}</td><td>{metrics.support}</td></tr>
                ))}</tbody>
              </table>}
            </details>
          ))}
        </>}
    </section>
  );
}
