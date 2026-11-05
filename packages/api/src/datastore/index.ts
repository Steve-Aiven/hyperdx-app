import * as config from '@/config';

import { createMongoDatastore } from './mongo';
import { createPostgresDatastore } from './postgres';
import type { Datastore, DatastoreBackend } from './types';

export { generateId, isObjectIdHex } from './ids';
export type { Datastore, DatastoreBackend, FavoriteRecord } from './types';

let datastore: Datastore | null = null;

export function getDatastoreBackend(): DatastoreBackend {
  return config.DATASTORE;
}

export function createDatastore(
  backend: DatastoreBackend = config.DATASTORE,
): Datastore {
  if (backend === 'postgres') {
    return createPostgresDatastore();
  }
  return createMongoDatastore();
}

/** Process-wide datastore singleton used by controllers and server startup. */
export function getDatastore(): Datastore {
  if (datastore == null) {
    datastore = createDatastore();
  }
  return datastore;
}

/** Test helper: replace the singleton (e.g. after clearing DB). */
export function setDatastore(next: Datastore | null) {
  datastore = next;
}
