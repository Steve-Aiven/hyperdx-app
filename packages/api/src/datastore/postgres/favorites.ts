import { generateId } from '@/datastore/ids';
import type { FavoriteRecord, FavoritesRepository } from '@/datastore/types';
import type { IFavorite } from '@/models/favorite';

import { query } from './client';

type FavoriteRow = {
  id: string;
  user_id: string;
  team_id: string;
  resource_type: IFavorite['resourceType'];
  resource_id: string;
  created_at: Date;
  updated_at: Date;
};

function toRecord(row: FavoriteRow): FavoriteRecord {
  return {
    _id: row.id,
    id: row.id,
    user: row.user_id,
    team: row.team_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPostgresFavoritesRepository(): FavoritesRepository {
  return {
    async list(userId, teamId) {
      const result = await query<FavoriteRow>(
        `SELECT id, user_id, team_id, resource_type, resource_id, created_at, updated_at
         FROM favorites
         WHERE user_id = $1 AND team_id = $2
         ORDER BY created_at ASC`,
        [userId, teamId],
      );
      return result.rows.map(toRecord);
    },

    async upsert(userId, teamId, resourceType, resourceId) {
      const id = generateId();
      const result = await query<FavoriteRow>(
        `INSERT INTO favorites (id, user_id, team_id, resource_type, resource_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (team_id, user_id, resource_type, resource_id)
         DO UPDATE SET updated_at = now()
         RETURNING id, user_id, team_id, resource_type, resource_id, created_at, updated_at`,
        [id, userId, teamId, resourceType, resourceId],
      );
      const row = result.rows[0];
      if (row == null) {
        throw new Error('Failed to upsert favorite');
      }
      return toRecord(row);
    },

    async remove(userId, teamId, resourceType, resourceId) {
      await query(
        `DELETE FROM favorites
         WHERE user_id = $1 AND team_id = $2
           AND resource_type = $3 AND resource_id = $4`,
        [userId, teamId, resourceType, resourceId],
      );
    },
  };
}
