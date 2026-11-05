import type {
  PresetDashboardFilterRecord,
  PresetDashboardFiltersRepository,
} from '@/datastore/repositories';
import PresetDashboardFilterModel from '@/models/presetDashboardFilter';

import { toPlain } from './convert';

function toRecord(doc: object): PresetDashboardFilterRecord {
  const plain = toPlain(doc as never, ['team', 'source']);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return {
    ...plain,
    whereLanguage: plain.whereLanguage ?? 'lucene',
  } as unknown as PresetDashboardFilterRecord;
}

const orNull = (doc: object | null) => (doc ? toRecord(doc) : null);

export function createMongoPresetDashboardFiltersRepository(): PresetDashboardFiltersRepository {
  return {
    async list(teamId, sourceId, presetDashboard) {
      return (
        await PresetDashboardFilterModel.find({
          team: teamId,
          source: sourceId,
          presetDashboard,
        })
      ).map(toRecord);
    },

    async create(teamId, input) {
      return toRecord(
        await new PresetDashboardFilterModel({ ...input, team: teamId }).save(),
      );
    },

    async update(teamId, id, input) {
      return orNull(
        await PresetDashboardFilterModel.findOneAndUpdate(
          { _id: id, team: teamId },
          { ...input, _id: id, team: teamId },
          { new: true },
        ),
      );
    },

    async delete(teamId, presetDashboard, id) {
      return orNull(
        await PresetDashboardFilterModel.findOneAndDelete({
          _id: id,
          team: teamId,
          presetDashboard,
        }),
      );
    },
  };
}
