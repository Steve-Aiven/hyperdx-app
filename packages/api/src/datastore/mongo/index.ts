import MongoStore from 'connect-mongo';
import type { Store as SessionStore } from 'express-session';
import mongoose from 'mongoose';

import * as config from '@/config';
import type { Datastore } from '@/datastore/types';
import { connectDB, connectDBWithRetry, mongooseConnection } from '@/models';

import { createMongoAlertHistoriesRepository } from './alertHistories';
import { createMongoAlertsRepository } from './alerts';
import { createMongoConnectionsRepository } from './connections';
import { createMongoDashboardsRepository } from './dashboards';
import { createMongoFavoritesRepository } from './favorites';
import { createMongoPinnedFiltersRepository } from './pinnedFilters';
import { createMongoPresetDashboardFiltersRepository } from './presetDashboardFilters';
import { createMongoSavedSearchesRepository } from './savedSearches';
import { createMongoSourcesRepository } from './sources';
import { createMongoTeamInvitesRepository } from './teamInvites';
import { createMongoTeamsRepository } from './teams';
import { createMongoUsersRepository } from './users';
import { createMongoWebhooksRepository } from './webhooks';

export function createMongoDatastore(): Datastore {
  return {
    backend: 'mongo',

    connect(options) {
      return connectDB(options);
    },

    connectWithRetry(options) {
      const { autoIndex, ...retryOptions } = options ?? {};
      return connectDBWithRetry(
        autoIndex === undefined ? undefined : { autoIndex },
        retryOptions,
      );
    },

    async disconnect() {
      await mongoose.disconnect();
    },

    isReady() {
      return (
        mongooseConnection.readyState === mongoose.ConnectionStates.connected
      );
    },

    readyStateName() {
      return (
        mongoose.STATES[mongooseConnection.readyState] ??
        String(mongooseConnection.readyState)
      );
    },

    createSessionStore(): SessionStore {
      if (config.MONGO_URI == null) {
        throw new Error('MONGO_URI is not set');
      }
      return new MongoStore({ mongoUrl: config.MONGO_URI });
    },

    favorites: createMongoFavoritesRepository(),
    teams: createMongoTeamsRepository(),
    users: createMongoUsersRepository(),
    teamInvites: createMongoTeamInvitesRepository(),
    connections: createMongoConnectionsRepository(),
    sources: createMongoSourcesRepository(),
    savedSearches: createMongoSavedSearchesRepository(),
    dashboards: createMongoDashboardsRepository(),
    webhooks: createMongoWebhooksRepository(),
    pinnedFilters: createMongoPinnedFiltersRepository(),
    presetDashboardFilters: createMongoPresetDashboardFiltersRepository(),
    alerts: createMongoAlertsRepository(),
    alertHistories: createMongoAlertHistoriesRepository(),
  };
}
