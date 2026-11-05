import type {
  AlertRecord,
  AlertsRepository,
} from '@/datastore/alertRepositories';
import Alert, { AlertSource } from '@/models/alert';

import { buildMongoAlertFilter } from './alertFilter';
import { idOf, toPlain } from './convert';

function toRecord(doc: object): AlertRecord {
  const plain = toPlain(doc as never, [
    'team',
    'createdBy',
    'savedSearch',
    'dashboard',
  ]);
  const silenced = plain.silenced as { by?: unknown } | undefined;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return {
    ...plain,
    ...(silenced != null && {
      silenced: {
        ...silenced,
        ...(silenced.by != null && { by: idOf(silenced.by) }),
      },
    }),
  } as unknown as AlertRecord;
}

const orNull = (doc: object | null) => (doc ? toRecord(doc) : null);

export function createMongoAlertsRepository(): AlertsRepository {
  return {
    async listByTeam(teamId) {
      return (await Alert.find({ team: teamId })).map(toRecord);
    },

    async listAll() {
      return (await Alert.find({})).map(toRecord);
    },

    async list(teamId, filter = {}, options = {}) {
      const { sort = 'id', offset, limit, cursor } = options;
      const query = Alert.find(buildMongoAlertFilter(teamId, filter, cursor));
      query.sort(
        sort === 'displayName' ? { displayName: 1, _id: 1 } : { _id: 1 },
      );
      if (offset != null) query.skip(offset);
      if (limit != null) query.limit(limit);
      return (await query).map(toRecord);
    },

    async count(teamId, filter = {}) {
      return Alert.countDocuments(buildMongoAlertFilter(teamId, filter));
    },

    async listTileAlerts(teamId, dashboardId) {
      return (
        await Alert.find({
          team: teamId,
          source: AlertSource.TILE,
          ...(dashboardId != null && { dashboard: dashboardId }),
        })
      ).map(toRecord);
    },

    async getById(teamId, id) {
      return orNull(await Alert.findOne({ _id: id, team: teamId }));
    },

    async create(teamId, input) {
      return toRecord(await Alert.create({ ...input, team: teamId }));
    },

    async update(teamId, id, patch) {
      const $set: Record<string, unknown> = {};
      const $unset: Record<string, 1> = {};
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
          $unset[key] = 1;
        } else {
          $set[key] = value;
        }
      }
      return orNull(
        await Alert.findOneAndUpdate(
          { _id: id, team: teamId },
          {
            ...(Object.keys($set).length > 0 && { $set }),
            ...(Object.keys($unset).length > 0 && { $unset }),
          },
          { new: true },
        ),
      );
    },

    async setExecutionResult(alertId, executionErrors, state) {
      await Alert.updateOne(
        { _id: alertId },
        { $set: { executionErrors, ...(state != null && { state }) } },
      );
    },

    async delete(teamId, id) {
      return orNull(await Alert.findOneAndDelete({ _id: id, team: teamId }));
    },

    async deleteBySavedSearch(teamId, savedSearchId) {
      const result = await Alert.deleteMany({
        savedSearch: savedSearchId,
        team: teamId,
      });
      return result.deletedCount ?? 0;
    },

    async deleteByDashboard(teamId, dashboardId, tileIds) {
      const result = await Alert.deleteMany({
        dashboard: dashboardId,
        team: teamId,
        source: AlertSource.TILE,
        ...(tileIds && { tileId: { $in: tileIds } }),
      });
      return result.deletedCount ?? 0;
    },

    async countByWebhook(teamId, webhookId) {
      return Alert.countDocuments({
        'channel.webhookId': webhookId,
        team: teamId,
      });
    },

    async distinctTags(teamId) {
      return Alert.distinct('tags', { team: teamId });
    },
  };
}
