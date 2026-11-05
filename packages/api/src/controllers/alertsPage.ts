import { MAX_ALERT_DISPLAY_NAME_LENGTH } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import { populatePageRefs } from '@/controllers/alertRefs';
import { getDatastore } from '@/datastore';
import type { AlertFilter } from '@/datastore/types';
import type { ObjectId } from '@/models';
import { AlertSource, AlertState } from '@/models/alert';
import { decodeCursor, encodeCursor } from '@/utils/pagination';
import { objectIdSchema, stringListQueryParam, tagsSchema } from '@/utils/zod';

const MAX_PAGE_LIMIT = 500;

/** States an alert document can hold; ERROR only appears on history records. */
const ALERT_FILTER_STATES = [
  AlertState.ALERT,
  AlertState.DISABLED,
  AlertState.INSUFFICIENT_DATA,
  AlertState.OK,
  AlertState.PENDING,
] as const;

/** The page cursor's payload: the sort key of the last item on the page. */
const alertsPageCursorSchema = z.object({
  n: z.string().nullable(),
  id: objectIdSchema,
});

/** Filter parameters shared by the internal alerts page and the v2 list endpoint. */
export const alertsFilterShape = {
  /** A list of tags to filter alerts by. Returns alerts that have any of the specified tags */
  tag: stringListQueryParam.pipe(tagsSchema).optional(),
  /** A list of alert sources to filter by. Returns alerts that match any of the specified sources */
  source: stringListQueryParam
    .pipe(
      z
        .array(z.nativeEnum(AlertSource))
        .optional()
        .transform(v => v && [...new Set(v)]),
    )
    .optional(),
  /** A list of alert states to filter by. Returns alerts that match any of the specified states */
  state: stringListQueryParam
    .pipe(
      z
        .array(z.enum(ALERT_FILTER_STATES))
        .optional()
        .transform(v => v && [...new Set(v)]),
    )
    .optional(),
  /** A search string to filter alerts by their display name. Substring, case-insensitive match */
  search: z.string().trim().max(MAX_ALERT_DISPLAY_NAME_LENGTH).optional(),
};

export type AlertsFilterParams = z.infer<z.ZodObject<typeof alertsFilterShape>>;

/** Query parameters schema for the list alerts endpoint. */
export const alertsPageQuerySchema = z
  .object({
    /** Number of alerts to return in one page. Omitted means no paging is applied */
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
    /** The cursor pointing to the last item of the previous page, if there was a previous page */
    cursor: z.string().optional(),
    /** A user ID, to filter for alerts created by a specific user */
    createdBy: objectIdSchema.optional(),
    ...alertsFilterShape,
  })
  .superRefine((query, ctx) => {
    if (query.cursor == null) {
      return;
    }
    // A cursor implies pagination, which requires a limit
    if (query.limit == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'cursor requires limit',
      });
    }
    if (decodeCursor(query.cursor, alertsPageCursorSchema) == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'invalid cursor',
      });
    }
  });

export type AlertsPageParams = z.infer<typeof alertsPageQuerySchema>;

/** Store-neutral filter for the shared filter parameters. */
export function buildAlertsFilter(params: AlertsFilterParams): AlertFilter {
  return {
    tag: params.tag,
    state: params.state,
    source: params.source,
    search: params.search,
  };
}

export async function getAlertsPage(
  teamId: ObjectId | string,
  params: AlertsPageParams,
) {
  const { limit } = params;
  const team = String(teamId);
  const cursor = params.cursor
    ? decodeCursor(params.cursor, alertsPageCursorSchema)
    : null;

  // One row past the page answers "is there more?" without a second count
  // query. Omitting limit keeps the legacy unpaginated response.
  const rows = await getDatastore().alerts.list(
    team,
    { ...buildAlertsFilter(params), createdBy: params.createdBy },
    {
      sort: 'displayName',
      ...(limit != null && { limit: limit + 1 }),
      ...(cursor != null && {
        cursor: { displayName: cursor.n, id: cursor.id },
      }),
    },
  );
  const hasMore = limit != null && rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const data = await populatePageRefs(team, page);
  const last = page.at(-1);
  const nextCursor =
    hasMore && last != null
      ? encodeCursor({ n: last.displayName ?? null, id: last._id })
      : undefined;

  return { data, hasMore, nextCursor };
}
