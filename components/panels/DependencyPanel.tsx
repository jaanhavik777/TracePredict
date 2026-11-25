
"use client";

import { useEffect, useState } from "react";

type ServiceDependency = {
  service_id: number;
  service_name: string;
};

type DependencyData = {
  upstream: ServiceDependency[];
  downstream: ServiceDependency[];
};

export default function DependencyPanel({
  incidentId,
}: {
  incidentId: number;
}) {
  const [dependencies, setDependencies] = useState<DependencyData>({
    upstream: [],
    downstream: [],
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function fetchDependencies() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          `/api/incidents/${incidentId}/context`
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to load dependencies");
        }

        if (!cancelled) {
          setDependencies({
            upstream: data.dependencies?.upstream || [],
            downstream: data.dependencies?.downstream || [],
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load dependencies"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchDependencies();

    return () => {
      cancelled = true;
    };
  }, [incidentId]);

  return (
    <section className="card">
      <h2>Service Dependencies</h2>

      {loading && (
        <p className="muted">Loading dependencies...</p>
      )}

      {error && (
        <p className="error">{error}</p>
      )}

      {!loading && !error && (
        <div className="grid2">

          {/* Upstream Services */}
          <div>
            <h3 className="panel-label">
              Upstream Services
            </h3>

            <p className="muted">
              Services that this incident's services depend on.
            </p>

            {dependencies.upstream.length === 0 ? (
              <p className="muted">
                No upstream dependencies found.
              </p>
            ) : (
              <ul className="panel-list">
                {dependencies.upstream.map((service) => (
                  <li
                    key={service.service_id}
                    className="upstream-node"
                  >
                    <span>
                      {service.service_name}
                    </span>
                    <span className="muted">
                      ID: {service.service_id}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Downstream Services */}
          <div>
            <h3 className="panel-label downstream">
              Downstream Services
            </h3>

            <p className="muted">
              Services that depend on this incident's services.
            </p>

            {dependencies.downstream.length === 0 ? (
              <p className="muted">
                No downstream dependencies found.
              </p>
            ) : (
              <ul className="panel-list">
                {dependencies.downstream.map((service) => (
                  <li
                    key={service.service_id}
                    className="downstream-node"
                  >
                    <span>
                      {service.service_name}
                    </span>
                    <span className="muted">
                      ID: {service.service_id}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

        </div>
      )}
    </section>
  );
}
