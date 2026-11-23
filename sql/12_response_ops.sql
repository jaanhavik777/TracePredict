ALTER TABLE ops.teams ADD COLUMN IF NOT EXISTS retention_days INT NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 7 AND 365);

CREATE TABLE IF NOT EXISTS ops.runbooks (
  runbook_id UUID PRIMARY KEY,
  category TEXT NOT NULL,
  version INT NOT NULL CHECK (version > 0),
  name TEXT NOT NULL,
  steps TEXT[] NOT NULL CHECK (cardinality(steps) BETWEEN 1 AND 20),
  published_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (category, version)
);
INSERT INTO ops.runbooks (runbook_id, category, version, name, steps) VALUES
 ('c85f9889-600b-45bf-b010-485d29dcad01', 'ACCESS', 1, 'Access change review',
  ARRAY['Confirm the permission change against the authoritative audit log.', 'Identify the affected identities and services.', 'Review whether the change was approved.', 'Record the outcome and verification steps.']),
 ('c85f9889-600b-45bf-b010-485d29dcad02', 'AUTHENTICATION', 1, 'Authentication review',
  ARRAY['Confirm the alert against sign-in records.', 'Identify the affected accounts and environments.', 'Document the disposition and follow-up.']),
 ('c85f9889-600b-45bf-b010-485d29dcad03', 'INTEGRITY', 1, 'Integrity review',
  ARRAY['Identify the affected records and verification source.', 'Compare the observed and expected state.', 'Document recovery and follow-up.']),
 ('c85f9889-600b-45bf-b010-485d29dcad04', 'AVAILABILITY', 1, 'Availability review',
  ARRAY['Confirm impact and identify affected services.', 'Compare with recent deployments and upstream status.', 'Verify recovery and document the incident.']),
 ('c85f9889-600b-45bf-b010-485d29dcad05', 'OTHER', 1, 'General incident review',
  ARRAY['Confirm the reported signal.', 'Record scope, evidence, and disposition.'])
ON CONFLICT (category, version) DO NOTHING;

