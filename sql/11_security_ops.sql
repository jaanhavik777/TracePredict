-- Restricted role for authenticated operations requests. The pool login keeps
-- owner access for migrations and the verified inbound alert pipeline.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tracepredict_ops') THEN
    CREATE ROLE tracepredict_ops NOLOGIN NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT tracepredict_ops TO %I', current_user);
END
$$;

CREATE SCHEMA IF NOT EXISTS ops;
REVOKE ALL ON SCHEMA ops FROM PUBLIC;

CREATE TABLE IF NOT EXISTS ops.teams (
  team_id UUID PRIMARY KEY,
  name TEXT UNIQUE NOT NULL CHECK (length(name) BETWEEN 1 AND 80)
);
CREATE TABLE IF NOT EXISTS ops.members (
  team_id UUID NOT NULL REFERENCES ops.teams(team_id),
  user_id INT NOT NULL REFERENCES public.users(user_id),
  role TEXT NOT NULL CHECK (role IN ('RESPONDER', 'LEAD', 'AUDITOR')),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS ops_members_user ON ops.members(user_id, team_id);

CREATE TABLE IF NOT EXISTS ops.sources (
  source_id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES ops.teams(team_id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_id, team_id)
);

CREATE TABLE IF NOT EXISTS ops.cases (
  case_id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES ops.teams(team_id),
  service_id INT NOT NULL REFERENCES public.services(service_id),
  environment TEXT NOT NULL CHECK (environment IN ('production', 'staging', 'development')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  category TEXT NOT NULL CHECK (category IN ('ACCESS', 'AUTHENTICATION', 'INTEGRITY', 'AVAILABILITY', 'OTHER')),
  severity SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 4),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'RESOLVED')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_signal_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution TEXT,
  UNIQUE (case_id, team_id),
  CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL AND resolution IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ops_cases_recent ON ops.cases(team_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS ops_cases_correlation
  ON ops.cases(team_id, service_id, environment, category, last_signal_at DESC)
  WHERE status <> 'RESOLVED';

CREATE TABLE IF NOT EXISTS ops.alerts (
  alert_id UUID PRIMARY KEY,
  case_id UUID NOT NULL,
  source_id UUID NOT NULL,
  team_id UUID NOT NULL,
  external_id TEXT NOT NULL CHECK (length(external_id) BETWEEN 1 AND 128),
  payload_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 4),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_id, external_id),
  FOREIGN KEY (case_id, team_id) REFERENCES ops.cases(case_id, team_id),
  FOREIGN KEY (source_id, team_id) REFERENCES ops.sources(source_id, team_id)
);
CREATE INDEX IF NOT EXISTS ops_alerts_case ON ops.alerts(case_id, received_at DESC);

CREATE TABLE IF NOT EXISTS ops.evidence (
  evidence_id UUID PRIMARY KEY,
  case_id UUID NOT NULL,
  team_id UUID NOT NULL,
  author_id INT NOT NULL REFERENCES public.users(user_id),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 600),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (evidence_id, team_id),
  FOREIGN KEY (case_id, team_id) REFERENCES ops.cases(case_id, team_id)
);
CREATE INDEX IF NOT EXISTS ops_evidence_case ON ops.evidence(case_id, recorded_at DESC);
ALTER TABLE ops.evidence ADD COLUMN IF NOT EXISTS has_restricted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS ops.restricted_evidence (
  evidence_id UUID PRIMARY KEY,
  team_id UUID NOT NULL,
  detail TEXT NOT NULL CHECK (length(detail) BETWEEN 1 AND 4000),
  FOREIGN KEY (evidence_id, team_id) REFERENCES ops.evidence(evidence_id, team_id)
);
UPDATE ops.evidence e SET has_restricted = TRUE
WHERE NOT e.has_restricted AND EXISTS (SELECT FROM ops.restricted_evidence r WHERE r.evidence_id = e.evidence_id);

