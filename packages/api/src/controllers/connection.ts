import { getDatastore } from '@/datastore';
import type { ConnectionInput } from '@/datastore/types';
import type { ObjectId } from '@/models';
import { objectIdSchema } from '@/utils/zod';

export type ConnectionValidation =
  | { ok: true }
  | { ok: false; status: 400 | 403; message: string };

export async function validateConnectionId(
  connection: unknown,
  teamId: string | ObjectId | undefined,
): Promise<ConnectionValidation> {
  const parsed = objectIdSchema.safeParse(connection);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      message: 'connection must be a valid connection id',
    };
  }
  if (teamId == null) {
    return { ok: false, status: 403, message: 'Forbidden' };
  }
  const connectionExists = await getDatastore().connections.exists(
    teamId.toString(),
    parsed.data,
  );
  if (!connectionExists) {
    return {
      ok: false,
      status: 400,
      message: 'connection must be an existing connection id',
    };
  }
  return { ok: true };
}

// Returns all connections across all teams. Only intended for instance-level
// operations (e.g. startup auto-provisioning); user-facing routes must use
// the team-scoped variants below. Passwords are never included.
export function getConnections() {
  return getDatastore().connections.listAll();
}

export function getConnectionsByTeam(team: string) {
  return getDatastore().connections.listByTeam(team);
}

export function getConnectionById(
  team: string,
  connectionId: string,
  selectPassword = false,
) {
  return getDatastore().connections.getById(team, connectionId, selectPassword);
}

export function createConnection(team: string, connection: ConnectionInput) {
  return getDatastore().connections.create(team, connection);
}

export function updateConnection(
  team: string,
  connectionId: string,
  connection: ConnectionInput,
  unsetFields: string[] = [],
) {
  return getDatastore().connections.update(
    team,
    connectionId,
    connection,
    unsetFields,
  );
}

export function deleteConnection(team: string, connectionId: string) {
  return getDatastore().connections.delete(team, connectionId);
}
