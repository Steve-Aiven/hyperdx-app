import { generateId } from '@/datastore/ids';
import type {
  ConnectionInput,
  ConnectionRecord,
  ConnectionsRepository,
} from '@/datastore/repositories';

import { query } from './client';
import { buildSet, definedOnly } from './rows';

type ConnectionRow = {
  id: string;
  team_id: string;
  name: string | null;
  host: string | null;
  username: string | null;
  password: string | null;
  hyperdx_setting_prefix: string | null;
  is_prometheus_endpoint: boolean | null;
  platform_provisioned: boolean | null;
  created_at: Date;
  updated_at: Date;
};

// Unset fields are interpolated into SQL, so they must come from this map.
const COLUMNS = {
  name: 'name',
  host: 'host',
  username: 'username',
  password: 'password',
  hyperdxSettingPrefix: 'hyperdx_setting_prefix',
  isPrometheusEndpoint: 'is_prometheus_endpoint',
  platformProvisioned: 'platform_provisioned',
} as const;

function toRecord(row: ConnectionRow, withPassword: boolean): ConnectionRecord {
  return {
    _id: row.id,
    id: row.id,
    team: row.team_id,
    name: row.name ?? '',
    host: row.host ?? '',
    username: row.username ?? '',
    ...(withPassword && row.password != null && { password: row.password }),
    ...definedOnly({
      hyperdxSettingPrefix: row.hyperdx_setting_prefix,
      isPrometheusEndpoint: row.is_prometheus_endpoint,
      platformProvisioned: row.platform_provisioned,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toColumns(input: ConnectionInput, unsetFields: string[] = []) {
  const columns: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMNS)) {
    const value = input[key as keyof typeof COLUMNS];
    if (value !== undefined) {
      columns[column] = value;
    }
    if (unsetFields.includes(key)) {
      columns[column] = null;
    }
  }
  return columns;
}

export function createPostgresConnectionsRepository(): ConnectionsRepository {
  return {
    async listAll() {
      const result = await query<ConnectionRow>(
        'SELECT * FROM connections ORDER BY id ASC',
      );
      return result.rows.map(row => toRecord(row, false));
    },

    async listByTeam(teamId) {
      const result = await query<ConnectionRow>(
        'SELECT * FROM connections WHERE team_id = $1 ORDER BY id ASC',
        [teamId],
      );
      return result.rows.map(row => toRecord(row, false));
    },

    async getById(teamId, connectionId, selectPassword = false) {
      const result = await query<ConnectionRow>(
        'SELECT * FROM connections WHERE id = $1 AND team_id = $2',
        [connectionId, teamId],
      );
      return result.rows[0] ? toRecord(result.rows[0], selectPassword) : null;
    },

    async exists(teamId, connectionId) {
      const result = await query(
        'SELECT 1 FROM connections WHERE id = $1 AND team_id = $2',
        [connectionId, teamId],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async create(teamId, input) {
      const columns = toColumns(input);
      const names = Object.keys(columns);
      const result = await query<ConnectionRow>(
        `INSERT INTO connections (id, team_id${names.map(n => `, ${n}`).join('')})
         VALUES ($1, $2${names.map((_, i) => `, $${i + 3}`).join('')})
         RETURNING *`,
        [generateId(), teamId, ...Object.values(columns)],
      );
      return toRecord(result.rows[0], false);
    },

    async update(teamId, connectionId, input, unsetFields) {
      const { clause, values } = buildSet(toColumns(input, unsetFields));
      if (clause === '') {
        return this.getById(teamId, connectionId);
      }
      const result = await query<ConnectionRow>(
        `UPDATE connections SET ${clause}, updated_at = now()
         WHERE id = $${values.length + 1} AND team_id = $${values.length + 2}
         RETURNING *`,
        [...values, connectionId, teamId],
      );
      return result.rows[0] ? toRecord(result.rows[0], false) : null;
    },

    async delete(teamId, connectionId) {
      const result = await query<ConnectionRow>(
        'DELETE FROM connections WHERE id = $1 AND team_id = $2 RETURNING *',
        [connectionId, teamId],
      );
      return result.rows[0] ? toRecord(result.rows[0], false) : null;
    },
  };
}
