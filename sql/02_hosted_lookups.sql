INSERT INTO roles (role_name, description) VALUES
 ('ADMIN', 'Manages internal platform settings'),
 ('ENGINEER', 'Creates, investigates and resolves internal incidents');
INSERT INTO incident_statuses (status_name) VALUES
 ('OPEN'), ('INVESTIGATING'), ('MITIGATED'), ('RESOLVED'), ('CLOSED');
INSERT INTO incident_severities (severity_name) VALUES
 ('LOW'), ('MEDIUM'), ('HIGH'), ('CRITICAL');
