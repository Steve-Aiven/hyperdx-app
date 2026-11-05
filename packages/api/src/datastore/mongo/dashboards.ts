import type {
  DashboardRecord,
  DashboardsRepository,
} from '@/datastore/alertRepositories';
import Dashboard from '@/models/dashboard';

import { toPlain } from './convert';

function toRecord(doc: object): DashboardRecord {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return toPlain(doc as never, [
    'team',
    'createdBy',
    'updatedBy',
  ]) as unknown as DashboardRecord;
}

const orNull = (doc: object | null) => (doc ? toRecord(doc) : null);

export function createMongoDashboardsRepository(): DashboardsRepository {
  return {
    async listByTeam(teamId) {
      return (await Dashboard.find({ team: teamId })).map(toRecord);
    },

    async getById(teamId, id) {
      return orNull(await Dashboard.findOne({ _id: id, team: teamId }));
    },

    async getByIds(teamId, ids) {
      return (await Dashboard.find({ _id: { $in: ids }, team: teamId })).map(
        toRecord,
      );
    },

    async create(teamId, input, userId) {
      return toRecord(
        await Dashboard.create({
          ...input,
          team: teamId,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
    },

    async update(teamId, id, input, userId) {
      return orNull(
        await Dashboard.findOneAndUpdate(
          { _id: id, team: teamId },
          { ...input, updatedBy: userId },
          { new: true },
        ),
      );
    },

    async delete(teamId, id) {
      return orNull(
        await Dashboard.findOneAndDelete({ _id: id, team: teamId }),
      );
    },

    async distinctTags(teamId) {
      return Dashboard.distinct('tags', { team: teamId });
    },
  };
}
