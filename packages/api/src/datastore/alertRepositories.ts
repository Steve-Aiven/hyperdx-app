import type {
  AlertSource,
  AlertState,
  IAlert,
  IAlertError,
} from '@/models/alert';
import type { IAlertHistory } from '@/models/alertHistory';
import type { IDashboard } from '@/models/dashboard';
import type { ISavedSearch } from '@/models/savedSearch';

import type { RecordBase } from './repositories';

type WithoutRefs<T, K extends PropertyKey> = Omit<
  T,
  K | '_id' | 'id' | 'createdAt' | 'updatedAt'
>;

export type SavedSearchRecord = WithoutRefs<
  ISavedSearch,
  'team' | 'source' | 'createdBy' | 'updatedBy'
> &
  RecordBase & {
    team: string;
    source: string;
    createdBy?: string;
    updatedBy?: string;
  };

export type SavedSearchInput = WithoutRefs<
  SavedSearchRecord,
  'team' | 'createdBy' | 'updatedBy'
>;

export type SavedSearchesRepository = {
  listByTeam(teamId: string): Promise<SavedSearchRecord[]>;
  getById(teamId: string, id: string): Promise<SavedSearchRecord | null>;
  /** Missing ids are skipped; order is not guaranteed. */
  getByIds(teamId: string, ids: string[]): Promise<SavedSearchRecord[]>;
  /** Stable `_id` order, so offset paging is consistent across requests. */
  listPage(
    teamId: string,
    page: { offset: number; limit: number },
  ): Promise<{ data: SavedSearchRecord[]; total: number }>;
  create(
    teamId: string,
    input: SavedSearchInput,
    userId?: string,
  ): Promise<SavedSearchRecord>;
  update(
    teamId: string,
    id: string,
    input: SavedSearchInput,
    userId?: string,
  ): Promise<SavedSearchRecord | null>;
  delete(teamId: string, id: string): Promise<SavedSearchRecord | null>;
  distinctTags(teamId: string): Promise<string[]>;
};

export type DashboardRecord = WithoutRefs<
  IDashboard,
  'team' | 'createdBy' | 'updatedBy'
> &
  RecordBase & {
    team: string;
    createdBy?: string;
    updatedBy?: string;
  };

export type DashboardInput = WithoutRefs<
  DashboardRecord,
  'team' | 'createdBy' | 'updatedBy'
>;

export type DashboardsRepository = {
  listByTeam(teamId: string): Promise<DashboardRecord[]>;
  getById(teamId: string, id: string): Promise<DashboardRecord | null>;
  /** Missing ids are skipped; order is not guaranteed. */
  getByIds(teamId: string, ids: string[]): Promise<DashboardRecord[]>;
  /**
   * Rejects with a duplicate-key error (see `isDuplicateKeyError`) when a
   * provisioned dashboard with the same name already exists for the team.
   */
  create(
    teamId: string,
    input: DashboardInput,
    userId?: string,
  ): Promise<DashboardRecord>;
  update(
    teamId: string,
    id: string,
    input: DashboardInput,
    userId?: string,
  ): Promise<DashboardRecord | null>;
  delete(teamId: string, id: string): Promise<DashboardRecord | null>;
  distinctTags(teamId: string): Promise<string[]>;
};

type AlertRefs =
  | 'team'
  | 'createdBy'
  | 'savedSearch'
  | 'dashboard'
  | 'silenced';

export type AlertRecord = Omit<IAlert, AlertRefs | 'id'> &
  RecordBase & {
    team: string;
    createdBy?: string;
    savedSearch?: string | null;
    dashboard?: string | null;
    silenced?: { by?: string; at: Date; until: Date };
  };

export type AlertInput = Omit<AlertRecord, keyof RecordBase | 'team'> &
  Partial<Pick<AlertRecord, 'state'>>;

/** Backend-neutral alert list filter; each store translates it natively. */
export type AlertFilter = {
  /** Matches alerts carrying any of these tags. */
  tag?: string[];
  state?: AlertState[];
  source?: AlertSource[];
  /** Case-insensitive substring of the display name. */
  search?: string;
  createdBy?: string;
};

/** Sort key of the last row of the previous page (`displayName` sort only). */
export type AlertCursor = { displayName: string | null; id: string };

