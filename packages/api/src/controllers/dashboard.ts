import { savedChartConfigSupportsAlerts } from '@hyperdx/common-utils/dist/core/utils';
import {
  DashboardWithoutIdSchema,
  resolveChartPaletteToken,
  SavedChartConfig,
  Tile,
  walkRawDashboardTileColors,
} from '@hyperdx/common-utils/dist/types';
import { map, partition, uniq } from 'lodash';
import { z } from 'zod';

import { toUserRef, type UserRef } from '@/controllers/alertRefs';
import {
  createOrUpdateDashboardAlerts,
  deleteDashboardAlerts,
  getDashboardAlertsByTile,
  getTeamDashboardAlertsByDashboardAndTile,
} from '@/controllers/alerts';
import { recordOnboardingTaskCompletion } from '@/controllers/user';
import { getDatastore } from '@/datastore';
import type { DashboardInput, DashboardRecord } from '@/datastore/types';
import type { ObjectId } from '@/models';
import type { IDashboard } from '@/models/dashboard';
import { resolveAlertDisplayFields } from '@/utils/alerts';

// Drop alerts on tiles the alert checker cannot evaluate (e.g. PromQL), so
// they are never stored and any existing ones are deleted on save.
function getSupportedTileAlert(tile: Tile) {
  return savedChartConfigSupportsAlerts(tile.config)
    ? tile.config.alert
    : undefined;
}

function pickAlertsByTile(tiles: Tile[]) {
  return tiles.reduce((acc, tile) => {
    const alert = getSupportedTileAlert(tile);
    if (alert) {
      acc[tile.id] = alert;
    }
    return acc;
  }, {});
}

// Completes only when a dashboard has a tile (an empty shell isn't charting).
// Shared by every dashboard write path (controllers, external REST v2, MCP).
export function recordDashboardOnboardingIfHasTiles(
  userId: string | ObjectId | undefined | null,
  tiles: { length: number } | null | undefined,
) {
  if ((tiles?.length ?? 0) > 0) {
    recordOnboardingTaskCompletion(userId, 'dashboard');
  }
}

/**
 * Rewrite any legacy `chart-1`..`chart-10` tile colors from #2265 in
 * an already-serialized dashboard JSON to their hue-named equivalents
 * before it leaves the server. Keeps the wire format on a single
 * canonical vocabulary so non-React HTTP clients (CI scripts, stale
 * bundle tabs during a rolling deploy, the upcoming external API
 * surface) never have to know about the legacy values, and so a
 * GET → unmodified PATCH round-trip on a Mongo-seeded legacy doc can
 * never resurrect the legacy tokens through the strict server-side
 * `ChartPaletteTokenSchema`. The React-side
 * `normalizeDashboardTileColors` becomes redundant for the wire path
 * after this lands but stays in place as defense in depth for
 * `IS_LOCAL_MODE` and in-memory tile literals.
 *
 * Unresolvable strings (stale hexes, hand-edited values, forward-rolled
 * future tokens) pass through untouched so the user's data is not
 * silently dropped; the strict schema surfaces a clear error on next
 * save.
 */
function healLegacyDashboardTileColors<T>(dashboard: T): T {
  return walkRawDashboardTileColors(dashboard, current => {
    const resolved = resolveChartPaletteToken(current);
    return resolved ?? current;
  }) as T;
}

type TileForAlertSync = Pick<Tile, 'id'> & {
  config?: Pick<SavedChartConfig, 'alert'> | { alert?: object };
};

function extractTileAlertData(tiles: TileForAlertSync[]): {
  tileIds: Set<string>;
  tileIdsWithAlerts: Set<string>;
} {
  const [tilesWithAlerts, _] = partition(tiles, 'config.alert');
  const tileIds = new Set(map(tiles, 'id'));
  const tileIdsWithAlerts = new Set(map(tilesWithAlerts, 'id'));

  return { tileIds, tileIdsWithAlerts };
}

async function syncDashboardAlerts(
  dashboard: Pick<IDashboard, 'name' | 'tags' | 'tiles'> & {
    _id: ObjectId | string;
  },
  teamId: ObjectId | string,
  oldTiles: TileForAlertSync[],
  newTiles: Tile[],
  userId?: ObjectId | string,
): Promise<void> {
  const dashboardId = dashboard._id.toString();
  const { tileIds: oldTileIds, tileIdsWithAlerts: oldTileIdsWithAlerts } =
    extractTileAlertData(oldTiles);

  const newTilesForAlertSync: TileForAlertSync[] = newTiles.map(t => ({
    id: t.id,
    config: { alert: getSupportedTileAlert(t) },
  }));
  const { tileIds: newTileIds, tileIdsWithAlerts: newTileIdsWithAlerts } =
    extractTileAlertData(newTilesForAlertSync);

  // 1. Create/update alerts for tiles that have alerts
  const alertsByTile = pickAlertsByTile(newTiles);
  if (Object.keys(alertsByTile).length > 0) {
    await createOrUpdateDashboardAlerts(
      dashboard,
      teamId,
      alertsByTile,
      userId,
    );
  }

  // 2. Identify tiles whose alerts need to be deleted
  const tilesToDeleteAlertsFrom = new Set([
    // Tiles that were completely removed
    ...Array.from(oldTileIds).filter(id => !newTileIds.has(id)),
    // Tiles that exist but no longer have alerts
    ...Array.from(oldTileIdsWithAlerts).filter(
      id => newTileIds.has(id) && !newTileIdsWithAlerts.has(id),
    ),
  ]);

  // 3. Delete alerts
  if (tilesToDeleteAlertsFrom.size > 0) {
    await deleteDashboardAlerts(
      dashboardId,
      teamId,
      Array.from(tilesToDeleteAlertsFrom),
    );
  }
}

