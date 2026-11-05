import type { FavoriteRecord, FavoritesRepository } from '@/datastore/types';
import Favorite, { type IFavorite } from '@/models/favorite';

function toRecord(doc: {
  _id: { toString(): string };
  user: { toString(): string };
  team: { toString(): string };
  resourceType: IFavorite['resourceType'];
  resourceId: string;
  createdAt: Date;
  updatedAt: Date;
}): FavoriteRecord {
  const id = doc._id.toString();
  return {
    _id: id,
    id,
    user: doc.user.toString(),
    team: doc.team.toString(),
    resourceType: doc.resourceType,
    resourceId: doc.resourceId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function createMongoFavoritesRepository(): FavoritesRepository {
  return {
    async list(userId, teamId) {
      const docs = await Favorite.find({ user: userId, team: teamId });
      return docs.map(toRecord);
    },

    async upsert(userId, teamId, resourceType, resourceId) {
      const doc = await Favorite.findOneAndUpdate(
        { user: userId, team: teamId, resourceType, resourceId },
        { user: userId, team: teamId, resourceType, resourceId },
        { upsert: true, new: true },
      );
      if (doc == null) {
        throw new Error('Failed to upsert favorite');
      }
      return toRecord(doc);
    },

    async remove(userId, teamId, resourceType, resourceId) {
      await Favorite.deleteOne({
        user: userId,
        team: teamId,
        resourceType,
        resourceId,
      });
    },
  };
}
