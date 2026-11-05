import { generateId } from '@/datastore/ids';
import type {
  PresetDashboardFilterInput,
  PresetDashboardFilterRecord,
  PresetDashboardFiltersRepository,
} from '@/datastore/repositories';

import { query } from './client';
import { definedOnly } from './rows';

type PresetRow = {
  id: string;
  team_id: string;
  source_id: string;
  name: string;
  source_metric_type: PresetDashboardFilterRecord['sourceMetricType'] | null;
  preset_dashboard: PresetDashboardFilterRecord['presetDashboard'];
  type: PresetDashboardFilterRecord['type'];
  expression: string;
  where_clause: string | null;
  where_language: PresetDashboardFilterRecord['whereLanguage'] | null;
  created_at: Date;
  updated_at: Date;
};

function toRecord(row: PresetRow): PresetDashboardFilterRecord {
  return {
    _id: row.id,
    id: row.id,
    team: row.team_id,
    source: row.source_id,
    name: row.name,
    presetDashboard: row.preset_dashboard,
    type: row.type,
    expression: row.expression,
    // whereLanguage is required by the shared schema even when `where` is unset.
    whereLanguage: row.where_language ?? 'lucene',
    ...definedOnly({
      sourceMetricType: row.source_metric_type,
      where: row.where_clause,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const fieldValues = (input: PresetDashboardFilterInput) => [
  input.source,
  input.name,
  input.sourceMetricType ?? null,
  input.presetDashboard,
  input.type,
  input.expression,
  input.where ?? null,
  input.whereLanguage ?? null,
];

export function createPostgresPresetDashboardFiltersRepository(): PresetDashboardFiltersRepository {
  return {
    async list(teamId, sourceId, presetDashboard) {
      const result = await query<PresetRow>(
        `SELECT * FROM preset_dashboard_filters
         WHERE team_id = $1 AND source_id = $2 AND preset_dashboard = $3
         ORDER BY id ASC`,
        [teamId, sourceId, presetDashboard],
      );
      return result.rows.map(toRecord);
    },

    async create(teamId, input) {
      const result = await query<PresetRow>(
        `INSERT INTO preset_dashboard_filters
           (id, team_id, source_id, name, source_metric_type, preset_dashboard,
            type, expression, where_clause, where_language)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [generateId(), teamId, ...fieldValues(input)],
      );
      return toRecord(result.rows[0]);
    },

    async update(teamId, id, input) {
      const result = await query<PresetRow>(
        `UPDATE preset_dashboard_filters
         SET source_id = $3, name = $4, source_metric_type = $5,
             preset_dashboard = $6, type = $7, expression = $8,
             where_clause = $9, where_language = $10, updated_at = now()
         WHERE id = $1 AND team_id = $2 RETURNING *`,
        [id, teamId, ...fieldValues(input)],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async delete(teamId, presetDashboard, id) {
      const result = await query<PresetRow>(
        `DELETE FROM preset_dashboard_filters
         WHERE id = $1 AND team_id = $2 AND preset_dashboard = $3 RETURNING *`,
        [id, teamId, presetDashboard],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },
  };
}
