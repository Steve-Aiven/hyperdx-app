import type { PinnedFiltersValue } from '@hyperdx/common-utils/dist/types';

import { getDatastore } from '@/datastore';
import type { ObjectId } from '@/models';

/**
 * Get team-level pinned filters for a team+source combination.
 */
export async function getPinnedFilters(
  teamId: string | ObjectId,
  sourceId: string | ObjectId,
) {
  return getDatastore().pinnedFilters.get(
    teamId.toString(),
    sourceId.toString(),
  );
}

/**
 * Upsert team-level pinned filters for a team+source.
 */
export async function updatePinnedFilters(
  teamId: string | ObjectId,
  sourceId: string | ObjectId,
  data: { fields: string[]; filters: PinnedFiltersValue },
) {
  return getDatastore().pinnedFilters.upsert(
    teamId.toString(),
    sourceId.toString(),
    data,
  );
}
