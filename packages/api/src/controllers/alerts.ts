import { isRangeThresholdType } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import {
  type AlertWithDisplayRefs,
  type AlertWithRefs,
  populateCreators,
  populateDisplayRefs,
  populatePageRefs,
} from '@/controllers/alertRefs';
import { recordOnboardingTaskCompletion } from '@/controllers/user';
import { getDatastore } from '@/datastore';
import type {
  AlertFilter,
  AlertInput as AlertRepoInput,
  AlertRecord,
} from '@/datastore/types';
import type { ObjectId } from '@/models';
import {
  AlertChannel,
  AlertSource,
  getAlertChannels,
  IAlert,
} from '@/models/alert';
import type { IDashboard } from '@/models/dashboard';
import { type AlertRefs, deriveAlertDisplayFields } from '@/utils/alerts';
import { internalAlertSchema } from '@/utils/zod';

export type {
  AlertWithDisplayRefs,
  AlertWithRefs,
} from '@/controllers/alertRefs';
export { validateAlertInput } from '@/controllers/alertValidation';

export type AlertInput = Omit<
  IAlert,
  | 'id'
  | 'channel'
  | 'scheduleStartAt'
  | 'savedSearchId'
  | 'createdAt'
  | 'createdBy'
  | 'updatedAt'
  | 'team'
  | 'state'
  | 'silenced'
> & {
  id?: string;
  // Records carry the silencing user as a string id.
  silenced?: { by?: ObjectId | string; at: Date; until: Date };
  // Exactly one of channel/channels is provided (enforced by alertSchema);
  // `channels` flows in optionally via IAlert.
  channel?: AlertChannel;
  // Replace the Date-type fields from IAlert
  scheduleStartAt?: string | null;
  // Replace the ObjectId-type fields from IAlert
  savedSearchId?: string;
  dashboardId?: string;
};

// Exported for unit testing the channel-mirroring invariant (see
// controllers/__tests__/alerts.test.ts) -- otherwise only used internally.
export const makeAlert = (
  alert: AlertInput,
  userId?: ObjectId | string,
  refs: AlertRefs = {},
): Partial<AlertRepoInput> => {
  // Preserve existing DB value when scheduleStartAt is omitted from updates
  // (undefined), while still allowing explicit clears via null.
  const hasScheduleStartAt = alert.scheduleStartAt !== undefined;
  // If scheduleStartAt is explicitly provided, offset-based alignment is ignored.
  // Force persisted offset to 0 so updates can't leave stale non-zero offsets.
  // If scheduleStartAt is explicitly cleared and offset is omitted, also reset
  // to 0 to avoid preserving stale values from older documents.
  const normalizedScheduleOffsetMinutes =
    hasScheduleStartAt && alert.scheduleStartAt != null
      ? 0
      : hasScheduleStartAt && alert.scheduleOffsetMinutes == null
        ? 0
        : alert.scheduleOffsetMinutes;
  const isSavedSearch = alert.source === AlertSource.SAVED_SEARCH;
  const isTile = alert.source === AlertSource.TILE;
  const isInline = alert.source === AlertSource.INLINE;
  const channels = getAlertChannels(alert);
  // If the input explicitly provides a non-null value, persist it. If the input omits the
  // field and a referenced entity is available, persist the value derived from the referenced entity.
  // Otherwise, null.
  const derivedDisplay = deriveAlertDisplayFields(alert, refs);
  const displayName = alert.displayName ?? derivedDisplay.displayName ?? null;
  const tags = alert.tags ?? derivedDisplay.tags ?? null;

  return {
    // `channels` is canonical; `channel` mirrors channels[0] so readers that
    // predate multi-channel support (older task runners mid-rollout) still
    // notify the first target.
    channel: channels[0] ?? { type: null },
    channels,
    interval: alert.interval,
    ...(normalizedScheduleOffsetMinutes != null && {
      scheduleOffsetMinutes: normalizedScheduleOffsetMinutes,
    }),
    ...(hasScheduleStartAt && {
      scheduleStartAt:
        alert.scheduleStartAt == null ? null : new Date(alert.scheduleStartAt),
    }),
    source: alert.source,
    threshold: alert.threshold,
    // Omitted rather than set to undefined for a non-range comparator, so
    // updateAlert can $unset the path. Writing null instead would surface on
    // the create/update responses, which return the document directly, and a
    // client round-tripping one back into an update would fail validation.
    ...(isRangeThresholdType(alert.thresholdType) && {
      thresholdMax: alert.thresholdMax,
    }),
    thresholdType: alert.thresholdType,
    ...(userId && { createdBy: userId.toString() }),

    // Message template
    // Coerce undefined to null so Mongoose clears the field on update.
    // https://mongoosejs.com/docs/migrating_to_6.html#removed-omitundefined
    name: alert.name ?? null,
    message: alert.message ?? null,
    note: alert.note ?? null,

    displayName,
    tags,

    // Log alerts
    savedSearch: isSavedSearch ? (alert.savedSearchId ?? null) : null,
    groupBy: isSavedSearch ? (alert.groupBy ?? null) : null,
    // Tile alerts
    dashboard: isTile ? (alert.dashboardId ?? null) : null,
    tileId: isTile ? (alert.tileId ?? null) : null,

    // Inline alerts
    chartConfig: isInline ? (alert.chartConfig ?? null) : null,

    // Multi-window alerting
    numConsecutiveWindows: alert.numConsecutiveWindows ?? null,
  };
};