CREATE TABLE IF NOT EXISTS ops.audit (
  audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id UUID REFERENCES ops.teams(team_id),
  actor_id INT REFERENCES public.users(user_id),
  action TEXT NOT NULL,
  target UUID,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ops_audit_recent ON ops.audit(team_id, audit_id DESC);
ALTER TABLE ops.audit ADD COLUMN IF NOT EXISTS subject_user_id INT REFERENCES public.users(user_id);
ALTER TABLE ops.audit ADD COLUMN IF NOT EXISTS membership_role TEXT;

CREATE OR REPLACE FUNCTION ops.actor_id() RETURNS INT LANGUAGE SQL STABLE
SET search_path = pg_catalog AS $$
  SELECT NULLIF(current_setting('tracepredict.actor_id', true), '')::INT;
$$;

CREATE OR REPLACE FUNCTION ops.access(target_team UUID) RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT CASE WHEN roles.role_name = 'ADMIN' THEN 'ADMIN' ELSE members.role END
  FROM public.users
  JOIN public.roles USING (role_id)
  LEFT JOIN ops.members ON members.user_id = users.user_id AND members.team_id = target_team
  WHERE users.user_id = ops.actor_id() AND users.is_active;
$$;

REVOKE ALL ON FUNCTION ops.actor_id(), ops.access(UUID) FROM PUBLIC;
GRANT USAGE ON SCHEMA ops TO tracepredict_ops;
GRANT EXECUTE ON FUNCTION ops.actor_id(), ops.access(UUID) TO tracepredict_ops;
GRANT SELECT ON ops.teams, ops.cases, ops.restricted_evidence, ops.audit TO tracepredict_ops;
GRANT SELECT (alert_id, case_id, team_id, title, message, severity, occurred_at, received_at)
  ON ops.alerts TO tracepredict_ops;
GRANT SELECT, INSERT ON ops.evidence TO tracepredict_ops;
GRANT INSERT ON ops.restricted_evidence, ops.audit, ops.cases TO tracepredict_ops;
GRANT UPDATE (status, resolved_at, resolution) ON ops.cases TO tracepredict_ops;
GRANT SELECT ON public.services, public.service_dependencies, public.deployments TO tracepredict_ops;

ALTER TABLE ops.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.restricted_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_read ON ops.teams;
CREATE POLICY team_read ON ops.teams FOR SELECT USING (ops.access(team_id) IS NOT NULL);
DROP POLICY IF EXISTS case_read ON ops.cases;
CREATE POLICY case_read ON ops.cases FOR SELECT USING (ops.access(team_id) IS NOT NULL);
DROP POLICY IF EXISTS case_open ON ops.cases;
CREATE POLICY case_open ON ops.cases FOR INSERT WITH CHECK (ops.access(team_id) IN ('ADMIN','LEAD','RESPONDER'));
DROP POLICY IF EXISTS case_update ON ops.cases;
CREATE POLICY case_update ON ops.cases FOR UPDATE
  USING (ops.access(team_id) IN ('ADMIN','LEAD','RESPONDER'))
  WITH CHECK (ops.access(team_id) IN ('ADMIN','LEAD','RESPONDER'));
DROP POLICY IF EXISTS alert_read ON ops.alerts;
CREATE POLICY alert_read ON ops.alerts FOR SELECT USING (ops.access(team_id) IS NOT NULL);
DROP POLICY IF EXISTS evidence_read ON ops.evidence;
CREATE POLICY evidence_read ON ops.evidence FOR SELECT USING (ops.access(team_id) IS NOT NULL);
DROP POLICY IF EXISTS evidence_add ON ops.evidence;
CREATE POLICY evidence_add ON ops.evidence FOR INSERT
  WITH CHECK (ops.access(team_id) IN ('ADMIN','LEAD','RESPONDER') AND author_id = ops.actor_id());
DROP POLICY IF EXISTS restricted_read ON ops.restricted_evidence;
CREATE POLICY restricted_read ON ops.restricted_evidence FOR SELECT USING (ops.access(team_id) IN ('ADMIN','LEAD'));
DROP POLICY IF EXISTS restricted_add ON ops.restricted_evidence;
CREATE POLICY restricted_add ON ops.restricted_evidence FOR INSERT
  WITH CHECK (ops.access(team_id) IN ('ADMIN','LEAD','RESPONDER'));
DROP POLICY IF EXISTS audit_read ON ops.audit;
CREATE POLICY audit_read ON ops.audit FOR SELECT USING (ops.access(team_id) IN ('ADMIN','LEAD','AUDITOR'));
DROP POLICY IF EXISTS audit_append ON ops.audit;
CREATE POLICY audit_append ON ops.audit FOR INSERT
  WITH CHECK (ops.access(team_id) IS NOT NULL AND actor_id = ops.actor_id());