ALTER TABLE ops.cases ADD COLUMN IF NOT EXISTS owner_id INT REFERENCES public.users(user_id);
ALTER TABLE ops.cases ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE ops.cases ADD COLUMN IF NOT EXISTS ack_due_at TIMESTAMPTZ;
ALTER TABLE ops.cases ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
ALTER TABLE ops.cases ADD COLUMN IF NOT EXISTS runbook_id UUID REFERENCES ops.runbooks(runbook_id);
ALTER TABLE ops.cases ADD COLUMN IF NOT EXISTS checked_steps INT[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION ops.case_defaults() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE due TIMESTAMPTZ;
BEGIN
  due := NEW.opened_at + CASE NEW.severity WHEN 4 THEN INTERVAL '15 minutes'
    WHEN 3 THEN INTERVAL '1 hour' WHEN 2 THEN INTERVAL '4 hours' ELSE INTERVAL '1 day' END;
  NEW.ack_due_at := LEAST(NEW.ack_due_at, due);
  IF TG_OP = 'INSERT' THEN
    SELECT runbook_id INTO NEW.runbook_id FROM ops.runbooks
    WHERE category = NEW.category ORDER BY version DESC LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS case_defaults ON ops.cases;
CREATE TRIGGER case_defaults BEFORE INSERT OR UPDATE OF severity ON ops.cases
FOR EACH ROW EXECUTE FUNCTION ops.case_defaults();
UPDATE ops.cases c SET runbook_id = (
  SELECT r.runbook_id FROM ops.runbooks r WHERE r.category = c.category ORDER BY version DESC LIMIT 1
) WHERE c.runbook_id IS NULL;
UPDATE ops.cases SET severity = severity WHERE ack_due_at IS NULL;

CREATE TABLE IF NOT EXISTS ops.case_events (
  event_id UUID PRIMARY KEY,
  team_id UUID NOT NULL,
  case_id UUID NOT NULL,
  actor_id INT REFERENCES public.users(user_id),
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (case_id, team_id) REFERENCES ops.cases(case_id, team_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ops_case_events_recent ON ops.case_events(case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ops.followups (
  followup_id UUID PRIMARY KEY,
  team_id UUID NOT NULL,
  case_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  owner_id INT REFERENCES public.users(user_id),
  due_on DATE NOT NULL,
  done_at TIMESTAMPTZ,
  FOREIGN KEY (case_id, team_id) REFERENCES ops.cases(case_id, team_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ops_followups_due ON ops.followups(team_id, due_on) WHERE done_at IS NULL;

CREATE TABLE IF NOT EXISTS ops.deliveries (
  delivery_id UUID PRIMARY KEY,
  team_id UUID NOT NULL,
  source_id UUID NOT NULL,
  event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSED','FAILED')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  processed_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  duplicate_count INT NOT NULL DEFAULT 0,
  failure_code TEXT,
  case_id UUID,
  UNIQUE (source_id, event_id),
  FOREIGN KEY (source_id, team_id) REFERENCES ops.sources(source_id, team_id),
  FOREIGN KEY (case_id, team_id) REFERENCES ops.cases(case_id, team_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ops_deliveries_pending ON ops.deliveries(available_at, delivery_id) WHERE status = 'QUEUED';
CREATE INDEX IF NOT EXISTS ops_deliveries_team ON ops.deliveries(team_id, received_at DESC);

CREATE TABLE IF NOT EXISTS ops.worker_health (
  worker TEXT PRIMARY KEY, last_seen_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS ops.prediction_health (
  attempt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  outcome TEXT NOT NULL CHECK (outcome IN ('SCORED', 'UNAVAILABLE', 'ERROR')),
  elapsed_ms INT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ops_prediction_health_recent ON ops.prediction_health(observed_at);

CREATE OR REPLACE FUNCTION ops.eligible_owners(target_team UUID)
RETURNS TABLE (user_id INT, full_name VARCHAR)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT u.user_id, u.full_name FROM ops.members m JOIN public.users u USING (user_id)
  WHERE m.team_id = target_team AND m.role IN ('LEAD','RESPONDER') AND u.is_active
    AND ops.access(target_team) IS NOT NULL ORDER BY u.full_name;
$$;
REVOKE ALL ON FUNCTION ops.eligible_owners(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.eligible_owners(UUID) TO tracepredict_ops;
GRANT SELECT ON ops.runbooks TO tracepredict_ops;
GRANT SELECT, INSERT ON ops.case_events, ops.followups TO tracepredict_ops;
GRANT UPDATE (done_at) ON ops.followups TO tracepredict_ops;
GRANT UPDATE (owner_id, acknowledged_at, checked_steps) ON ops.cases TO tracepredict_ops;
GRANT SELECT (delivery_id, team_id, source_id, status, received_at, processed_at, attempts, duplicate_count, failure_code, case_id)
  ON ops.deliveries TO tracepredict_ops;
GRANT SELECT (source_id, team_id, name) ON ops.sources TO tracepredict_ops;

ALTER TABLE ops.case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS case_event_read ON ops.case_events;
CREATE POLICY case_event_read ON ops.case_events FOR SELECT USING (ops.access(team_id) IS NOT NULL);
DROP POLICY IF EXISTS case_event_write ON ops.case_events;
CREATE POLICY case_event_write ON ops.case_events FOR INSERT
  WITH CHECK (ops.access(team_id) IN ('ADMIN','LEAD','RESPONDER') AND actor_id = ops.actor_id());
DROP POLICY IF EXISTS followup_read ON ops.followups;
CREATE POLICY followup_read ON ops.followups FOR SELECT USING (ops.access(team_id) IS NOT NULL);
DROP POLICY IF EXISTS followup_add ON ops.followups;
CREATE POLICY followup_add ON ops.followups FOR INSERT WITH CHECK (ops.access(team_id) IN ('ADMIN','LEAD','RESPONDER'));
DROP POLICY IF EXISTS followup_update ON ops.followups;
CREATE POLICY followup_update ON ops.followups FOR UPDATE
  USING (ops.access(team_id) IN ('ADMIN','LEAD','RESPONDER'))
  WITH CHECK (ops.access(team_id) IN ('ADMIN','LEAD','RESPONDER'));
DROP POLICY IF EXISTS delivery_read ON ops.deliveries;
CREATE POLICY delivery_read ON ops.deliveries FOR SELECT USING (ops.access(team_id) IS NOT NULL);
DROP POLICY IF EXISTS source_read ON ops.sources;
CREATE POLICY source_read ON ops.sources FOR SELECT USING (ops.access(team_id) IS NOT NULL);
