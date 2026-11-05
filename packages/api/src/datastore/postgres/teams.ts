import { v4 as uuidv4 } from 'uuid';

import { generateId } from '@/datastore/ids';
import type { TeamRecord, TeamsRepository } from '@/datastore/repositories';

import { query } from './client';
import { buildSet, definedOnly } from './rows';

type TeamRow = {
  id: string;
  name: string | null;
  allowed_auth_methods: 'password'[];
  hook_id: string;
  api_key: string;
  collector_authentication_enforced: boolean;
  is_metrics_series_table_enabled: boolean;
  metadata_max_rows_to_read: number | null;
  search_row_limit: number | null;
  query_timeout: number | null;
  field_metadata_disabled: boolean | null;
  parallelize_when_possible: boolean | null;
  filter_keys_fetch_limit: number | null;
  created_at: Date;
  updated_at: Date;
};

// Settings keys are interpolated into SQL, so they must come from this map.
const SETTING_COLUMNS = {
  metadataMaxRowsToRead: 'metadata_max_rows_to_read',
  searchRowLimit: 'search_row_limit',
  queryTimeout: 'query_timeout',
  fieldMetadataDisabled: 'field_metadata_disabled',
  parallelizeWhenPossible: 'parallelize_when_possible',
  filterKeysFetchLimit: 'filter_keys_fetch_limit',
} as const;

function toRecord(row: TeamRow): TeamRecord {
  return {
    _id: row.id,
    id: row.id,
    name: row.name ?? '',
    allowedAuthMethods: row.allowed_auth_methods,
    hookId: row.hook_id,
    apiKey: row.api_key,
    collectorAuthenticationEnforced: row.collector_authentication_enforced,
    isMetricsSeriesTableEnabled: row.is_metrics_series_table_enabled,
    ...definedOnly({
      metadataMaxRowsToRead: row.metadata_max_rows_to_read,
      searchRowLimit: row.search_row_limit,
      queryTimeout: row.query_timeout,
      fieldMetadataDisabled: row.field_metadata_disabled,
      parallelizeWhenPossible: row.parallelize_when_possible,
      filterKeysFetchLimit: row.filter_keys_fetch_limit,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPostgresTeamsRepository(): TeamsRepository {
  const getById = async (id: string) => {
    const result = await query<TeamRow>('SELECT * FROM teams WHERE id = $1', [
      id,
    ]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  };

  const updateColumns = async (
    teamId: string,
    columns: Record<string, unknown>,
  ) => {
    const { clause, values } = buildSet(columns);
    if (clause === '') {
      return getById(teamId);
    }
    const result = await query<TeamRow>(
      `UPDATE teams SET ${clause}, updated_at = now()
       WHERE id = $${values.length + 1} RETURNING *`,
      [...values, teamId],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  };

  return {
    async isExisting() {
      const result = await query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM teams) AS exists',
      );
      return result.rows[0]?.exists ?? false;
    },

    async create({ name, collectorAuthenticationEnforced = true }) {
      const result = await query<TeamRow>(
        `INSERT INTO teams (id, name, hook_id, api_key, collector_authentication_enforced)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          generateId(),
          name,
          uuidv4(),
          uuidv4(),
          collectorAuthenticationEnforced,
        ],
      );
      return toRecord(result.rows[0]);
    },

    getById,

    async getByApiKey(apiKey) {
      const result = await query<TeamRow>(
        'SELECT * FROM teams WHERE api_key = $1 LIMIT 1',
        [apiKey],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async getAll() {
      const result = await query<TeamRow>(
        'SELECT * FROM teams ORDER BY created_at ASC',
      );
      return result.rows.map(toRecord);
    },

    rotateApiKey(teamId) {
      return updateColumns(teamId, { api_key: uuidv4() });
    },

    setName(teamId, name) {
      return updateColumns(teamId, { name });
    },

    updateClickhouseSettings(teamId, settings) {
      const columns: Record<string, unknown> = {};
      for (const [key, column] of Object.entries(SETTING_COLUMNS)) {
        const value = settings[key as keyof typeof SETTING_COLUMNS];
        if (value !== undefined) {
          columns[column] = value;
        }
      }
      return updateColumns(teamId, columns);
    },
  };
}
