import { escapeRegExp } from 'lodash';
import type { FilterQuery } from 'mongoose';

import type { AlertCursor, AlertFilter } from '@/datastore/alertRepositories';
import { AlertSource, AlertState, type IAlert } from '@/models/alert';

function inOrMissing<T extends string>(values: T[], schemaDefault: T) {
  return {
    $in: values.includes(schemaDefault) ? [...values, null] : values,
  };
}

/**
 * Filters for documents strictly after `cursor` in `{displayName: 1, _id: 1}` order.
 *
 * Null and missing displayNames sort first as one block, so which predicate applies
 * depends on whether the page ended inside that block.
 */
function applyCursor(filter: FilterQuery<IAlert>, cursor: AlertCursor): void {
  // When the previous page ended inside the null block of displayNames,
  // the next row may be another null displayName or a named one.
  if (cursor.displayName === null) {
    filter.$or = [
      { displayName: null, _id: { $gt: cursor.id } },
      { displayName: { $gte: '' } },
    ];
    return;
  }

  // Otherwise all remaining displayNames are non-null strings, so we find documents
  // with displayNames after the cursor, or displayName equal to the cursor but with
  // a higher _id.
  filter.$or = [
    { displayName: { $gt: cursor.displayName } },
    { displayName: cursor.displayName, _id: { $gt: cursor.id } },
  ];
}

/** Mongo filter for an alert list filter, scoped to the team. */
export function buildMongoAlertFilter(
  teamId: string,
  params: AlertFilter,
  cursor?: AlertCursor,
): FilterQuery<IAlert> {
  const filter: FilterQuery<IAlert> = { team: teamId };

  if (params.tag != null) {
    filter.tags = { $in: params.tag };
  }

  if (params.state != null) {
    // OK is the default value when state is missing from the document, so we include
    // documents without the field as well when filtering for OK state alerts.
    filter.state = inOrMissing(params.state, AlertState.OK);
  }

  if (params.source != null) {
    // SAVED_SEARCH is the default value when source is missing from the document, so we include
    // documents without the field as well when filtering for saved-search alerts.
    filter.source = inOrMissing(params.source, AlertSource.SAVED_SEARCH);
  }

  if (params.search) {
    // Case-insensitive substring.
    filter.displayName = {
      $regex: escapeRegExp(params.search),
      $options: 'i',
    };
  }

  if (params.createdBy != null) {
    filter.createdBy = params.createdBy;
  }

  if (cursor != null) {
    applyCursor(filter, cursor);
  }

  return filter;
}
