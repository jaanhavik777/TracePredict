import type { Features, Prediction, TrainingRow } from "./contracts";

export const tasks = ["severity", "cause", "minutes"] as const;
export type Task = typeof tasks[number];
export type Method = "baseline" | "nearest" | "weighted";
type Label = string | number;

export type Metrics = {
  rows: number;
  macroF1?: number;
  mae?: number;
  rmse?: number;
  classes?: Record<string, { precision: number; recall: number; f1: number; support: number }>;
  confusion?: Record<string, Record<string, number>>;
};
export type Model = {
  version: string;
  source: Prediction["source"];
  rows: number;
  split: { validationStart: string; testStart: string };
  models: Record<Task, {
    method: Method;
    enabled: boolean;
    validation: Record<Method, Metrics>;
    test: Metrics;
    testBaseline: Metrics;
    training: { features: Features; label: Label }[];
  }>;
};

const featureNames = [
  "Intake wording", "Affected service count", "Prior incidents in 30 days",
  "Deployments in 24 hours", "Historical resolution time", "Time of day", "Weekend",
];

const stopWords = new Set(["the", "this", "that", "with", "from", "have", "been", "and", "for", "are", "was", "our"]);
function tokens(text: string) {
  return new Set((text.toLowerCase().match(/[\p{L}]{3,}/gu) ?? []).filter((word) => !stopWords.has(word)));
}

function differences(a: Features, b: Features, aTokens: Set<string>, bTokens: Set<string>) {
  const overlap = [...bTokens].filter((word) => aTokens.has(word)).length;
  const union = aTokens.size + bTokens.size - overlap;
  const logDistance = (x: number, y: number) => Math.min(1, Math.abs(Math.log1p(x) - Math.log1p(y)) / 2);
  const hour = Math.abs(a.hour - b.hour);
  return [
    (union ? 1 - overlap / union : 0) * 3,
    logDistance(a.affectedServices, b.affectedServices),
    logDistance(a.recentIncidents, b.recentIncidents),
    logDistance(a.recentDeployments, b.recentDeployments),
    a.priorResolutionMinutes == null || b.priorResolutionMinutes == null ? 0
      : logDistance(a.priorResolutionMinutes, b.priorResolutionMinutes),
    Math.min(hour, 24 - hour) / 48,
    a.weekend === b.weekend ? 0 : 0.15,
  ];
}

type Training = Model["models"][Task]["training"];
export function estimate(task: Task, method: Method, training: Training, input: Features, omit = -1): Label[] {
  if (!training.length) return [];
  const inputTokens = tokens(input.text);
  const neighbors = method === "baseline"
    ? training.map(({ label }) => ({ label, weight: 1 }))
    : training.map(({ label, features }) => ({
        label,
        distance: differences(input, features, inputTokens, tokens(features.text))
          .reduce((sum, value, index) => sum + (index === omit ? 0 : value), 0),
      })).sort((a, b) => a.distance - b.distance).slice(0, 11)
      .map(({ label, distance }) => ({ label, weight: method === "weighted" ? 1 / (0.05 + distance) : 1 }));

  if (task === "minutes") {
    if (method === "baseline") {
      const values = neighbors.map(({ label }) => Number(label)).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return [(values[middle] + values[Math.floor((values.length - 1) / 2)]) / 2];
    }
    const weightedSum = neighbors.reduce((sum, row) => sum + Number(row.label) * row.weight, 0);
    return [weightedSum / neighbors.reduce((sum, row) => sum + row.weight, 0)];
  }
  const votes = new Map<Label, number>();
  for (const { label, weight } of neighbors) votes.set(label, (votes.get(label) ?? 0) + weight);
  return [...votes].sort((a, b) => b[1] - a[1]).map(([label]) => label);
}

export function evaluate(task: Task, method: Method, training: Training, rows: TrainingRow[]): Metrics {
  const results = rows.flatMap((row) => {
    const actual = row[task];
    const [predicted] = estimate(task, method, training, row.features);
    return actual === null || predicted === undefined ? [] : [{ actual, predicted }];
  });
  if (!results.length) return { rows: 0 };
  if (task === "minutes") {
    const errors = results.map(({ actual, predicted }) => Math.abs(Number(actual) - Number(predicted)));
    return {
      rows: errors.length,
      mae: errors.reduce((sum, e) => sum + e, 0) / errors.length,
      rmse: Math.sqrt(errors.reduce((sum, e) => sum + e ** 2, 0) / errors.length),
    };
  }
  const labels = [...new Set(results.flatMap(({ actual, predicted }) => [String(actual), String(predicted)]))].sort();
  const confusion = Object.fromEntries(labels.map((actual) => [
    actual, Object.fromEntries(labels.map((predicted) => [predicted, 0])),
  ]));
  for (const { actual, predicted } of results) confusion[String(actual)][String(predicted)]++;
  const classes = Object.fromEntries(labels.map((label) => {
    const support = results.filter(({ actual }) => actual === label).length;
    const predicted = results.filter((result) => result.predicted === label).length;
    const hits = confusion[label][label];
    const precision = predicted ? hits / predicted : 0;
    const recall = support ? hits / support : 0;
    return [label, { support, precision, recall, f1: hits ? 2 * precision * recall / (precision + recall) : 0 }];
  }));
  return {
    rows: results.length, classes, confusion,
    macroF1: Object.values(classes).reduce((sum, row) => sum + row.f1, 0) / labels.length,
  };
}

export function predict(model: Model, input: Features): Prediction {
  const outputs = tasks.map((task) => {
    const config = model.models[task];
    return config.enabled ? estimate(task, config.method, config.training, input) : [];
  });
  const factors = featureNames.filter((_, index) => tasks.some((task, taskIndex) => {
    const config = model.models[task];
    if (!config.enabled || config.method === "baseline") return false;
    const [original] = outputs[taskIndex];
    const [without] = estimate(task, config.method, config.training, input, index);
    return task === "minutes" ? Math.abs(Number(original) - Number(without)) >= 10 : original !== without;
  }));
  return {
    version: model.version, source: model.source,
    severity: outputs[0].length ? String(outputs[0][0]) : null,
    causes: outputs[1].slice(0, 3).map(String),
    minutes: outputs[2].length ? Math.round(Number(outputs[2][0])) : null,
    factors,
  };
}
