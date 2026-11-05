import {
  SavedSearchListApiResponse,
  SavedSearchSchema,
} from '@hyperdx/common-utils/dist/types';
import { groupBy } from 'lodash';
import { z } from 'zod';

import { populateCreators, toUserRef } from '@/controllers/alertRefs';
import { deleteSavedSearchAlerts } from '@/controllers/alerts';
import { getDatastore } from '@/datastore';
import type { SavedSearchRecord } from '@/datastore/types';
import { resolveAlertDisplayFields } from '@/utils/alerts';
import logger from '@/utils/logger';

type SavedSearchWithoutId = Omit<z.infer<typeof SavedSearchSchema>, 'id'>;

export type ExternalSavedSearch = {
  id: string;
  name: string;
  select?: string;
  where?: string;
  whereLanguage?: string;
  orderBy?: string;
  sourceId?: string;
  tags?: string[];
  filters?: unknown[];
  teamId: string;
  createdAt?: string;
  updatedAt?: string;
};

export function toExternalSavedSearch(
  savedSearch: SavedSearchRecord,
): ExternalSavedSearch {
  return {
    id: savedSearch._id,
    name: savedSearch.name ?? '',
    select: savedSearch.select,
    where: savedSearch.where,
    whereLanguage: savedSearch.whereLanguage,
    orderBy: savedSearch.orderBy,
    sourceId: savedSearch.source || undefined,
    tags: savedSearch.tags,
    filters: savedSearch.filters,
    teamId: savedSearch.team ?? '',
    createdAt:
      savedSearch.createdAt instanceof Date
        ? savedSearch.createdAt.toISOString()
        : undefined,
    updatedAt:
      savedSearch.updatedAt instanceof Date
        ? savedSearch.updatedAt.toISOString()
        : undefined,
  };
}

export async function getSavedSearches(
  teamId: string,
): Promise<SavedSearchListApiResponse[]> {
  const { savedSearches: searchRepo, alerts: alertRepo } = getDatastore();
  const [records, teamAlerts] = await Promise.all([
    searchRepo.listByTeam(teamId),
    alertRepo.listByTeam(teamId),
  ]);

  const userIds = [
    ...new Set(
      records
        .flatMap(s => [s.createdBy, s.updatedBy])
        .filter((id): id is string => id != null),
    ),
  ];
  const users =
    userIds.length > 0 ? await getDatastore().users.findByIds(userIds) : [];
  const userById = new Map(users.map(u => [u._id, toUserRef(u)]));

  const alerts = await populateCreators(
    teamAlerts.filter(alert => alert.savedSearch != null),
  );
  const alertsBySavedSearchId = groupBy(alerts, 'savedSearch');

  // The record's string createdBy/updatedBy become populated {email, name}
  // refs; a deleted user resolves to undefined. Dates stay Dates here and
  // become ISO strings in the JSON response, which the response type models.
  const response = records.map(savedSearch => ({
    ...savedSearch,
    createdBy:
      savedSearch.createdBy == null
        ? undefined
        : userById.get(savedSearch.createdBy),
    updatedBy:
      savedSearch.updatedBy == null
        ? undefined
        : userById.get(savedSearch.updatedBy),
    alerts: alertsBySavedSearchId[savedSearch._id]?.map(alert => ({
      ...alert,
      ...resolveAlertDisplayFields(alert, { savedSearch }),
    })),
  }));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return response as unknown as SavedSearchListApiResponse[];
}

export function getSavedSearch(teamId: string, savedSearchId: string) {
  return getDatastore().savedSearches.getById(teamId, savedSearchId);
}

export function createSavedSearch(
  teamId: string,
  savedSearch: SavedSearchWithoutId,
  userId?: string,
) {
  return getDatastore().savedSearches.create(teamId, savedSearch, userId);
}

export function updateSavedSearch(
  teamId: string,
  savedSearchId: string,
  savedSearch: SavedSearchWithoutId,
  userId?: string,
) {
  // The repositories never rewrite createdBy, so callers may pass a merged
  // stored record.
  return getDatastore().savedSearches.update(
    teamId,
    savedSearchId,
    savedSearch,
    userId,
  );
}

export async function deleteSavedSearch(teamId: string, savedSearchId: string) {
  const { savedSearches } = getDatastore();
  const savedSearch = await savedSearches.getById(teamId, savedSearchId);
  if (savedSearch == null) {
    return null;
  }
  // Delete dependent alerts before the parent. Without a transaction (which
  // requires a replica set), the deletes are not atomic, so this order picks
  // the least-bad partial-failure mode: if deleteSavedSearchAlerts throws,
  // nothing is deleted and the caller can retry. If the final delete throws
  // after the alerts are gone, the search survives without its alerts —
  // recoverable by re-creating alerts, and strictly better than the reverse
  // order's failure mode (orphaned alerts pointing at a deleted saved search).
  await deleteSavedSearchAlerts(savedSearchId, teamId);
  await savedSearches.delete(teamId, savedSearchId);
  // Re-sweep after the parent is gone: a concurrent alert-create targeting this
  // saved search could land between the two deletes above and orphan itself.
  // Once the parent no longer exists this second sweep cleans up any such alert
  // (and is a cheap no-op in the common case). Best-effort: the parent is
  // already deleted, so the operation has succeeded from the caller's view — a
  // failure here must not surface as a 500. Log it so the (rare) orphan window
  // is observable and can be swept later, and still return success.
  try {
    await deleteSavedSearchAlerts(savedSearchId, teamId);
  } catch (e) {
    logger.warn(
      { err: e, savedSearchId, team: teamId },
      'Post-delete alert re-sweep failed; a concurrently-created alert may be orphaned for this deleted saved search',
    );
  }
  return savedSearch;
}
