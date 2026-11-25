
"use client";

import { useEffect, useState } from "react";

type Deployment = {
  deployment_id: number;
  version: string;
  deployed_at: string;
  hours_before_incident: number;
  status: string;
};

export default function RecentDeployments({
  incidentId,
}: {
  incidentId: number;
}) {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function fetchDeployments() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          `/api/incidents/${incidentId}/context`
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to load deployments");
        }

        if (!cancelled) {
          setDeployments(data.deployments || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load deployments"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchDeployments();

    return () => {
      cancelled = true;
    };
  }, [incidentId]);

  return (
    <section className="card">
      <h2>Recent Deployments</h2>

      {loading && <p className="muted">Loading deployments...</p>}

      {error && <p className="error">{error}</p>}

      {!loading && !error && deployments.length === 0 && (
        <p className="muted">
          No deployments found in the 7 days before this incident.
        </p>
      )}

      {!loading && !error && deployments.length> 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Deployed At</th>
                <th>Hours Before Incident</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {deployments.map((deployment) => (
                <tr key={deployment.deployment_id}>
                  <td>{deployment.version}</td>
                  <td>
                    {new Date(deployment.deployed_at).toLocaleString()}
                  </td>
                  <td>
                    {deployment.hours_before_incident} hours
                  </td>
                  <td>
                    <span className="badge status">
                      {deployment.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
