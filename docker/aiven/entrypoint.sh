#!/bin/sh
set -eu

# Map Aiven Runtime credential integrations into HyperDX env.
# - ClickHouse: CLICKHOUSE_* from application_service_credential
# - Postgres: DATABASE_URL from application_service_credential (connection_string)

export DATASTORE="${DATASTORE:-postgres}"

if [ -z "${CLICKHOUSE_ENDPOINT:-}" ]; then
  if [ -n "${CLICKHOUSE_HOST:-}" ]; then
    https_port="${CLICKHOUSE_HTTPS_PORT:-}"
    if [ -z "$https_port" ] && [ -n "${CLICKHOUSE_NATIVE_PORT:-}" ]; then
      https_port=$((CLICKHOUSE_NATIVE_PORT + 1))
    fi
    if [ -n "${https_port:-}" ]; then
      export CLICKHOUSE_ENDPOINT="https://${CLICKHOUSE_HOST}:${https_port}"
    fi
  fi
fi

export HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE="${HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE:-otel}"

if [ -n "${FRONTEND_URL:-}" ]; then
  export HYPERDX_APP_URL="${HYPERDX_APP_URL:-$FRONTEND_URL}"
fi

# Aiven PG integration may inject DATABASE_URL or PG* pieces.
if [ -z "${DATABASE_URL:-}" ]; then
  if [ -n "${PGHOST:-}" ] && [ -n "${PGUSER:-}" ] && [ -n "${PGPASSWORD:-}" ]; then
    pgport="${PGPORT:-5432}"
    pgdb="${PGDATABASE:-defaultdb}"
    export DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${pgport}/${pgdb}?sslmode=require"
  fi
fi

if [ -z "${EXPRESS_SESSION_SECRET:-}" ]; then
  echo "warning: EXPRESS_SESSION_SECRET is unset; sessions will not survive restarts" >&2
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "error: DATABASE_URL unset; HyperDX needs Aiven for PostgreSQL for app state" >&2
  exit 1
fi

if [ -n "${CLICKHOUSE_ENDPOINT:-}" ]; then
  echo "HyperDX DATASTORE=${DATASTORE} DATABASE_URL set; ClickHouse=${CLICKHOUSE_ENDPOINT} (db=${HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE})"
else
  echo "warning: CLICKHOUSE_ENDPOINT unset; configure an Aiven ClickHouse connection in the UI" >&2
fi

# Prod HyperDX listens on HYPERDX_APP_PORT (UI) and API PORT.
export HYPERDX_APP_PORT="${HYPERDX_APP_PORT:-8080}"
export HYPERDX_API_PORT="${HYPERDX_API_PORT:-8000}"
export PORT="${PORT:-$HYPERDX_API_PORT}"

exec sh /etc/local/entry.prod.sh "$@"
