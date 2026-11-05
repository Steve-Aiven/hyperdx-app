import { generateId } from '@/datastore/ids';
import type {
  WebhookInput,
  WebhookRecord,
  WebhooksRepository,
} from '@/datastore/repositories';

import { query } from './client';
import { definedOnly, json } from './rows';

type WebhookRow = {
  id: string;
  team_id: string;
  service: WebhookRecord['service'];
  name: string;
  url: string | null;
  description: string | null;
  title_emoji: boolean | null;
  query_params: Record<string, string> | null;
  headers: Record<string, string> | null;
  body: string | null;
  created_at: Date;
  updated_at: Date;
};

function toRecord(row: WebhookRow): WebhookRecord {
  return {
    _id: row.id,
    id: row.id,
    team: row.team_id,
    service: row.service,
    name: row.name,
    ...definedOnly({
      url: row.url,
      description: row.description,
      titleEmoji: row.title_emoji,
      queryParams: row.query_params,
      headers: row.headers,
      body: row.body,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const fieldValues = (input: WebhookInput) => [
  input.service,
  input.name,
  input.url ?? null,
  input.description ?? null,
  input.titleEmoji ?? null,
  json(input.queryParams),
  json(input.headers),
  input.body ?? null,
];

export function createPostgresWebhooksRepository(): WebhooksRepository {
  return {
    async listByTeam(teamId) {
      const result = await query<WebhookRow>(
        'SELECT * FROM webhooks WHERE team_id = $1 ORDER BY id ASC',
        [teamId],
      );
      return result.rows.map(toRecord);
    },

    async getById(teamId, webhookId) {
      const result = await query<WebhookRow>(
        'SELECT * FROM webhooks WHERE id = $1 AND team_id = $2',
        [webhookId, teamId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async create(teamId, input) {
      // Unique (team, service, name): a clash raises 23505, see isDuplicateKeyError.
      const result = await query<WebhookRow>(
        `INSERT INTO webhooks
           (id, team_id, service, name, url, description, title_emoji,
            query_params, headers, body)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
         RETURNING *`,
        [generateId(), teamId, ...fieldValues(input)],
      );
      return toRecord(result.rows[0]);
    },

    async findByName(teamId, service, name) {
      const result = await query<WebhookRow>(
        'SELECT * FROM webhooks WHERE team_id = $1 AND service = $2 AND name = $3',
        [teamId, service, name],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async replace(teamId, webhookId, input, expected) {
      const result = await query<WebhookRow>(
        `UPDATE webhooks
         SET service = $3, name = $4, url = $5, description = $6,
             title_emoji = $7, query_params = $8::jsonb, headers = $9::jsonb,
             body = $10, updated_at = now()
         WHERE id = $1 AND team_id = $2
           AND ($11::boolean IS NOT TRUE
                OR (url IS NOT DISTINCT FROM $12 AND service = $13))
         RETURNING *`,
        [
          webhookId,
          teamId,
          ...fieldValues(input),
          expected != null,
          expected?.url ?? null,
          expected?.service ?? null,
        ],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async delete(teamId, webhookId) {
      const result = await query<WebhookRow>(
        'DELETE FROM webhooks WHERE id = $1 AND team_id = $2 RETURNING *',
        [webhookId, teamId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },
  };
}