/**
 * Attach the resolved display name/tags so the chart editor prefills real
 * values for alerts written before the fields existed.
 */
function withResolvedDisplayFields<A extends object>(
  alert: (A & Parameters<typeof resolveAlertDisplayFields>[0]) | undefined,
  dashboard: Pick<IDashboard, 'name' | 'tags' | 'tiles'>,
) {
  if (alert == null) {
    return undefined;
  }
  return {
    ...alert,
    ...resolveAlertDisplayFields(alert, { dashboard }),
  };
}

type DashboardWithUsers = Omit<DashboardRecord, 'createdBy' | 'updatedBy'> & {
  createdBy?: UserRef;
  updatedBy?: UserRef;
};

// Stands in for mongoose populate('createdBy updatedBy', 'email name'); a
// deleted user resolves to undefined.
async function populateUsers(
  dashboards: DashboardRecord[],
): Promise<DashboardWithUsers[]> {
  const ids = uniq(
    dashboards
      .flatMap(d => [d.createdBy, d.updatedBy])
      .filter(id => id != null),
  );
  const users = ids.length > 0 ? await getDatastore().users.findByIds(ids) : [];
  const byId = new Map(users.map(u => [u._id, toUserRef(u)]));
  const ref = (id?: string) => (id == null ? undefined : byId.get(id));
  return dashboards.map(d => ({
    ...d,
    createdBy: ref(d.createdBy),
    updatedBy: ref(d.updatedBy),
  }));
}

export async function getDashboards(teamId: ObjectId | string) {
  const [records, alerts] = await Promise.all([
    getDatastore().dashboards.listByTeam(String(teamId)),
    getTeamDashboardAlertsByDashboardAndTile(teamId),
  ]);
  const _dashboards = await populateUsers(records);

  const dashboards = _dashboards
    .map(d => ({
      ...d,
      tiles: d.tiles.map(t => ({
        ...t,
        config: {
          ...t.config,
          alert: withResolvedDisplayFields(alerts[`${d._id}:${t.id}`]?.[0], d),
        },
      })),
    }))
    .map(healLegacyDashboardTileColors);

  return dashboards;
}

export async function getDashboard(
  dashboardId: string,
  teamId: ObjectId | string,
) {
  const [record, alerts] = await Promise.all([
    getDatastore().dashboards.getById(String(teamId), dashboardId),
    getDashboardAlertsByTile(teamId, dashboardId),
  ]);

  if (record == null) {
    return null;
  }
  const [_dashboard] = await populateUsers([record]);

  return healLegacyDashboardTileColors({
    ..._dashboard,
    tiles: _dashboard.tiles.map(t => ({
      ...t,
      config: {
        ...t.config,
        alert: withResolvedDisplayFields(alerts[t.id]?.[0], _dashboard),
      },
    })),
  });
}

export async function createDashboard(
  teamId: ObjectId | string,
  dashboard: z.infer<typeof DashboardWithoutIdSchema>,
  userId?: ObjectId | string,
) {
  const newDashboard = await getDatastore().dashboards.create(
    String(teamId),
    dashboard,
    userId == null ? undefined : String(userId),
  );

  await createOrUpdateDashboardAlerts(
    newDashboard,
    teamId,
    pickAlertsByTile(dashboard.tiles),
    userId,
  );

  recordDashboardOnboardingIfHasTiles(userId, newDashboard.tiles);

  return newDashboard;
}

export async function deleteDashboard(
  dashboardId: string,
  teamId: ObjectId | string,
) {
  const dashboard = await getDatastore().dashboards.delete(
    String(teamId),
    dashboardId,
  );
  if (dashboard) {
    await deleteDashboardAlerts(dashboardId, teamId);
  }
}

export async function updateDashboard(
  dashboardId: string,
  teamId: ObjectId | string,
  updates: Partial<z.infer<typeof DashboardWithoutIdSchema>>,
  userId?: ObjectId | string,
) {
  // Defense-in-depth: callers pass spread objects into the update doc below.
  // A smuggled `team`/`createdBy` here would move the document between
  // tenants / forge ownership (the model marks them immutable, but the
  // write below reaches Mongo directly).
  const {
    team: _ignoredTeam,
    createdBy: _ignoredCreatedBy,
    ...safeUpdates
  } = updates as Record<string, unknown>;
  if (_ignoredTeam !== undefined || _ignoredCreatedBy !== undefined) {
    throw new Error('updateDashboard: team/createdBy are not updatable');
  }

  const oldDashboard = await getDashboard(dashboardId, teamId);

  if (oldDashboard == null) {
    throw new Error('Dashboard not found');
  }

  const updatedDashboard = await getDatastore().dashboards.update(
    String(teamId),
    dashboardId,
    {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      ...(safeUpdates as Partial<DashboardInput>),
      tags: updates.tags && uniq(updates.tags),
    } as DashboardInput,
    userId == null ? undefined : String(userId),
  );
  if (updatedDashboard == null) {
    throw new Error('Could not update dashboard');
  }

  if (updates.tiles) {
    await syncDashboardAlerts(
      updatedDashboard,
      teamId,
      oldDashboard?.tiles || [],
      updates.tiles,
      userId,
    );
  }

  recordDashboardOnboardingIfHasTiles(userId, updatedDashboard.tiles);

  return updatedDashboard;
}
