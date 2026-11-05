import { generateId } from '@/datastore/ids';
import type {
  TeamInviteRecord,
  TeamInvitesRepository,
} from '@/datastore/repositories';

import { query } from './client';

type InviteRow = {
  id: string;
  team_id: string;
  email: string;
  name: string | null;
  token: string;
  created_at: Date;
  updated_at: Date;
};

const MAX_AGE_DAYS = 30;

// Reads skip expired rows so behavior matches Mongo's TTL index even between
// sweeps.
const NOT_EXPIRED = `created_at >= now() - make_interval(days => ${MAX_AGE_DAYS})`;

function toRecord(row: InviteRow): TeamInviteRecord {
  return {
    _id: row.id,
    id: row.id,
    teamId: row.team_id,
    email: row.email,
    ...(row.name != null && { name: row.name }),
    token: row.token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const first = (rows: InviteRow[]) => (rows[0] ? toRecord(rows[0]) : null);

export function createPostgresTeamInvitesRepository(): TeamInvitesRepository {
  const deleteExpired = async (maxAgeDays = MAX_AGE_DAYS) => {
    const result = await query(
      `DELETE FROM team_invites
       WHERE created_at < now() - make_interval(days => $1)`,
      [maxAgeDays],
    );
    return result.rowCount ?? 0;
  };

  return {
    async create({ teamId, email, name, token }) {
      // Expired rows would otherwise block re-inviting through the unique
      // (team, email) index until a sweep runs.
      await deleteExpired();
      const result = await query<InviteRow>(
        `INSERT INTO team_invites (id, team_id, email, name, token)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [generateId(), teamId, email, name ?? null, token],
      );
      return toRecord(result.rows[0]);
    },

    async findByTeamAndEmail(teamId, email) {
      const result = await query<InviteRow>(
        `SELECT * FROM team_invites
         WHERE team_id = $1 AND lower(email) = lower($2) AND ${NOT_EXPIRED}
         LIMIT 1`,
        [teamId, email],
      );
      return first(result.rows);
    },

    async findByToken(token) {
      const result = await query<InviteRow>(
        `SELECT * FROM team_invites WHERE token = $1 AND ${NOT_EXPIRED} LIMIT 1`,
        [token],
      );
      return first(result.rows);
    },

    async listByTeam(teamId) {
      const result = await query<InviteRow>(
        `SELECT * FROM team_invites
         WHERE team_id = $1 AND ${NOT_EXPIRED}
         ORDER BY created_at ASC`,
        [teamId],
      );
      return result.rows.map(toRecord);
    },

    async deleteById(id, teamId) {
      const result = await query<InviteRow>(
        `DELETE FROM team_invites
         WHERE id = $1 AND ($2::text IS NULL OR team_id = $2) RETURNING *`,
        [id, teamId ?? null],
      );
      return first(result.rows);
    },

    deleteExpired,
  };
}
