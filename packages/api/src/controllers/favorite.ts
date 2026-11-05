import { getDatastore } from '@/datastore';
import type { IFavorite } from '@/models/favorite';

export function getFavorites(userId: string, teamId: string) {
  return getDatastore().favorites.list(userId, teamId);
}

export function addFavorite(
  userId: string,
  teamId: string,
  resourceType: IFavorite['resourceType'],
  resourceId: string,
) {
  return getDatastore().favorites.upsert(
    userId,
    teamId,
    resourceType,
    resourceId,
  );
}

export function removeFavorite(
  userId: string,
  teamId: string,
  resourceType: IFavorite['resourceType'],
  resourceId: string,
) {
  return getDatastore().favorites.remove(
    userId,
    teamId,
    resourceType,
    resourceId,
  );
}
