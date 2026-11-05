import type {
  WebhookInput,
  WebhookRecord,
  WebhooksRepository,
} from '@/datastore/repositories';
import Webhook from '@/models/webhook';

import { toPlain } from './convert';

function toRecord(doc: object): WebhookRecord {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return toPlain(doc as never, ['team']) as unknown as WebhookRecord;
}

const orNull = (doc: object | null) => (doc ? toRecord(doc) : null);

const OPTIONAL_FIELDS = [
  'url',
  'description',
  'titleEmoji',
  'queryParams',
  'headers',
  'body',
] as const;

export function createMongoWebhooksRepository(): WebhooksRepository {
  return {
    async listByTeam(teamId) {
      return (await Webhook.find({ team: teamId })).map(toRecord);
    },

    async getById(teamId, webhookId) {
      return orNull(await Webhook.findOne({ _id: webhookId, team: teamId }));
    },

    async create(teamId, input) {
      return toRecord(await Webhook.create({ ...input, team: teamId }));
    },

    async findByName(teamId, service, name) {
      return orNull(await Webhook.findOne({ team: teamId, service, name }));
    },

    async replace(teamId, webhookId, input: WebhookInput, expected) {
      const $set: Record<string, unknown> = {
        name: input.name,
        service: input.service,
      };
      const $unset: Record<string, 1> = {};
      for (const field of OPTIONAL_FIELDS) {
        if (input[field] === undefined) {
          $unset[field] = 1;
        } else {
          $set[field] = input[field];
        }
      }
      return orNull(
        await Webhook.findOneAndUpdate(
          {
            _id: webhookId,
            team: teamId,
            ...(expected != null && {
              url: expected.url ?? null,
              service: expected.service,
            }),
          },
          Object.keys($unset).length > 0 ? { $set, $unset } : { $set },
          { new: true },
        ),
      );
    },

    async delete(teamId, webhookId) {
      return orNull(
        await Webhook.findOneAndDelete({ _id: webhookId, team: teamId }),
      );
    },
  };
}
