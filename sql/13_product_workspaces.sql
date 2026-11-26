INSERT INTO roles (role_name, description) VALUES ('CUSTOMER', 'Hosted workspace member')
ON CONFLICT (role_name) DO NOTHING;

ALTER TABLE ops.teams ADD COLUMN IF NOT EXISTS customer_workspace BOOLEAN NOT NULL DEFAULT FALSE;
-- Independent organizations can choose the same display name.
ALTER TABLE ops.teams DROP CONSTRAINT IF EXISTS teams_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS ops_internal_team_name ON ops.teams(name) WHERE NOT customer_workspace;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_casefold ON public.users(lower(email));

CREATE TABLE IF NOT EXISTS ops.team_services (
  team_id UUID NOT NULL REFERENCES ops.teams(team_id),
  service_id INT NOT NULL UNIQUE REFERENCES public.services(service_id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  PRIMARY KEY (team_id, service_id),
  UNIQUE (team_id, name)
);
ALTER TABLE ops.team_services ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON ops.team_services TO tracepredict_ops;
DROP POLICY IF EXISTS team_service_read ON ops.team_services;
CREATE POLICY team_service_read ON ops.team_services FOR SELECT USING (ops.access(team_id) IS NOT NULL);

CREATE TABLE IF NOT EXISTS ops.workspace_invites (
  token_hash TEXT PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES ops.teams(team_id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('RESPONDER', 'AUDITOR')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + INTERVAL '3 days'
);
CREATE INDEX IF NOT EXISTS workspace_invites_expiry ON ops.workspace_invites(expires_at);
CREATE TABLE IF NOT EXISTS ops.auth_limits (
  scope TEXT NOT NULL,
  subject TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 1,
  PRIMARY KEY (scope, subject)
);

ALTER TABLE ops.sources ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'signed' CHECK (provider IN ('signed', 'github'));
ALTER TABLE ops.sources ADD COLUMN IF NOT EXISTS repository TEXT;
ALTER TABLE ops.sources ADD COLUMN IF NOT EXISTS service_id INT REFERENCES public.services(service_id);
GRANT SELECT (provider, repository, service_id, enabled) ON ops.sources TO tracepredict_ops;
ALTER TABLE ops.cases ADD COLUMN IF NOT EXISTS source_group TEXT;
ALTER TABLE ops.deliveries ADD COLUMN IF NOT EXISTS source_group TEXT;
ALTER TABLE ops.alerts ADD COLUMN IF NOT EXISTS issue_url TEXT;
GRANT SELECT (issue_url) ON ops.alerts TO tracepredict_ops;

ALTER TABLE ops.restricted_evidence DROP CONSTRAINT IF EXISTS restricted_evidence_detail_check;
ALTER TABLE ops.restricted_evidence ADD CONSTRAINT restricted_evidence_detail_check CHECK (length(detail) BETWEEN 1 AND 22000);

CREATE OR REPLACE FUNCTION ops.validate_case_service() RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT FROM ops.teams WHERE team_id = NEW.team_id AND customer_workspace)
    AND NOT EXISTS (SELECT FROM ops.team_services WHERE team_id = NEW.team_id AND service_id = NEW.service_id) THEN
    RAISE EXCEPTION 'Service must belong to this workspace' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT FROM ops.team_services WHERE service_id = NEW.service_id AND team_id <> NEW.team_id) THEN
    RAISE EXCEPTION 'Service must belong to this workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS case_service_guard ON ops.cases;
CREATE TRIGGER case_service_guard BEFORE INSERT OR UPDATE OF team_id, service_id ON ops.cases
FOR EACH ROW EXECUTE FUNCTION ops.validate_case_service();
