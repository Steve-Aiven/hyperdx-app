import type {
  DashboardInput,
  DashboardRecord,
  DashboardsRepository,
} from '@/datastore/alertRepositories';
import { generateId } from '@/datastore/ids';

import { query } from './client';
import { buildSet, definedOnly, json } from './rows';

type DashboardRow = {
  id: string;
  team_id: string;
  name: string;
  tiles: DashboardRecord['tiles'];
  tags: string[];
  filters: DashboardRecord['filters'];
  saved_query: string | null;
  saved_query_language: DashboardRecord['savedQueryLanguage'];
  saved_filter_values: DashboardRecord['savedFilterValues'] | null;
  saved_date_range: DashboardRecord['savedDateRange'] | null;
  containers: DashboardRecord['containers'] | null;
  created_by: string | null;
  updated_by: string | null;
  provisioned: boolean;
  created_at: Date;
  updated_at: Date;
};

function toRecord(row: DashboardRow): DashboardRecord {
  return {
    _id: row.id,
    id: row.id,
    team: row.team_id,
    name: row.name,
    tiles: row.tiles,
    tags: row.tags,
    filters: row.filters,
    ...definedOnly({
      savedQuery: row.saved_query,
      savedQueryLanguage: row.saved_query_language,
      savedFilterValues: row.saved_filter_values,
      savedDateRange: row.saved_date_range,
      containers: row.containers,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
    }),
    provisioned: row.provisioned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Only keys present on the input are written; undefined leaves a column alone.
function toColumns(input: Partial<DashboardInput>) {
  return {
    name: input.name,
    tiles: input.tiles === undefined ? undefined : json(input.tiles),
    tags: input.tags === undefined ? undefined : json(input.tags),
    filters: input.filters === undefined ? undefined : json(input.filters),
    saved_query: input.savedQuery,
    saved_query_language: input.savedQueryLanguage,
    saved_filter_values:
      input.savedFilterValues === undefined
        ? undefined
        : json(input.savedFilterValues),
    saved_date_range:
      input.savedDateRange === undefined
        ? undefined
        : json(input.savedDateRange),
    containers:
      input.containers === undefined ? undefined : json(input.containers),
    provisioned: input.provisioned,
  };
}

export function createPostgresDashboardsRepository(): DashboardsRepository {
  return {
    async listByTeam(teamId) {
      const result = await query<DashboardRow>(
        'SELECT * FROM dashboards WHERE team_id = $1 ORDER BY id ASC',
        [teamId],
      );
      return result.rows.map(toRecord);
    },

    async getById(teamId, id) {
      const result = await query<DashboardRow>(
        'SELECT * FROM dashboards WHERE id = $1 AND team_id = $2',
        [id, teamId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async getByIds(teamId, ids) {
      const result = await query<DashboardRow>(
        'SELECT * FROM dashboards WHERE team_id = $1 AND id = ANY($2::text[])',
        [teamId, ids],
      );
      return result.rows.map(toRecord);
    },

    async create(teamId, input, userId) {
      // The partial unique index on (name, team_id) WHERE provisioned makes a
      // duplicate provisioned dashboard raise 23505, like Mongo's E11000.
      const columns = Object.fromEntries(
        Object.entries(toColumns(input)).filter(([, v]) => v !== undefined),
      );
      const names = Object.keys(columns);
      const result = await query<DashboardRow>(
        `INSERT INTO dashboards (id, team_id, created_by, updated_by${names.map(n => `, ${n}`).join('')})
         VALUES ($1, $2, $3, $3${names.map((_, i) => `, $${i + 4}`).join('')})
         RETURNING *`,
        [generateId(), teamId, userId ?? null, ...Object.values(columns)],
      );
      return toRecord(result.rows[0]);
    },

    async update(teamId, id, input, userId) {
      const { clause, values } = buildSet({
        ...toColumns(input),
        updated_by: userId,
      });
      const result = await query<DashboardRow>(
        `UPDATE dashboards SET ${clause === '' ? '' : `${clause}, `}updated_at = now()
         WHERE id = $${values.length + 1} AND team_id = $${values.length + 2}
         RETURNING *`,
        [...values, id, teamId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async delete(teamId, id) {
      const result = await query<DashboardRow>(
        'DELETE FROM dashboards WHERE id = $1 AND team_id = $2 RETURNING *',
        [id, teamId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async distinctTags(teamId) {
      const result = await query<{ tag: string }>(
        'SELECT DISTINCT jsonb_array_elements_text(tags) AS tag FROM dashboards WHERE team_id = $1',
        [teamId],
      );
      return result.rows.map(r => r.tag);
    },
  };
}
