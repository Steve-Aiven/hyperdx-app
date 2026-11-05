# App-state datastore

HyperDX application state (users, teams, dashboards, alerts, sessions) is
accessed through a pluggable datastore. Telemetry stays in ClickHouse.

## Backends

| `DATASTORE` | Connection env | Notes |
| --- | --- | --- |
| `mongo` (default) | `MONGO_URI` | Existing mongoose models; unchanged default |
| `postgres` | `DATABASE_URL` | Native PostgreSQL (Aiven for PostgreSQL) |

## Layout

- `types.ts` / `repositories.ts` / `alertRepositories.ts` — interfaces
- `mongo/` — mongoose adapters
- `postgres/` — `pg` + SQL migrations
- Controllers call `getDatastore()` instead of importing models directly

## Aiven

Runtime image: `docker/aiven/Dockerfile.runtime`. Sets `DATASTORE=postgres` and
expects `DATABASE_URL` from an `application_service_credential` integration on
`hyperdx-pg`.
