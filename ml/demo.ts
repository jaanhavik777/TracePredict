import { causes, severities, timeFeatures, type TrainingRow } from "./contracts";

const symptoms = [
  "connection pool exhausted database queries stalled",
  "release rollout failing version rollback requested",
  "invalid configuration environment variable credentials",
  "container restarted node disk volume unavailable",
  "packet loss network routing connection timeout",
  "memory pressure saturation traffic overload",
  "queue backlog consumer lag messages delayed",
  "vendor gateway upstream dependency failing",
  "application exception validation handler crashes",
  "intermittent unexplained behavior investigation pending",
];
const impact = [
  "isolated minor delay for one user",
  "partial degradation affecting some requests",
  "widespread outage for many customers",
  "complete outage all requests failing",
];

export function demoRows(): TrainingRow[] {
  let seed = 517;
  function random(max: number) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor(seed / 4294967296 * max);
  }

  return Array.from({ length: 800 }, (_, i) => {
    const cause = random(causes.length);
    const severity = random(severities.length);
    const observedCause = random(5) === 0 ? random(causes.length) : cause;
    const observedSeverity = random(4) === 0 ? random(severities.length) : severity;
    const date = new Date(Date.UTC(2024, 0, 1) + i * 11 * 3600000);
    const duration = 15 + severity * 33 + (cause % 4) * 13 + random(55);
    return {
      createdAt: date.toISOString(),
      resolvedAt: new Date(date.getTime() + duration * 60000).toISOString(),
      severity: severities[severity],
      cause: causes[cause],
      minutes: duration,
      features: {
        text: symptoms[observedCause] + ". " + impact[observedSeverity] + ". " +
          ["Observed by support", "Reported during checks", "Engineer investigating"][random(3)],
        affectedServices: 1 + random(severity + 1),
        recentIncidents: random(9),
        recentDeployments: cause === 1 ? 1 + random(3) : random(2),
        priorResolutionMinutes: 35 + random(100),
        ...timeFeatures(date),
      },
    };
  });
}
