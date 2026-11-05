import type {
  SavedSearchesRepository,
  SavedSearchInput,
  SavedSearchRecord,
} from '@/datastore/alertRepositories';
import { generateId } from '@/datastore/ids';

import { query } from './client';
import { json } from './rows';

type SavedSearchRow = {
  id: string;
  team_id: string;
  source_id: string | null;
  name: string | null;
  doc: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
};

function toRecord(row: SavedSearchRow): SavedSearchRecord {
  // doc holds the validated saved search fields (select, where, tags, ...).
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return {
    ...row.doc,
    _id: row.id,
    id: row.id,
    team: row.team_id,
    source: row.source_id ?? '',
    name: row.name ?? '',
    ...(row.created_by != null && { createdBy: row.created_by }),
    ...(row.updated_by != null && { updatedBy: row.updated_by }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as SavedSearchRecord;
}

function splitInput(input: SavedSearchInput) {
  const {
    name,
    source,
    // Callers may spread a stored record back in; its server-owned fields
    // live in columns, not in the doc.
    _id: _recordId,
    id: _id,
    team: _team,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    createdBy: _createdBy,
    updatedBy: _updatedBy,
    ...doc
  } = input as SavedSearchInput & Partial<SavedSearchRecord>;
  return { name, source, doc };
}

export function createPostgresSavedSearchesRepository(): SavedSearchesRepository {
  return {
    async listByTeam(teamId) {
      const result = await query<SavedSearchRow>(
        'SELECT * FROM saved_searches WHERE team_id = $1 ORDER BY id ASC',
        [teamId],
      );
      return result.rows.map(toRecord);
    },

    async getById(teamId, id) {
      const result = await query<SavedSearchRow>(
        'SELECT * FROM saved_searches WHERE id = $1 AND team_id = $2',
        [id, teamId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async getByIds(teamId, ids) {
      const result = await query<SavedSearchRow>(
        'SELECT * FROM saved_searches WHERE team_id = $1 AND id = ANY($2::text[])',
        [teamId, ids],
      );
      return result.rows.map(toRecord);
    },

    async listPage(teamId, { offset, limit }) {
      const [rows, count] = await Promise.all([
        query<SavedSearchRow>(
          `SELECT * FROM saved_searches WHERE team_id = $1
           ORDER BY id ASC LIMIT $2 OFFSET $3`,
          [teamId, limit, offset],
        ),
        query<{ count: string }>(
          'SELECT count(*) AS count FROM saved_searches WHERE team_id = $1',
          [teamId],
        ),
      ]);
      return {
        data: rows.rows.map(toRecord),
        total: Number(count.rows[0]?.count ?? 0),
      };
    },

    async create(teamId, input, userId) {
      const { name, source, doc } = splitInput(input);
      const result = await query<SavedSearchRow>(
        `INSERT INTO saved_searches
           (id, team_id, source_id, name, doc, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6) RETURNING *`,
        [generateId(), teamId, source, name, json(doc), userId ?? null],
      );
      return toRecord(result.rows[0]);
    },

    async update(teamId, id, input, userId) {
      const { name, source, doc } = splitInput(input);
      // doc is merged, not replaced: keys left out of the input keep their
      // stored values, like an update with undefined fields in Mongo.
      // created_by is never touched: ownership attribution is set once.
      const result = await query<SavedSearchRow>(
        `UPDATE saved_searches
         SET source_id = $3, name = $4, doc = doc || $5::jsonb, updated_by = $6,
             updated_at = now()
         WHERE id = $1 AND team_id = $2 RETURNING *`,
        [id, teamId, source, name, json(doc), userId ?? null],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async delete(teamId, id) {
      const result = await query<SavedSearchRow>(
        'DELETE FROM saved_searches WHERE id = $1 AND team_id = $2 RETURNING *',
        [id, teamId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async distinctTags(teamId) {
      const result = await query<{ tag: string }>(
        `SELECT DISTINCT jsonb_array_elements_text(doc->'tags') AS tag
         FROM saved_searches
         WHERE team_id = $1 AND jsonb_typeof(doc->'tags') = 'array'`,
        [teamId],
      );
      return result.rows.map(r => r.tag);
    },
  };
}
