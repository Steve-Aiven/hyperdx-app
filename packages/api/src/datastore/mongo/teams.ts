import { v4 as uuidv4 } from 'uuid';

import type { TeamRecord, TeamsRepository } from '@/datastore/repositories';
import Team from '@/models/team';

import { toPlain } from './convert';

const toRecord = (doc: object) =>
  toPlain(doc as never) as unknown as TeamRecord;

const orNull = (doc: object | null) => (doc ? toRecord(doc) : null);

export function createMongoTeamsRepository(): TeamsRepository {
  return {
    async isExisting() {
      return (await Team.countDocuments({})) > 0;
    },

    async create({ name, collectorAuthenticationEnforced = true }) {
      const team = new Team({ name, collectorAuthenticationEnforced });
      await team.save();
      return toRecord(team);
    },

    async getById(id) {
      return orNull(await Team.findById(id));
    },

    async getByApiKey(apiKey) {
      return orNull(await Team.findOne({ apiKey }));
    },

    async getAll() {
      return (await Team.find({})).map(toRecord);
    },

    async rotateApiKey(teamId) {
      return orNull(
        await Team.findByIdAndUpdate(
          teamId,
          { apiKey: uuidv4() },
          { new: true },
        ),
      );
    },

    async setName(teamId, name) {
      return orNull(
        await Team.findByIdAndUpdate(teamId, { name }, { new: true }),
      );
    },

    async updateClickhouseSettings(teamId, settings) {
      const $set: Record<string, unknown> = {};
      const $unset: Record<string, ''> = {};

      for (const [key, value] of Object.entries(settings)) {
        if (value === null) {
          $unset[key] = '';
        } else if (value !== undefined) {
          $set[key] = value;
        }
      }

      const update: Record<string, unknown> = {};
      if (Object.keys($set).length > 0) update.$set = $set;
      if (Object.keys($unset).length > 0) update.$unset = $unset;

      return orNull(
        await Team.findByIdAndUpdate(teamId, update, { new: true }),
      );
    },
  };
}