// makeAlert omits thresholdMax for a non-range comparator, and a patch drops
// an omitted key rather than clearing the field, so the bound has to be unset
// explicitly (undefined) or an alert edited off `between` keeps a stale one and
// reports a range condition it no longer has. Every update path needs this.
const makeAlertPatch = (
  alertInput: AlertInput,
  userId?: ObjectId | string,
  refs: AlertRefs = {},
): Partial<AlertRepoInput> => ({
  ...makeAlert(alertInput, userId, refs),
  ...(!isRangeThresholdType(alertInput.thresholdType) && {
    thresholdMax: undefined,
  }),
});

const teamKey = (teamId: ObjectId | string) => String(teamId);

export const createAlert = async (
  teamId: ObjectId | string,
  alertInput: z.infer<typeof internalAlertSchema>,
  userId: ObjectId | string,
  refs: AlertRefs = {},
) => {
  // makeAlert always supplies the required fields; Partial is for patches.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const input = makeAlert(alertInput, userId, refs) as AlertRepoInput;
  const alert = await getDatastore().alerts.create(teamKey(teamId), input);
  recordOnboardingTaskCompletion(userId, 'alert');
  return alert;
};

export const updateAlert = async (
  id: string,
  teamId: ObjectId | string,
  alertInput: AlertInput,
  refs: AlertRefs = {},
  userId?: ObjectId | string,
) => {
  // should consider clearing AlertHistory when updating an alert?
  const alert = await getDatastore().alerts.update(
    teamKey(teamId),
    id,
    makeAlertPatch(alertInput, undefined, refs),
  );
  // Editing an alert also completes "set up an alert", not just creating one.
  if (alert != null) {
    recordOnboardingTaskCompletion(userId, 'alert');
  }
  return alert;
};

export const countAlerts = async (
  teamId: ObjectId | string,
  filter: AlertFilter = {},
) => getDatastore().alerts.count(teamKey(teamId), filter);

export const getAlertById = async (
  alertId: ObjectId | string,
  teamId: ObjectId | string,
) => getDatastore().alerts.getById(teamKey(teamId), String(alertId));

export const getTeamDashboardAlertsByDashboardAndTile = async (
  teamId: ObjectId | string,
) => {
  const alerts = await populateCreators(
    await getDatastore().alerts.listTileAlerts(teamKey(teamId)),
  );
  const byKey: Record<string, typeof alerts> = {};
  for (const alert of alerts) {
    (byKey[`${alert.dashboard}:${alert.tileId}`] ??= []).push(alert);
  }
  return byKey;
};

