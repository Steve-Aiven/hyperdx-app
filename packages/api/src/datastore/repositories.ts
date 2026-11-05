import type {
  OnboardingData,
  OnboardingTaskId,
  PinnedFiltersValue,
  PresetDashboardFilter,
  Team,
  TeamClickHouseSettingsUpdate,
} from '@hyperdx/common-utils/dist/types';

import type { IConnection } from '@/models/connection';
import type { ISource, ISourceInput } from '@/models/source';
import type { IWebhook, WebhookService } from '@/models/webhook';

/**
 * Backend-neutral records. Ids are 24-char hex strings in both backends so
 * controllers never see mongoose ObjectIds or documents.
 */
export type RecordBase = {
  _id: string;
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TeamRecord = Omit<Team, 'id'> & RecordBase;

export type TeamsRepository = {
  isExisting(): Promise<boolean>;
  create(input: {
    name: string;
    collectorAuthenticationEnforced?: boolean;
  }): Promise<TeamRecord>;
  getById(id: string): Promise<TeamRecord | null>;
  getByApiKey(apiKey: string): Promise<TeamRecord | null>;
  getAll(): Promise<TeamRecord[]>;
  rotateApiKey(teamId: string): Promise<TeamRecord | null>;
  setName(teamId: string, name: string): Promise<TeamRecord | null>;
  /** `null` values clear a setting back to its default. */
  updateClickhouseSettings(
    teamId: string,
    settings: TeamClickHouseSettingsUpdate,
  ): Promise<TeamRecord | null>;
};

export type UserRecord = RecordBase & {
  email: string;
  name: string;
  team?: string;
  accessKey: string;
  onboardingData: OnboardingData;
  hasPasswordAuth: true;
};

export type AuthResult = { user: UserRecord | null; error?: Error };

export type UsersRepository = {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findByAccessKey(accessKey: string): Promise<UserRecord | null>;
  findByTeam(teamId: string): Promise<UserRecord[]>;
  /** Missing ids are skipped; order is not guaranteed. */
  findByIds(ids: string[]): Promise<UserRecord[]>;
  /** Hashes the password and inserts; rejects when the email already exists. */
  register(input: {
    email: string;
    password: string;
    name?: string;
    teamId?: string;
  }): Promise<UserRecord>;
  update(
    userId: string,
    patch: { teamId?: string; name?: string },
  ): Promise<UserRecord | null>;
  authenticate(email: string, password: string): Promise<AuthResult>;
  rotateAccessKey(userId: string): Promise<UserRecord | null>;
  /** Idempotent: re-adding a completed task is a no-op. */
  completeOnboardingTask(
    userId: string,
    taskId: OnboardingTaskId,
  ): Promise<UserRecord | null>;
  setOnboardingDismissed(
    userId: string,
    isDismissed: boolean,
  ): Promise<UserRecord | null>;
  /** Deletes the member and reassigns their alerts to `reassignToUserId`. */
  deleteFromTeam(
    teamId: string,
    userId: string,
    reassignToUserId: string,
  ): Promise<UserRecord | null>;
};

export type TeamInviteRecord = RecordBase & {
  teamId: string;
  email: string;
  name?: string;
  token: string;
};

export type TeamInvitesRepository = {
  create(input: {
    teamId: string;
    email: string;
    name?: string;
    token: string;
  }): Promise<TeamInviteRecord>;
  findByTeamAndEmail(
    teamId: string,
    email: string,
  ): Promise<TeamInviteRecord | null>;
  findByToken(token: string): Promise<TeamInviteRecord | null>;
  listByTeam(teamId: string): Promise<TeamInviteRecord[]>;
  deleteById(id: string, teamId?: string): Promise<TeamInviteRecord | null>;
  /** Mongo expires invites with a TTL index; Postgres needs an explicit sweep. */
  deleteExpired(maxAgeDays?: number): Promise<number>;
};

export type ConnectionRecord = Omit<
  IConnection,
  '_id' | 'team' | 'password'
> & {
  _id: string;
  id: string;
  team: string;
  /** Only populated when requested with `selectPassword`. */
  password?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ConnectionInput = Partial<Omit<IConnection, '_id' | 'id' | 'team'>>;

export type ConnectionsRepository = {
  listAll(): Promise<ConnectionRecord[]>;
  listByTeam(teamId: string): Promise<ConnectionRecord[]>;
  getById(
    teamId: string,
    connectionId: string,
    selectPassword?: boolean,
  ): Promise<ConnectionRecord | null>;
  exists(teamId: string, connectionId: string): Promise<boolean>;
  create(teamId: string, input: ConnectionInput): Promise<ConnectionRecord>;
  update(
    teamId: string,
    connectionId: string,
    input: ConnectionInput,
    unsetFields?: string[],
  ): Promise<ConnectionRecord | null>;
  delete(
    teamId: string,
    connectionId: string,
  ): Promise<ConnectionRecord | null>;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends T
  ? Omit<T, K>
  : never;

export type SourceRecord = ISource & {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
};
export type SourceInput = DistributiveOmit<ISourceInput, 'id'>;

export type SourcesRepository = {
  listByTeam(teamId: string): Promise<SourceRecord[]>;
  getById(teamId: string, sourceId: string): Promise<SourceRecord | null>;
  create(teamId: string, input: SourceInput): Promise<SourceRecord>;
  /** Full replace; `kind` may change. Preserves id and createdAt. */
  replace(
    teamId: string,
    sourceId: string,
    input: SourceInput,
  ): Promise<SourceRecord | null>;
  delete(teamId: string, sourceId: string): Promise<SourceRecord | null>;
};

export type WebhookRecord = RecordBase & {
  team: string;
  name: string;
  service: WebhookService;
  url?: string;
  description?: string;
  titleEmoji?: boolean;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
};

export type WebhookInput = Omit<
  WebhookRecord,
  '_id' | 'id' | 'team' | 'createdAt' | 'updatedAt'
>;

export type WebhooksRepository = {
  listByTeam(teamId: string): Promise<WebhookRecord[]>;
  getById(teamId: string, webhookId: string): Promise<WebhookRecord | null>;
  create(teamId: string, input: WebhookInput): Promise<WebhookRecord>;
  /** Replaces writable fields; keys absent from `input` are cleared. */
  replace(
    teamId: string,
    webhookId: string,
    input: WebhookInput,
    /**
     * When given, the write only applies while the stored url and service still
     * match, so a concurrent destination change is not overwritten.
     */
    expected?: Pick<WebhookRecord, 'url' | 'service'>,
  ): Promise<WebhookRecord | null>;
  findByName(
    teamId: string,
    service: WebhookService,
    name: string,
  ): Promise<WebhookRecord | null>;
  delete(teamId: string, webhookId: string): Promise<WebhookRecord | null>;
};

/**
 * A webhook as the alert checker delivers to it: a plain record, or the
 * mongoose shape (Map headers) that tests and older callers still pass.
 */
export type WebhookTarget = WebhookRecord | IWebhook;

export type PinnedFilterRecord = RecordBase & {
  team: string;
  source: string;
  fields: string[];
  filters: PinnedFiltersValue;
};

export type PinnedFiltersRepository = {
  get(teamId: string, sourceId: string): Promise<PinnedFilterRecord | null>;
  upsert(
    teamId: string,
    sourceId: string,
    data: { fields: string[]; filters: PinnedFiltersValue },
  ): Promise<PinnedFilterRecord>;
};

export type PresetDashboardFilterInput = Pick<
  PresetDashboardFilter,
  | 'name'
  | 'source'
  | 'sourceMetricType'
  | 'presetDashboard'
  | 'type'
  | 'expression'
  | 'where'
  | 'whereLanguage'
>;

export type PresetDashboardFilterRecord = PresetDashboardFilterInput &
  RecordBase & { team: string };

export type PresetDashboardFiltersRepository = {
  list(
    teamId: string,
    sourceId: string,
    presetDashboard: PresetDashboardFilter['presetDashboard'],
  ): Promise<PresetDashboardFilterRecord[]>;
  create(
    teamId: string,
    input: PresetDashboardFilterInput,
  ): Promise<PresetDashboardFilterRecord>;
  update(
    teamId: string,
    id: string,
    input: PresetDashboardFilterInput,
  ): Promise<PresetDashboardFilterRecord | null>;
  delete(
    teamId: string,
    presetDashboard: PresetDashboardFilter['presetDashboard'],
    id: string,
  ): Promise<PresetDashboardFilterRecord | null>;
};
