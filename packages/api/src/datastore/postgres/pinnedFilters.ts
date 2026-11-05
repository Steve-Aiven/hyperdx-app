import type { PinnedFiltersValue } from '@hyperdx/common-utils/dist/types';

import { generateId } from '@/datastore/ids';
import type {
  PinnedFilterRecord,
  PinnedFiltersRepository,
} from '@/datastore/repositories';

import { query } from './client';
import { json } from './rows';

type PinnedFilterRow = {
  id: string;
  team_id: string;
  source_id: string;
  fields: string[];
  filters: PinnedFiltersValue;
  created_at: Date;
  updated_at: Date;
};

function toRecord(row: PinnedFilterRow): PinnedFilterRecord {
  return {
    _id: row.id,
    id: row.id,
    team: row.team_id,
    source: row.source_id,
    fields: row.fields,
    filters: row.filters,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPostgresPinnedFiltersRepository(): PinnedFiltersRepository {
  return {
    async get(teamId, sourceId) {
      const result = await query<PinnedFilterRow>(
        'SELECT * FROM pinned_filters WHERE team_id = $1 AND source_id = $2',
        [teamId, sourceId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async upsert(teamId, sourceId, data) {
      const result = await query<PinnedFilterRow>(
        `INSERT INTO pinned_filters (id, team_id, source_id, fields, filters)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
         ON CONFLICT (team_id, source_id)
         DO UPDATE SET fields = EXCLUDED.fields, filters = EXCLUDED.filters,
                       updated_at = now()
         RETURNING *`,
        [generateId(), teamId, sourceId, json(data.fields), json(data.filters)],
      );
      return toRecord(result.rows[0]);
    },
  };
}
