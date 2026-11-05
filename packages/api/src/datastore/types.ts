import type { Store as SessionStore } from 'express-session';

import type { IFavorite } from '@/models/favorite';

import type {
  AlertHistoriesRepository,
  AlertsRepository,
  DashboardsRepository,
  SavedSearchesRepository,
} from './alertRepositories';
import type {
  ConnectionsRepository,
  PinnedFiltersRepository,
  PresetDashboardFiltersRepository,
  SourcesRepository,
  TeamInvitesRepository,
  TeamsRepository,
  UsersRepository,
  WebhooksRepository,
} from './repositories';

export type * from './alertRepositories';
export type * from './repositories';

export type DatastoreBackend = 'mongo' | 'postgres';

export type FavoriteRecord = {
  _id: string;
  id: string;
  user: string;
  team: string;
  resourceType: IFavorite['resourceType'];
  resourceId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type FavoritesRepository = {
  list(userId: string, teamId: string): Promise<FavoriteRecord[]>;
  upsert(
    userId: string,
    teamId: string,
    resourceType: IFavorite['resourceType'],
    resourceId: string,
  ): Promise<FavoriteRecord>;
  remove(
    userId: string,
    teamId: string,
    resourceType: IFavorite['resourceType'],
    resourceId: string,
  ): Promise<void>;
};

/**
 * App-state datastore. Mongo remains the default adapter; Postgres is the
 * native Aiven-friendly path. Controllers should depend on this interface
 * rather than mongoose models so backends can be swapped.
 */
export type Datastore = {
  readonly backend: DatastoreBackend;
  connect(options?: { autoIndex?: boolean }): Promise<void>;
  connectWithRetry(options?: {
    autoIndex?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
    maxAttempts?: number;
  }): Promise<void>;
  disconnect(): Promise<void>;
  isReady(): boolean;
  readyStateName(): string;
  createSessionStore(): SessionStore;
  favorites: FavoritesRepository;
  teams: TeamsRepository;
  users: UsersRepository;
  teamInvites: TeamInvitesRepository;
  connections: ConnectionsRepository;
  sources: SourcesRepository;
  savedSearches: SavedSearchesRepository;
  dashboards: DashboardsRepository;
  webhooks: WebhooksRepository;
  pinnedFilters: PinnedFiltersRepository;
  presetDashboardFilters: PresetDashboardFiltersRepository;
  alerts: AlertsRepository;
  alertHistories: AlertHistoriesRepository;
};
