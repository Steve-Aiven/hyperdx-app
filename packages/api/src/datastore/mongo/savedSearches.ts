import type {
  SavedSearchesRepository,
  SavedSearchRecord,
} from '@/datastore/alertRepositories';
import { SavedSearch } from '@/models/savedSearch';

import { toPlain } from './convert';

function toRecord(doc: object): SavedSearchRecord {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return toPlain(doc as never, [
    'team',
    'source',
    'createdBy',
    'updatedBy',
  ]) as unknown as SavedSearchRecord;
}

const orNull = (doc: object | null) => (doc ? toRecord(doc) : null);

export function createMongoSavedSearchesRepository(): SavedSearchesRepository {
  return {
    async listByTeam(teamId) {
      return (await SavedSearch.find({ team: teamId })).map(toRecord);
    },

    async getById(teamId, id) {
      return orNull(await SavedSearch.findOne({ _id: id, team: teamId }));
    },

    async getByIds(teamId, ids) {
      return (await SavedSearch.find({ _id: { $in: ids }, team: teamId })).map(
        toRecord,
      );
    },

    async listPage(teamId, { offset, limit }) {
      const filter = { team: teamId };
      const [docs, total] = await Promise.all([
        SavedSearch.find(filter).sort({ _id: 1 }).skip(offset).limit(limit),
        SavedSearch.countDocuments(filter),
      ]);
      return { data: docs.map(toRecord), total };
    },

    async create(teamId, input, userId) {
      return toRecord(
        await SavedSearch.create({
          ...input,
          team: teamId,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
    },

    async update(teamId, id, input, userId) {
      // Drop createdBy so a spread of a stored document cannot rewrite
      // ownership attribution.
      const { createdBy: _createdBy, ...safe } = input as typeof input & {
        createdBy?: unknown;
      };
      return orNull(
        await SavedSearch.findOneAndUpdate(
          { _id: id, team: teamId },
          { ...safe, team: teamId, updatedBy: userId },
          { new: true },
        ),
      );
    },

    async delete(teamId, id) {
      return orNull(
        await SavedSearch.findOneAndDelete({ _id: id, team: teamId }),
      );
    },

    async distinctTags(teamId) {
      return SavedSearch.distinct('tags', { team: teamId });
    },
  };
}
