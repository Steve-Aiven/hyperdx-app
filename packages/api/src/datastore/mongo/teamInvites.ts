import type {
  TeamInviteRecord,
  TeamInvitesRepository,
} from '@/datastore/repositories';
import TeamInvite from '@/models/teamInvite';

import { toPlain } from './convert';

function toRecord(doc: object): TeamInviteRecord {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return toPlain(doc as never, ['teamId']) as unknown as TeamInviteRecord;
}

const orNull = (doc: object | null) => (doc ? toRecord(doc) : null);

export function createMongoTeamInvitesRepository(): TeamInvitesRepository {
  return {
    async create({ teamId, email, name, token }) {
      const invite = await new TeamInvite({
        teamId,
        email,
        name,
        token,
      }).save();
      return toRecord(invite);
    },

    async findByTeamAndEmail(teamId, email) {
      return orNull(await TeamInvite.findOne({ teamId, email }));
    },

    async findByToken(token) {
      return orNull(await TeamInvite.findOne({ token }));
    },

    async listByTeam(teamId) {
      return (await TeamInvite.find({ teamId })).map(toRecord);
    },

    async deleteById(id, teamId) {
      return orNull(
        await TeamInvite.findOneAndDelete({
          _id: id,
          ...(teamId != null && { teamId }),
        }),
      );
    },

    async deleteExpired() {
      // A TTL index on createdAt expires invites server-side.
      return 0;
    },
  };
}
