import type {
  AlertHistoriesRepository,
  AlertHistoryRecord,
  HistoryWindow,
  HistoryWindowRow,
  LatestAlertHistory,
} from '@/datastore/alertRepositories';
import { generateId } from '@/datastore/ids';
import type { AlertState, IAlertError } from '@/models/alert';
import type { GroupValue, IAlertHistory } from '@/models/alertHistory';

import { query } from './client';
import { json } from './rows';

type HistoryRow = {
  id: string;
  alert_id: string;
  counts: number;
  state: AlertState;
  last_values: { startTime: string; count: number }[];
  group_key: string | null;
  group_values: GroupValue[] | null;
  fired: boolean | null;
  errors: (Omit<IAlertError, 'timestamp'> & { timestamp: string })[] | null;
  analytics: IAlertHistory['analytics'] | null;
  created_at: Date;
};

const reviveLastValues = (values: HistoryRow['last_values']) =>
  values.map(v => ({ ...v, startTime: new Date(v.startTime) }));

const reviveErrors = (errors: NonNullable<HistoryRow['errors']>) =>
  errors.map(e => ({ ...e, timestamp: new Date(e.timestamp) }));

function toWindowRow(row: HistoryRow): HistoryWindowRow {
  return {
    state: row.state,
    counts: row.counts,
    lastValues: reviveLastValues(row.last_values),
    ...(row.group_key != null && { group: row.group_key }),
    ...(row.fired != null && { fired: row.fired }),
    ...(row.errors != null && { errors: reviveErrors(row.errors) }),
    ...(row.analytics != null && { analytics: row.analytics }),
  };
}

function toRecord(row: HistoryRow): AlertHistoryRecord {
  return {
    ...toWindowRow(row),
    _id: row.id,
    alert: row.alert_id,
    createdAt: row.created_at,
    ...(row.group_values != null && { groupValues: row.group_values }),
  };
}

function toLatest(row: Partial<HistoryRow>): LatestAlertHistory {
  return {
    _id: row.alert_id as string,
    createdAt: row.created_at as Date,
    state: row.state as AlertState,
    ...(row.group_key != null && { group: row.group_key }),
    ...(row.fired != null && { fired: row.fired }),
    ...(row.group_values != null && { groupValues: row.group_values }),
  };
}