export const getDashboardAlertsByTile = async (
  teamId: ObjectId | string,
  dashboardId: ObjectId | string,
) => {
  const alerts = await populateCreators(
    await getDatastore().alerts.listTileAlerts(
      teamKey(teamId),
      String(dashboardId),
    ),
  );
  const byTile: Record<string, typeof alerts> = {};
  for (const alert of alerts) {
    (byTile[String(alert.tileId)] ??= []).push(alert);
  }
  return byTile;
};

export const createOrUpdateDashboardAlerts = async (
  dashboard: Pick<IDashboard, 'name' | 'tags' | 'tiles'> & {
    _id: ObjectId | string;
  },
  teamId: ObjectId | string,
  alertsByTile: Record<string, AlertInput>,
  userId?: ObjectId | string,
) => {
  const dashboardId = String(dashboard._id);
  const { alerts } = getDatastore();
  const existing = await alerts.listTileAlerts(teamKey(teamId), dashboardId);
  const existingByTile = new Map(existing.map(a => [a.tileId, a]));

  const result = await Promise.all(
    Object.entries(alertsByTile).map(async ([tileId, alert]) => {
      const alertInput = {
        ...alert,
        source: AlertSource.TILE,
        dashboardId,
        tileId,
      };
      const oldAlert = existingByTile.get(tileId);
      if (oldAlert == null) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const input = makeAlert(alertInput, userId, {
          dashboard,
        }) as AlertRepoInput;
        return alerts.create(teamKey(teamId), input);
      }
      // Keep the original creator when there is one.
      const patch = makeAlertPatch(
        alertInput,
        oldAlert.createdBy ? undefined : userId,
        { dashboard },
      );
      return alerts.update(teamKey(teamId), oldAlert._id, patch);
    }),
  );

  // Tile alerts never hit the /alerts router, so record here.
  if (result.length > 0) {
    recordOnboardingTaskCompletion(userId, 'alert');
  }

  return result;
};

export const deleteDashboardAlerts = async (
  dashboardId: ObjectId | string,
  teamId: ObjectId | string,
  tileIds?: string[],
) =>
  getDatastore().alerts.deleteByDashboard(
    teamKey(teamId),
    String(dashboardId),
    tileIds,
  );

export const deleteSavedSearchAlerts = async (
  savedSearchId: string,
  teamId: string,
) => getDatastore().alerts.deleteBySavedSearch(teamId, savedSearchId);

/** Get alerts, with their saved search or dashboard reference resolved. */
export const getAlertsWithDisplayRefs = async (
  teamId: ObjectId | string,
  { limit, offset }: { limit: number; offset: number },
  filter: AlertFilter = {},
): Promise<AlertWithDisplayRefs[]> => {
  const alerts = await getDatastore().alerts.list(teamKey(teamId), filter, {
    sort: 'id',
    limit,
    offset,
  });
  return populateDisplayRefs(teamKey(teamId), alerts);
};

/** Get alert, with its saved search or dashboard reference resolved. */
export const getAlertWithDisplayRefs = async (
  alertId: ObjectId | string,
  teamId: ObjectId | string,
): Promise<AlertWithDisplayRefs | null> => {
  const alert = await getDatastore().alerts.getById(
    teamKey(teamId),
    String(alertId),
  );
  if (alert == null) return null;
  const [populated] = await populateDisplayRefs(teamKey(teamId), [alert]);
  return populated;
};

export const getAlertEnhanced = async (
  alertId: ObjectId | string,
  teamId: ObjectId | string,
): Promise<AlertWithRefs | null> => {
  const alert = await getDatastore().alerts.getById(
    teamKey(teamId),
    String(alertId),
  );
  if (alert == null) return null;
  const [populated] = await populatePageRefs(teamKey(teamId), [alert]);
  return populated;
};

export const deleteAlert = async (id: string, teamId: ObjectId | string) => {
  const deleted = await getDatastore().alerts.delete(teamKey(teamId), id);
  return { deletedCount: deleted == null ? 0 : 1 };
};

export type { AlertRecord };
