import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

import type { UserRecord, UsersRepository } from '@/datastore/repositories';
import Alert from '@/models/alert';
import User from '@/models/user';

import { toPlain } from './convert';

function toRecord(doc: object): UserRecord {
  const plain = toPlain(doc as never, ['team']);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return {
    ...plain,
    name: plain.name ?? '',
    onboardingData: plain.onboardingData ?? {
      completedTasks: [],
      isDismissed: false,
    },
    hasPasswordAuth: true,
  } as unknown as UserRecord;
}

const orNull = (doc: object | null) => (doc ? toRecord(doc) : null);

// passport-local-mongoose augments the model at runtime and ships no types.

const plm = User as any;

export function createMongoUsersRepository(): UsersRepository {
  let authenticate: ((email: string, password: string) => Promise<any>) | null =
    null;

  return {
    async findById(id) {
      return orNull(await User.findById(id));
    },

    async findByEmail(email) {
      // The model stores emails lowercased.
      return orNull(await User.findOne({ email: email.toLowerCase() }));
    },

    async findByAccessKey(accessKey) {
      return orNull(await User.findOne({ accessKey }));
    },

    async findByTeam(teamId) {
      return (await User.find({ team: teamId }).sort({ createdAt: 1 })).map(
        toRecord,
      );
    },

    async findByIds(ids) {
      return (await User.find({ _id: { $in: ids } })).map(toRecord);
    },

    async register({ email, password, name, teamId }) {
      const register = promisify(plm.register.bind(plm));
      const user = await register(
        new User({
          email,
          ...(name != null && { name }),
          ...(teamId != null && { team: teamId }),
        }),
        password,
      );
      return toRecord(user);
    },

    async update(userId, { teamId, name }) {
      const $set: Record<string, unknown> = {};
      if (teamId !== undefined) $set.team = teamId;
      if (name !== undefined) $set.name = name;
      return orNull(
        await User.findByIdAndUpdate(userId, { $set }, { new: true }),
      );
    },

    async authenticate(email, password) {
      authenticate ??= plm.authenticate();
      const { user, error } = await authenticate!(email, password);
      return { user: user ? toRecord(user) : null, ...(error && { error }) };
    },

    async rotateAccessKey(userId) {
      return orNull(
        await User.findByIdAndUpdate(
          userId,
          { accessKey: uuidv4() },
          { new: true },
        ),
      );
    },

    async completeOnboardingTask(userId, taskId) {
      // The $ne guard skips the write once recorded; this runs on hot save
      // paths.
      const updated = await User.findOneAndUpdate(
        { _id: userId, 'onboardingData.completedTasks': { $ne: taskId } },
        { $addToSet: { 'onboardingData.completedTasks': taskId } },
        { new: true },
      );
      return orNull(updated ?? (await User.findById(userId)));
    },

    async setOnboardingDismissed(userId, isDismissed) {
      return orNull(
        await User.findByIdAndUpdate(
          userId,
          { $set: { 'onboardingData.isDismissed': isDismissed } },
          { new: true },
        ),
      );
    },

    async deleteFromTeam(teamId, userId, reassignToUserId) {
      const [, deleted] = await Promise.all([
        Alert.updateMany(
          { createdBy: userId, team: teamId },
          { $set: { createdBy: reassignToUserId } },
        ),
        User.findOneAndDelete({ team: teamId, _id: userId }),
      ]);
      return orNull(deleted);
    },
  };
}
