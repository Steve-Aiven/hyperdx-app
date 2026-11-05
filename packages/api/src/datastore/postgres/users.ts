import type { OnboardingData } from '@hyperdx/common-utils/dist/types';
import { v4 as uuidv4 } from 'uuid';

import { generateId } from '@/datastore/ids';
import type { UserRecord, UsersRepository } from '@/datastore/repositories';

import { query, withClient } from './client';
import { hashPassword, verifyPassword } from './passwords';
import { buildSet } from './rows';

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  team_id: string | null;
  access_key: string;
  hash: string | null;
  salt: string | null;
  onboarding_data: OnboardingData;
  created_at: Date;
  updated_at: Date;
};

// Same wording as passport-local-mongoose so clients see one failure message
// regardless of backend, and a missing user is indistinguishable from a wrong
// password.
const AUTH_FAILED = 'Password or username is incorrect';

function toRecord(row: UserRow): UserRecord {
  return {
    _id: row.id,
    id: row.id,
    email: row.email,
    name: row.name ?? '',
    ...(row.team_id != null && { team: row.team_id }),
    accessKey: row.access_key,
    onboardingData: row.onboarding_data,
    hasPasswordAuth: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const first = (rows: UserRow[]) => (rows[0] ? toRecord(rows[0]) : null);

export function createPostgresUsersRepository(): UsersRepository {
  const findById = async (id: string) =>
    first(
      (await query<UserRow>('SELECT * FROM users WHERE id = $1', [id])).rows,
    );

  const findRowByEmail = async (email: string) =>
    (
      await query<UserRow>(
        'SELECT * FROM users WHERE lower(email) = lower($1) LIMIT 1',
        [email],
      )
    ).rows[0];

  return {
    findById,

    async findByEmail(email) {
      const row = await findRowByEmail(email);
      return row ? toRecord(row) : null;
    },

    async findByAccessKey(accessKey) {
      const result = await query<UserRow>(
        'SELECT * FROM users WHERE access_key = $1 LIMIT 1',
        [accessKey],
      );
      return first(result.rows);
    },

    async findByTeam(teamId) {
      const result = await query<UserRow>(
        'SELECT * FROM users WHERE team_id = $1 ORDER BY created_at ASC',
        [teamId],
      );
      return result.rows.map(toRecord);
    },

    async findByIds(ids) {
      const result = await query<UserRow>(
        'SELECT * FROM users WHERE id = ANY($1::text[])',
        [ids],
      );
      return result.rows.map(toRecord);
    },

    async register({ email, password, name, teamId }) {
      const { hash, salt } = await hashPassword(password);
      const result = await query<UserRow>(
        `INSERT INTO users (id, email, name, team_id, access_key, hash, salt)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          generateId(),
          email.toLowerCase(),
          name ?? null,
          teamId ?? null,
          uuidv4(),
          hash,
          salt,
        ],
      );
      return toRecord(result.rows[0]);
    },

    async update(userId, { teamId, name }) {
      const { clause, values } = buildSet({ team_id: teamId, name });
      if (clause === '') {
        return findById(userId);
      }
      const result = await query<UserRow>(
        `UPDATE users SET ${clause}, updated_at = now()
         WHERE id = $${values.length + 1} RETURNING *`,
        [...values, userId],
      );
      return first(result.rows);
    },

    async authenticate(email, password) {
      const row = await findRowByEmail(email);
      if (row?.hash == null || row.salt == null) {
        return { user: null, error: new Error(AUTH_FAILED) };
      }
      const ok = await verifyPassword(password, row.hash, row.salt);
      return ok
        ? { user: toRecord(row) }
        : { user: null, error: new Error(AUTH_FAILED) };
    },

    async rotateAccessKey(userId) {
      const result = await query<UserRow>(
        `UPDATE users SET access_key = $2, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [userId, uuidv4()],
      );
      return first(result.rows);
    },

    async completeOnboardingTask(userId, taskId) {
      // The NOT-contains guard skips the write once recorded; this runs on hot
      // save paths.
      const result = await query<UserRow>(
        `UPDATE users SET
           onboarding_data = jsonb_set(
             onboarding_data,
             '{completedTasks}',
             COALESCE(onboarding_data->'completedTasks', '[]'::jsonb) || to_jsonb($2::text)
           ),
           updated_at = now()
         WHERE id = $1
           AND NOT (COALESCE(onboarding_data->'completedTasks', '[]'::jsonb) ? $2::text)
         RETURNING *`,
        [userId, taskId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : findById(userId);
    },

    async setOnboardingDismissed(userId, isDismissed) {
      const result = await query<UserRow>(
        `UPDATE users SET
           onboarding_data = jsonb_set(onboarding_data, '{isDismissed}', to_jsonb($2::boolean)),
           updated_at = now()
         WHERE id = $1 RETURNING *`,
        [userId, isDismissed],
      );
      return first(result.rows);
    },

    async deleteFromTeam(teamId, userId, reassignToUserId) {
      return withClient(async client => {
        await client.query('BEGIN');
        try {
          await client.query(
            `UPDATE alerts
             SET doc = jsonb_set(doc, '{createdBy}', to_jsonb($3::text))
             WHERE team_id = $1 AND doc->>'createdBy' = $2`,
            [teamId, userId, reassignToUserId],
          );
          // Mongo has no foreign keys; here attribution columns would block
          // the delete, so clear them as a dangling ref would read.
          for (const table of ['dashboards', 'saved_searches']) {
            await client.query(
              `UPDATE ${table}
               SET created_by = NULLIF(created_by, $1),
                   updated_by = NULLIF(updated_by, $1)
               WHERE team_id = $2 AND (created_by = $1 OR updated_by = $1)`,
              [userId, teamId],
            );
          }
          const deleted = await client.query<UserRow>(
            'DELETE FROM users WHERE id = $1 AND team_id = $2 RETURNING *',
            [userId, teamId],
          );
          await client.query('COMMIT');
          return first(deleted.rows);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      });
    },
  };
}