export function createPostgresAlertHistoriesRepository(): AlertHistoriesRepository {
  return {
    async create(alertId, input) {
      const result = await query<HistoryRow>(
        `INSERT INTO alert_histories
           (id, alert_id, counts, state, last_values, group_key, group_values,
            fired, errors, analytics, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9::jsonb,
                 $10::jsonb, $11)
         RETURNING *`,
        [
          generateId(),
          alertId,
          input.counts ?? 0,
          input.state,
          json(input.lastValues ?? []),
          input.group ?? null,
          json(input.groupValues),
          input.fired ?? null,
          json(input.errors),
          json(input.analytics),
          input.createdAt,
        ],
      );
      return toRecord(result.rows[0]);
    },

    async deleteMany({ alertId, state, createdAt }) {
      const params: unknown[] = [alertId];
      const conditions = ['alert_id = $1'];
      if (state != null) {
        params.push(state);
        conditions.push(`state = $${params.length}`);
      }
      if (createdAt instanceof Date) {
        params.push(createdAt);
        conditions.push(`created_at = $${params.length}`);
      } else {
        params.push(createdAt.gt, createdAt.lte);
        conditions.push(
          `created_at > $${params.length - 1} AND created_at <= $${params.length}`,
        );
      }
      const result = await query(
        `DELETE FROM alert_histories WHERE ${conditions.join(' AND ')}`,
        params,
      );
      return result.rowCount ?? 0;
    },

    async upsertError(alertId, createdAt, errors, analytics) {
      // One ERROR row per (alert, window): retries update it in place.
      await query(
        `WITH updated AS (
           UPDATE alert_histories
           SET errors = $4::jsonb, analytics = COALESCE($5::jsonb, analytics)
           WHERE alert_id = $1 AND created_at = $2 AND state = 'ERROR'
           RETURNING id
         )
         INSERT INTO alert_histories
           (id, alert_id, counts, state, last_values, errors, analytics, created_at)
         SELECT $3, $1, 0, 'ERROR', '[]'::jsonb, $4::jsonb, $5::jsonb, $2
         WHERE NOT EXISTS (SELECT 1 FROM updated)`,
        [alertId, createdAt, generateId(), json(errors), json(analytics)],
      );
    },

    async getPrevious(alertId, now, lookbackMs) {
      // ERROR rows record failed evaluations; counting them as evaluated would
      // stop the failed window from being retried.
      const result = await query<HistoryRow>(
        `SELECT DISTINCT ON (alert_id, COALESCE(group_key, ''))
                alert_id, created_at, state, group_key, fired, group_values
         FROM alert_histories
         WHERE alert_id = $1
           AND created_at <= $2
           AND created_at >= $3
           AND state <> 'ERROR'
         ORDER BY alert_id, COALESCE(group_key, ''), created_at DESC`,
        [alertId, now, new Date(now.getTime() - lookbackMs)],
      );
      return result.rows.map(toLatest);
    },

    async getConsecutiveWindow(alertId, from, to) {
      const result = await query<HistoryRow>(
        `SELECT alert_id, created_at, state, group_key, fired
         FROM alert_histories
         WHERE alert_id = $1
           AND created_at >= $2 AND created_at < $3
           AND state <> 'ERROR'
         ORDER BY alert_id, COALESCE(group_key, ''), created_at DESC`,
        [alertId, from, to],
      );
      return result.rows.map(toLatest);
    },

    async getWindows(alertId, range, limit) {
      const params: unknown[] = [alertId];
      const conditions = ['alert_id = $1'];
      const bounds = [
        ['gte', '>='],
        ['gt', '>'],
        ['lte', '<='],
        ['lt', '<'],
      ] as const;
      for (const [key, op] of bounds) {
        const value = range[key];
        if (value != null) {
          params.push(value);
          conditions.push(`created_at ${op} $${params.length}`);
        }
      }
      const where = conditions.join(' AND ');
      params.push(limit);
      const result = await query<HistoryRow>(
        `WITH windows AS (
           SELECT DISTINCT created_at FROM alert_histories
           WHERE ${where}
           ORDER BY created_at DESC
           LIMIT $${params.length}
         )
         SELECT h.* FROM alert_histories h
         JOIN windows w ON w.created_at = h.created_at
         WHERE h.alert_id = $1
         ORDER BY h.created_at DESC, h.id ASC`,
        params,
      );
      const windows: HistoryWindow[] = [];
      for (const row of result.rows) {
        const current = windows[windows.length - 1];
        if (
          current &&
          current.createdAt.getTime() === row.created_at.getTime()
        ) {
          current.rows.push(toWindowRow(row));
        } else {
          windows.push({ createdAt: row.created_at, rows: [toWindowRow(row)] });
        }
      }
      return windows;
    },

    async getTransitionWindows(alertId, from, to) {
      const result = await query<HistoryRow>(
        `SELECT created_at, state, last_values
         FROM alert_histories
         WHERE alert_id = $1 AND created_at >= $2 AND created_at <= $3
           AND state <> 'ERROR'
         ORDER BY created_at ASC`,
        [alertId, from, to],
      );
      const windows: {
        createdAt: Date;
        states: string[];
        bucketStarts: Date[][];
      }[] = [];
      for (const row of result.rows) {
        const starts = reviveLastValues(row.last_values).map(v => v.startTime);
        const current = windows[windows.length - 1];
        if (
          current &&
          current.createdAt.getTime() === row.created_at.getTime()
        ) {
          current.states.push(row.state);
          current.bucketStarts.push(starts);
        } else {
          windows.push({
            createdAt: row.created_at,
            states: [row.state],
            bucketStarts: [starts],
          });
        }
      }
      return windows;
    },
  };
}
