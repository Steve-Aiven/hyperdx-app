import { getDatastore } from '@/datastore';
import type { SourceInput } from '@/datastore/types';
import type { ObjectId } from '@/models';

type TeamId = ObjectId | string;

export function getSources(team: TeamId) {
  return getDatastore().sources.listByTeam(String(team));
}

// Backends return null (not a cast error) for malformed ids so callers can
// surface a clean "not found".
export function getSource(team: TeamId, sourceId: string) {
  return getDatastore().sources.getById(String(team), sourceId);
}

export function createSource(team: TeamId, source: SourceInput) {
  return getDatastore().sources.create(String(team), source);
}

export function updateSource(
  team: TeamId,
  sourceId: string,
  source: SourceInput,
) {
  return getDatastore().sources.replace(String(team), sourceId, source);
}

export function deleteSource(team: TeamId, sourceId: string) {
  return getDatastore().sources.delete(String(team), sourceId);
}
