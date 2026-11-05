import connectPgSimple from 'connect-pg-simple';
import session, { type Store as SessionStore } from 'express-session';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import type { Datastore } from '@/datastore/types';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

import { createPostgresAlertHistoriesRepository } from './alertHistories';
import { createPostgresAlertsRepository } from './alerts';
import { closePool, getPool, query } from './client';
import { createPostgresConnectionsRepository } from './connections';
import { createPostgresDashboardsRepository } from './dashboards';
import { createPostgresFavoritesRepository } from './favorites';
import { runPostgresMigrations } from './migrate';
import { createPostgresPinnedFiltersRepository } from './pinnedFilters';
import { createPostgresPresetDashboardFiltersRepository } from './presetDashboardFilters';
import { createPostgresSavedSearchesRepository } from './savedSearches';
import { createPostgresSourcesRepository } from './sources';
import { createPostgresTeamInvitesRepository } from './teamInvites';
import { createPostgresTeamsRepository } from './teams';
import { createPostgresUsersRepository } from './users';
import { createPostgresWebhooksRepository } from './webhooks';

// @types/connect-pg-simple nests its own express-session and pg typings, which
// do not unify with the app's copies.
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
const PgSession = connectPgSimple(
  session as unknown as Parameters<typeof connectPgSimple>[0],
);
/* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

const pgConnectionEventsCounter = getCounter(
  'hyperdx.postgres.connection_events',
  {
    description:
      'Count of PostgreSQL connection lifecycle events, labeled by event.',
  },
);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let ready = false;

export function createPostgresDatastore(): Datastore {
  return {
    backend: 'postgres',

    async connect() {
      if (config.DATABASE_URL == null) {
        throw new Error('DATABASE_URL is not set');
      }
      getPool();
      await query('SELECT 1');
      await runPostgresMigrations();
      ready = true;
      pgConnectionEventsCounter.add(1, { event: 'connected' });
      logger.info('Connection established to PostgreSQL');
    },

    async connectWithRetry(options) {
      const baseDelayMs = options?.baseDelayMs ?? 1000;
      const maxDelayMs = options?.maxDelayMs ?? 30000;
      const maxAttempts = options?.maxAttempts ?? Infinity;

      for (let attempt = 1; ; attempt++) {
        try {
          await this.connect();
          if (attempt > 1) {
            logger.info(
              { attempt },
              'Connection established to PostgreSQL after retrying',
            );
          }
          return;
        } catch (err) {
          if (config.DATABASE_URL == null || attempt >= maxAttempts) {
            throw err;
          }
          pgConnectionEventsCounter.add(1, {
            event: 'initial_connect_retry',
          });
          const retryInMs = Math.min(
            baseDelayMs * 2 ** (attempt - 1),
            maxDelayMs,
          );
          logger.error(
            { err: serializeError(err), attempt, retryInMs },
            'Initial PostgreSQL connection failed, retrying',
          );
          await sleep(retryInMs);
        }
      }
    },

    async disconnect() {
      ready = false;
      await closePool();
      pgConnectionEventsCounter.add(1, { event: 'disconnected' });
    },

    isReady() {
      return ready;
    },

    readyStateName() {
      return ready ? 'connected' : 'disconnected';
    },

    createSessionStore(): SessionStore {
      /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
      return new PgSession({
        pool: getPool() as unknown as ConstructorParameters<
          typeof PgSession
        >[0] extends { pool?: infer P }
          ? P
          : never,
        tableName: 'session',
        createTableIfMissing: false,
      }) as unknown as SessionStore;
      /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
    },

    favorites: createPostgresFavoritesRepository(),
    teams: createPostgresTeamsRepository(),
    users: createPostgresUsersRepository(),
    teamInvites: createPostgresTeamInvitesRepository(),
    connections: createPostgresConnectionsRepository(),
    sources: createPostgresSourcesRepository(),
    savedSearches: createPostgresSavedSearchesRepository(),
    dashboards: createPostgresDashboardsRepository(),
    webhooks: createPostgresWebhooksRepository(),
    pinnedFilters: createPostgresPinnedFiltersRepository(),
    presetDashboardFilters: createPostgresPresetDashboardFiltersRepository(),
    alerts: createPostgresAlertsRepository(),
    alertHistories: createPostgresAlertHistoriesRepository(),
  };
}
