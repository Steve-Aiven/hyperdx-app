import type {
  PinnedFilterRecord,
  PinnedFiltersRepository,
} from '@/datastore/repositories';
import PinnedFilter from '@/models/pinnedFilter';

import { toPlain } from './convert';

function toRecord(doc: object): PinnedFilterRecord {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return toPlain(doc as never, [
    'team',
    'source',
  ]) as unknown as PinnedFilterRecord;
}

export function createMongoPinnedFiltersRepository(): PinnedFiltersRepository {
  return {
    async get(teamId, sourceId) {
      const doc = await PinnedFilter.findOne({
        team: teamId,
        source: sourceId,
      });
      return doc ? toRecord(doc) : null;
    },

    async upsert(teamId, sourceId, data) {
      const filter = { team: teamId, source: sourceId };
      const doc = await PinnedFilter.findOneAndUpdate(
        filter,
        { ...filter, fields: data.fields, filters: data.filters },
        { upsert: true, new: true },
      );
      return toRecord(doc);
    },
  };
}
