CREATE TABLE IF NOT EXISTS incident_predictions (
  prediction_id UUID PRIMARY KEY,
  incident_id INT UNIQUE REFERENCES incidents(incident_id) ON DELETE CASCADE,
  requested_by INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  intake_hash TEXT NOT NULL,
  features JSONB NOT NULL,
  result JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prediction_pending
  ON incident_predictions(scored_at) WHERE incident_id IS NULL;

CREATE OR REPLACE FUNCTION prediction_context(primary_service INT, cutoff TIMESTAMP)
RETURNS TABLE (recent_incidents INT, recent_deployments INT, prior_resolution_minutes FLOAT8)
LANGUAGE SQL STABLE AS $$
  SELECT
    (SELECT COUNT(*)::INT FROM incidents i JOIN incident_services s USING (incident_id)
      WHERE s.service_id = primary_service AND i.created_at >= cutoff - INTERVAL '30 days'
        AND i.created_at < cutoff),
    (SELECT COUNT(*)::INT FROM deployments d
      WHERE d.service_id = primary_service AND d.deployed_at >= cutoff - INTERVAL '24 hours'
        AND d.deployed_at < cutoff),
    (SELECT AVG(EXTRACT(EPOCH FROM (r.resolved_at - i.created_at)) / 60)::FLOAT8
      FROM resolutions r JOIN incidents i USING (incident_id)
      JOIN incident_services s USING (incident_id)
      WHERE s.service_id = primary_service AND r.resolved_at < cutoff
        AND r.resolved_at >= i.created_at);
$$;

