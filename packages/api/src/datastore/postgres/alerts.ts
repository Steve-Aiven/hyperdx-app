import type {
  AlertInput,
  AlertRecord,
  AlertsRepository,
} from '@/datastore/alertRepositories';
import { generateId } from '@/datastore/ids';
import type { AlertState, IAlertError } from '@/models/alert';

import { alertFilterSql } from './alertFilter';
import { query } from './client';
import { json, reviveDate } from './rows';

type AlertRow = {
  id: string;
  team_id: string;
  doc: Record<string, unknown>;
  state: AlertState;
  created_at: Date;
  updated_at: Date;
};

type StoredSilenced = { by?: string; at: string; until: string };
type StoredError = Omit<IAlertError, 'timestamp'> & { timestamp: string };

// jsonb has no Date type, so every Date in the doc comes back as an ISO string.
function toRecord(row: AlertRow): AlertRecord {
  const { silenced, executionErrors, scheduleStartAt, ...rest } = row.doc as {
    silenced?: StoredSilenced;
    executionErrors?: StoredError[];
    scheduleStartAt?: string | null;
  } & Record<string, unknown>;

  // doc is written from validated AlertInput values only.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return {
    ...rest,
    ...(scheduleStartAt !== undefined && {
      scheduleStartAt: reviveDate(scheduleStartAt) ?? null,
    }),
    ...(silenced != null && {
      silenced: {
        ...silenced,
        at: new Date(silenced.at),
        until: new Date(silenced.until),
      },
    }),
    ...(executionErrors != null && {
      executionErrors: executionErrors.map(e => ({
        ...e,
        timestamp: new Date(e.timestamp),
      })),
    }),
    _id: row.id,
    id: row.id,
    team: row.team_id,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as AlertRecord;
}

const first = (rows: AlertRow[]) => (rows[0] ? toRecord(rows[0]) : null);

const distinctTagsSql = `
  SELECT DISTINCT jsonb_array_elements_text(doc->'tags') AS tag
  FROM alerts
  WHERE team_id = $1 AND jsonb_typeof(doc->'tags') = 'array'`;

export function createPostgresAlertsRepository(): AlertsRepository {
  return {
    async listByTeam(teamId) {
      const result = await query<AlertRow>(
        'SELECT * FROM alerts WHERE team_id = $1 ORDER BY id ASC',
        [teamId],
      );
      return result.rows.map(toRecord);
    },

    async listAll() {
      const result = await query<AlertRow>(
        'SELECT * FROM alerts ORDER BY id ASC',
      );
      return result.rows.map(toRecord);
    },

    async list(teamId, filter = {}, options = {}) {
      const { sort = 'id', offset, limit, cursor } = options;
      const { where, params } = alertFilterSql(teamId, filter, cursor);
      // "C" collation sorts by bytes, like Mongo, so cursors stay stable.
      const order =
        sort === 'displayName'
          ? `(doc->>'displayName') COLLATE "C" ASC NULLS FIRST, id ASC`
          : 'id ASC';
      const result = await query<AlertRow>(
        `SELECT * FROM alerts WHERE ${where} ORDER BY ${order}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit ?? null, offset ?? 0],
      );
      return result.rows.map(toRecord);
    },

    async count(teamId, filter = {}) {
      const { where, params } = alertFilterSql(teamId, filter);
      const result = await query<{ count: string }>(
        `SELECT count(*) AS count FROM alerts WHERE ${where}`,
        params,
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async listTileAlerts(teamId, dashboardId) {
      const result = await query<AlertRow>(
        `SELECT * FROM alerts
         WHERE team_id = $1 AND doc->>'source' = 'tile'
           AND ($2::text IS NULL OR doc->>'dashboard' = $2)
         ORDER BY id ASC`,
        [teamId, dashboardId ?? null],
      );
      return result.rows.map(toRecord);
    },

    async getById(teamId, id) {
      const result = await query<AlertRow>(
        'SELECT * FROM alerts WHERE id = $1 AND team_id = $2',
        [id, teamId],
      );
      return first(result.rows);
    },

    async create(teamId, input: AlertInput) {
      const { state, ...doc } = input;
      const result = await query<AlertRow>(
        `INSERT INTO alerts (id, team_id, doc, state)
         VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
        [generateId(), teamId, json(doc), state ?? 'OK'],
      );
      return toRecord(result.rows[0]);
    },

    async update(teamId, id, patch) {
      const { state, ...fields } = patch;
      const unset = Object.entries(fields)
        .filter(([, value]) => value === undefined)
        .map(([key]) => key);
      // `||` replaces top-level keys wholesale, matching a mongoose $set.
      const result = await query<AlertRow>(
        `UPDATE alerts
         SET doc = (doc - $3::text[]) || $4::jsonb,
             state = COALESCE($5, state),
             updated_at = now()
         WHERE id = $1 AND team_id = $2 RETURNING *`,
        [id, teamId, unset, json(fields), state ?? null],
      );
      return first(result.rows);
    },

    async setExecutionResult(alertId, executionErrors, state) {
      await query(
        `UPDATE alerts
         SET state = COALESCE($3, state),
             doc = jsonb_set(doc, '{executionErrors}', $2::jsonb),
             updated_at = now()
         WHERE id = $1`,
        [alertId, json(executionErrors), state ?? null],
      );
    },

    async delete(teamId, id) {
      const result = await query<AlertRow>(
        'DELETE FROM alerts WHERE id = $1 AND team_id = $2 RETURNING *',
        [id, teamId],
      );
      return first(result.rows);
    },

    async deleteBySavedSearch(teamId, savedSearchId) {
      const result = await query(
        `DELETE FROM alerts WHERE team_id = $1 AND doc->>'savedSearch' = $2`,
        [teamId, savedSearchId],
      );
      return result.rowCount ?? 0;
    },

    async deleteByDashboard(teamId, dashboardId, tileIds) {
      const result = await query(
        `DELETE FROM alerts
         WHERE team_id = $1
           AND doc->>'dashboard' = $2
           AND doc->>'source' = 'tile'
           AND ($3::text[] IS NULL OR doc->>'tileId' = ANY($3::text[]))`,
        [teamId, dashboardId, tileIds ?? null],
      );
      return result.rowCount ?? 0;
    },

    async countByWebhook(teamId, webhookId) {
      // Matches the singular `channel` like the Mongo query; writers keep it
      // mirrored to channels[0].
      const result = await query<{ count: string }>(
        `SELECT count(*) AS count FROM alerts
         WHERE team_id = $1 AND doc->'channel'->>'webhookId' = $2`,
        [teamId, webhookId],
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async distinctTags(teamId) {
      const result = await query<{ tag: string }>(distinctTagsSql, [teamId]);
      return result.rows.map(r => r.tag);
    },
  };
}
