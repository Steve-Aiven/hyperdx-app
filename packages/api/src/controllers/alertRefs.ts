import { getDatastore } from '@/datastore';
import type {
  AlertRecord,
  DashboardRecord,
  SavedSearchRecord,
} from '@/datastore/types';

export type UserRef = {
  _id: string;
  id: string;
  email: string;
  name?: string;
};

export type SavedSearchRef = Pick<SavedSearchRecord, '_id' | 'id' | 'name'> &
  Partial<Pick<SavedSearchRecord, 'tags'>>;

/** Only what display-name derivation and the alerts page render. */
export type DashboardRef = Pick<DashboardRecord, '_id' | 'id' | 'name'> &
  Partial<Pick<DashboardRecord, 'tags' | 'provisioned'>> & {
    tiles: { id: string; config?: { name?: string } }[];
  };

/**
 * An alert with its saved search and dashboard resolved. A ref whose target no
 * longer exists keeps the bare id string, so a dangling reference stays
 * visible to callers.
 */
export type AlertWithDisplayRefs = Omit<
  AlertRecord,
  'savedSearch' | 'dashboard'
> & {
  savedSearch?: SavedSearchRef | string | null;
  dashboard?: DashboardRef | string | null;
};

/** Display refs plus resolved creator and silencer, as the alerts page uses. */
export type AlertWithRefs = Omit<
  AlertWithDisplayRefs,
  'createdBy' | 'silenced'
> & {
  // A deleted user resolves to undefined rather than a dangling id.
  createdBy?: UserRef;
  silenced?: { at: Date; until: Date; by?: UserRef };
};

const unique = (ids: (string | null | undefined)[]) => [
  ...new Set(ids.filter((id): id is string => id != null)),
];

const toSavedSearchRef = (s: SavedSearchRecord): SavedSearchRef => ({
  _id: s._id,
  id: s.id,
  name: s.name,
  tags: s.tags,
});

const toDashboardRef = (d: DashboardRecord): DashboardRef => ({
  _id: d._id,
  id: d.id,
  name: d.name,
  tags: d.tags,
  provisioned: d.provisioned,
  tiles: (d.tiles ?? []).map(tile => ({
    id: tile.id,
    config: { name: tile.config?.name },
  })),
});

export const toUserRef = (u: {
  _id: string;
  email: string;
  name?: string;
}): UserRef => ({
  _id: u._id,
  id: u._id,
  email: u.email,
  name: u.name,
});

/**
 * Resolves saved search and dashboard refs with two batched lookups, standing
 * in for mongoose populate. Lookups are team-scoped.
 */
export async function populateDisplayRefs(
  teamId: string,
  alerts: AlertRecord[],
): Promise<AlertWithDisplayRefs[]> {
  const ds = getDatastore();
  const savedSearchIds = unique(alerts.map(a => a.savedSearch));
  const dashboardIds = unique(alerts.map(a => a.dashboard));
  const noSearches: Promise<SavedSearchRecord[]> = Promise.resolve([]);
  const noDashboards: Promise<DashboardRecord[]> = Promise.resolve([]);
  const [savedSearches, dashboards] = await Promise.all([
    savedSearchIds.length > 0
      ? ds.savedSearches.getByIds(teamId, savedSearchIds)
      : noSearches,
    dashboardIds.length > 0
      ? ds.dashboards.getByIds(teamId, dashboardIds)
      : noDashboards,
  ]);
  const searchById = new Map<string, SavedSearchRef>(
    savedSearches.map(s => [s._id, toSavedSearchRef(s)]),
  );
  const dashboardById = new Map<string, DashboardRef>(
    dashboards.map(d => [d._id, toDashboardRef(d)]),
  );

  // A missing target keeps its id so the dangling reference stays visible.
  return alerts.map(alert => ({
    ...alert,
    savedSearch:
      alert.savedSearch == null
        ? alert.savedSearch
        : (searchById.get(alert.savedSearch) ?? alert.savedSearch),
    dashboard:
      alert.dashboard == null
        ? alert.dashboard
        : (dashboardById.get(alert.dashboard) ?? alert.dashboard),
  }));
}

/** Display refs plus creator and silencer, as the alerts page renders them. */
export async function populatePageRefs(
  teamId: string,
  alerts: AlertRecord[],
): Promise<AlertWithRefs[]> {
  const withRefs = await populateDisplayRefs(teamId, alerts);
  const userIds = unique(alerts.flatMap(a => [a.createdBy, a.silenced?.by]));
  const users =
    userIds.length > 0 ? await getDatastore().users.findByIds(userIds) : [];
  const userById = new Map(users.map(u => [u._id, toUserRef(u)]));
  const refUser = (id: string | undefined) =>
    id == null ? undefined : userById.get(id);

  return withRefs.map((alert, i) => {
    const { silenced, createdBy } = alerts[i];
    return {
      ...alert,
      createdBy: refUser(createdBy),
      silenced:
        silenced == null
          ? undefined
          : { ...silenced, by: refUser(silenced.by) },
    };
  });
}

/** createdBy-only population, for the saved search list and tile alerts. */
export async function populateCreators<T extends AlertRecord>(
  alerts: T[],
): Promise<(Omit<T, 'createdBy'> & { createdBy?: UserRef })[]> {
  const userIds = unique(alerts.map(a => a.createdBy));
  const users =
    userIds.length > 0 ? await getDatastore().users.findByIds(userIds) : [];
  const userById = new Map(users.map(u => [u._id, toUserRef(u)]));
  return alerts.map(alert => ({
    ...alert,
    createdBy:
      alert.createdBy == null ? undefined : userById.get(alert.createdBy),
  }));
}
