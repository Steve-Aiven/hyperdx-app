import type {
  ConnectionRecord,
  ConnectionsRepository,
} from '@/datastore/repositories';
import Connection from '@/models/connection';

import { toPlain } from './convert';

function toRecord(doc: object, withPassword = false): ConnectionRecord {
  const { password, ...plain } = toPlain(doc as never, ['team']);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return {
    ...plain,
    ...(withPassword && password != null && { password }),
  } as unknown as ConnectionRecord;
}

export function createMongoConnectionsRepository(): ConnectionsRepository {
  return {
    async listAll() {
      return (await Connection.find({})).map(doc => toRecord(doc));
    },

    async listByTeam(teamId) {
      return (await Connection.find({ team: teamId })).map(doc =>
        toRecord(doc),
      );
    },

    async getById(teamId, connectionId, selectPassword = false) {
      const doc = await Connection.findOne({
        _id: connectionId,
        team: teamId,
      }).select(selectPassword ? '+password' : '');
      return doc ? toRecord(doc, selectPassword) : null;
    },

    async exists(teamId, connectionId) {
      return (
        (await Connection.exists({ _id: connectionId, team: teamId })) != null
      );
    },

    async create(teamId, input) {
      return toRecord(await Connection.create({ ...input, team: teamId }));
    },

    async update(teamId, connectionId, input, unsetFields = []) {
      const update: Record<string, unknown> = { $set: input };
      if (unsetFields.length > 0) {
        update.$unset = Object.fromEntries(unsetFields.map(f => [f, '']));
      }
      const doc = await Connection.findOneAndUpdate(
        { _id: connectionId, team: teamId },
        update,
        { new: true },
      );
      return doc ? toRecord(doc) : null;
    },

    async delete(teamId, connectionId) {
      const doc = await Connection.findOneAndDelete({
        _id: connectionId,
        team: teamId,
      });
      return doc ? toRecord(doc) : null;
    },
  };
}
