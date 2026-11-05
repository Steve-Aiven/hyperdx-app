import { generateId } from '@/datastore/ids';
import type {
  RecordBase,
  SourceInput,
  SourceRecord,
  SourcesRepository,
} from '@/datastore/repositories';

import { query } from './client';
import { json } from './rows';

type SourceRow = {
  id: string;
  team_id: string;
  connection_id: string | null;
  kind: string;
  doc: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

function toRecord(row: SourceRow): SourceRecord {
  // The doc is the validated input; the discriminated union cannot be
  // re-proven from a jsonb column.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return {
    ...row.doc,
    _id: row.id,
    id: row.id,
    team: row.team_id,
    connection: row.connection_id ?? '',
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as SourceRecord;
}

// kind/connection live in columns for FK + filtering; the rest stays in doc.
function splitInput(input: SourceInput) {
  const {
    kind,
    connection,
    team: _team,
    // Callers may spread a stored record back in as the replacement.
    _id: _recordId,
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    // Mirrors the mongoose setter: '' means "unset".
    ...rest
  } = input as SourceInput & Partial<RecordBase> & { team?: string };
  const doc: Record<string, unknown> = { ...rest };
  if (doc.minAutoGranularity === '') {
    delete doc.minAutoGranularity;
  }
  return { kind, connectionId: String(connection), doc };
}

export function createPostgresSourcesRepository(): SourcesRepository {
  return {
    async listByTeam(teamId) {
      const result = await query<SourceRow>(
        'SELECT * FROM sources WHERE team_id = $1 ORDER BY id ASC',
        [teamId],
      );
      return result.rows.map(toRecord);
    },

    async getById(teamId, sourceId) {
      const result = await query<SourceRow>(
        'SELECT * FROM sources WHERE id = $1 AND team_id = $2',
        [sourceId, teamId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async create(teamId, input) {
      const { kind, connectionId, doc } = splitInput(input);
      const result = await query<SourceRow>(
        `INSERT INTO sources (id, team_id, connection_id, kind, doc)
         VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
        [generateId(), teamId, connectionId, kind, json(doc)],
      );
      return toRecord(result.rows[0]);
    },

    async replace(teamId, sourceId, input) {
      const { kind, connectionId, doc } = splitInput(input);
      const result = await query<SourceRow>(
        `UPDATE sources
         SET connection_id = $3, kind = $4, doc = $5::jsonb, updated_at = now()
         WHERE id = $1 AND team_id = $2 RETURNING *`,
        [sourceId, teamId, connectionId, kind, json(doc)],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async delete(teamId, sourceId) {
      const result = await query<SourceRow>(
        'DELETE FROM sources WHERE id = $1 AND team_id = $2 RETURNING *',
        [sourceId, teamId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },
  };
}
