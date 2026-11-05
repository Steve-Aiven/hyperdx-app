# HyperDX on Aiven Runtime

Builds HyperDX UI+API with:

- `DATASTORE=postgres` → Aiven for PostgreSQL (`hyperdx-pg`) for users, dashboards, alerts, sessions
- `CLICKHOUSE_ENDPOINT` → Aiven for ClickHouse (`hyperdx-ch`) for telemetry

## Build

From the monorepo root:

```bash
docker build -f docker/aiven/Dockerfile.runtime -t hyperdx-aiven .
```

Point the Aiven application VCS integration at this repository and
`docker/aiven/Dockerfile.runtime`.

## Env

See [`entrypoint.sh`](entrypoint.sh). Required at runtime:

- `DATABASE_URL` (from PG credential integration)
- `EXPRESS_SESSION_SECRET`
- `FRONTEND_URL`
- ClickHouse credentials / `CLICKHOUSE_ENDPOINT`