export type AlertListOptions = {
  /** `id` is creation order; `displayName` sorts nulls first, then by id. */
  sort?: 'id' | 'displayName';
  offset?: number;
  limit?: number;
  cursor?: AlertCursor;
};

export type AlertsRepository = {
  listByTeam(teamId: string): Promise<AlertRecord[]>;
  /** Every team's alerts; for the alert checker, which has no team context. */
  listAll(): Promise<AlertRecord[]>;
  list(
    teamId: string,
    filter?: AlertFilter,
    options?: AlertListOptions,
  ): Promise<AlertRecord[]>;
  count(teamId: string, filter?: AlertFilter): Promise<number>;
  /** Tile alerts, optionally limited to one dashboard. */
  listTileAlerts(teamId: string, dashboardId?: string): Promise<AlertRecord[]>;
  getById(teamId: string, id: string): Promise<AlertRecord | null>;
  create(teamId: string, input: AlertInput): Promise<AlertRecord>;
  /** Merges `patch` into the alert; `undefined` values remove the field. */
  update(
    teamId: string,
    id: string,
    patch: Partial<AlertInput>,
  ): Promise<AlertRecord | null>;
  /**
   * Records the latest execution errors, and the alert state when given.
   * Used by the alert checker, which runs without a team context.
   */
  setExecutionResult(
    alertId: string,
    executionErrors: IAlertError[],
    state?: AlertState,
  ): Promise<void>;
  delete(teamId: string, id: string): Promise<AlertRecord | null>;
  deleteBySavedSearch(teamId: string, savedSearchId: string): Promise<number>;
  /** Deletes tile alerts for the dashboard, limited to `tileIds` when given. */
  deleteByDashboard(
    teamId: string,
    dashboardId: string,
    tileIds?: string[],
  ): Promise<number>;
  countByWebhook(teamId: string, webhookId: string): Promise<number>;
  distinctTags(teamId: string): Promise<string[]>;
};

export type AlertHistoryRecord = Omit<IAlertHistory, 'alert'> & {
  _id: string;
  alert: string;
};

export type AlertHistoryInput = Omit<IAlertHistory, 'alert'>;

/** Latest history per (alert, group), used to decide which windows still need evaluating. */
export type LatestAlertHistory = {
  _id: string;
  createdAt: Date;
  state: AlertState;
  group?: string;
  fired?: boolean;
  groupValues?: IAlertHistory['groupValues'] | null;
};

type DateRange = { gte?: Date; gt?: Date; lte?: Date; lt?: Date };

/** One evaluation window (rows sharing a createdAt), pre-grouped by the store. */
export type HistoryWindowRow = Pick<
  IAlertHistory,
  'state' | 'counts' | 'lastValues' | 'errors' | 'analytics' | 'fired'
> & { group?: string };

export type HistoryWindow = { createdAt: Date; rows: HistoryWindowRow[] };

export type AlertHistoriesRepository = {
  create(
    alertId: string,
    input: AlertHistoryInput,
  ): Promise<AlertHistoryRecord>;
  deleteMany(filter: {
    alertId: string;
    state?: AlertState;
    createdAt: Date | { gt: Date; lte: Date };
  }): Promise<number>;
  upsertError(
    alertId: string,
    createdAt: Date,
    errors: IAlertError[],
    analytics?: IAlertHistory['analytics'],
  ): Promise<void>;
  /** Latest non-ERROR row per (alert, group) in `[now - lookbackMs, now]`. */
  getPrevious(
    alertId: string,
    now: Date,
    lookbackMs: number,
  ): Promise<LatestAlertHistory[]>;
  /** Non-ERROR rows with createdAt in `[from, to)`, newest first per group. */
  getConsecutiveWindow(
    alertId: string,
    from: Date,
    to: Date,
  ): Promise<LatestAlertHistory[]>;
  /** Windows grouped by createdAt, newest first, capped at `limit`. */
  getWindows(
    alertId: string,
    createdAt: DateRange,
    limit: number,
  ): Promise<HistoryWindow[]>;
  /** Non-ERROR windows ordered oldest first, for transition detection. */
  getTransitionWindows(
    alertId: string,
    from: Date,
    to: Date,
  ): Promise<{ createdAt: Date; states: string[]; bucketStarts: Date[][] }[]>;
};
