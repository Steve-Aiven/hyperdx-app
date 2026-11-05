-- HyperDX app-state schema (PostgreSQL). IDs are 24-char ObjectId hex text
-- so existing URLs and APIs stay compatible when switching from Mongo.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  name text,
  allowed_auth_methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  hook_id text NOT NULL,
  api_key text NOT NULL,
  collector_authentication_enforced boolean NOT NULL DEFAULT false,
  is_metrics_series_table_enabled boolean NOT NULL DEFAULT false,
  metadata_max_rows_to_read integer,
  search_row_limit integer,
  query_timeout integer,
  field_metadata_disabled boolean,
  parallelize_when_possible boolean,
  filter_keys_fetch_limit integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  name text,
  team_id text REFERENCES teams (id),
  access_key text NOT NULL,
  hash text,
  salt text,
  onboarding_data jsonb NOT NULL DEFAULT '{"completedTasks":[],"isDismissed":false}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_access_key_unique ON users (access_key);

CREATE TABLE IF NOT EXISTS team_invites (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS team_invites_team_email_unique
  ON team_invites (team_id, lower(email));
CREATE INDEX IF NOT EXISTS team_invites_created_at_idx ON team_invites (created_at);

CREATE TABLE IF NOT EXISTS connections (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  name text,
  host text,
  username text,
  password text,
  hyperdx_setting_prefix text,
  is_prometheus_endpoint boolean,
  platform_provisioned boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connections_team_id_idx ON connections (team_id, id);

CREATE TABLE IF NOT EXISTS sources (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  connection_id text REFERENCES connections (id),
  kind text NOT NULL,
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sources_team_id_idx ON sources (team_id, id);

CREATE TABLE IF NOT EXISTS saved_searches (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  source_id text REFERENCES sources (id),
  name text,
  doc jsonb NOT NULL,
  created_by text REFERENCES users (id),
  updated_by text REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_searches_team_id_idx ON saved_searches (team_id, id);

CREATE TABLE IF NOT EXISTS dashboards (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  name text NOT NULL,
  tiles jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  saved_query text,
  saved_query_language text,
  saved_filter_values jsonb,
  saved_date_range jsonb,
  containers jsonb,
  created_by text REFERENCES users (id),
  updated_by text REFERENCES users (id),
  provisioned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dashboards_provisioned_name_team_unique
  ON dashboards (name, team_id) WHERE provisioned = true;
CREATE INDEX IF NOT EXISTS dashboards_team_id_idx ON dashboards (team_id, id);

CREATE TABLE IF NOT EXISTS webhooks (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  service text NOT NULL,
  name text NOT NULL,
  url text,
  description text,
  title_emoji boolean,
  query_params jsonb,
  headers jsonb,
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS webhooks_team_service_name_unique
  ON webhooks (team_id, service, name);
CREATE INDEX IF NOT EXISTS webhooks_team_id_idx ON webhooks (team_id, id);

CREATE TABLE IF NOT EXISTS favorites (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  resource_type text NOT NULL CHECK (resource_type IN ('dashboard', 'savedSearch')),
  resource_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_unique
  ON favorites (team_id, user_id, resource_type, resource_id);

CREATE TABLE IF NOT EXISTS pinned_filters (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pinned_filters_team_source_unique
  ON pinned_filters (team_id, source_id);

CREATE TABLE IF NOT EXISTS preset_dashboard_filters (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  name text NOT NULL,
  source_metric_type text,
  preset_dashboard text NOT NULL,
  type text NOT NULL,
  expression text NOT NULL,
  where_clause text,
  where_language text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  doc jsonb NOT NULL,
  state text NOT NULL DEFAULT 'OK',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alerts_team_id_idx ON alerts (team_id, id);
CREATE INDEX IF NOT EXISTS alerts_team_display_name_idx
  ON alerts (team_id, (doc->>'displayName'), id);

CREATE TABLE IF NOT EXISTS alert_histories (
  id text PRIMARY KEY,
  alert_id text NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  counts integer NOT NULL DEFAULT 0,
  state text NOT NULL,
  last_values jsonb NOT NULL DEFAULT '[]'::jsonb,
  group_key text,
  group_values jsonb,
  fired boolean,
  errors jsonb,
  analytics jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_histories_alert_created_idx
  ON alert_histories (alert_id, created_at DESC);
CREATE INDEX IF NOT EXISTS alert_histories_alert_group_created_idx
  ON alert_histories (alert_id, group_key, created_at DESC);
CREATE INDEX IF NOT EXISTS alert_histories_created_at_idx
  ON alert_histories (created_at);

-- express-session / connect-pg-simple
CREATE TABLE IF NOT EXISTS session (
  sid varchar NOT NULL COLLATE "default",
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
ALTER TABLE session DROP CONSTRAINT IF EXISTS session_pkey;
ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
