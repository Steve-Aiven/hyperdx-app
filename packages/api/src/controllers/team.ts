import {
  TagResourceType,
  TeamClickHouseSettingsUpdate,
} from '@hyperdx/common-utils/dist/types';
import { pick } from 'lodash';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

import * as config from '@/config';
import { getDatastore } from '@/datastore';
import type { TeamRecord } from '@/datastore/types';
import type { ObjectId } from '@/models';

export function getTeamInviteUrl(token: string) {
  return `${config.FRONTEND_URL}/join-team?token=${token}`;
}

const LOCAL_APP_TEAM_ID = '_local_team_';
export const LOCAL_APP_TEAM = {
  _id: new mongoose.Types.ObjectId(LOCAL_APP_TEAM_ID),
  id: LOCAL_APP_TEAM_ID,
  name: 'Local App Team',
  // Placeholder keys
  hookId: uuidv4(),
  apiKey: uuidv4(),
  collectorAuthenticationEnforced: false,
  isMetricsSeriesTableEnabled: false,
  toJSON() {
    return this;
  },
};

export async function isTeamExisting() {
  if (config.IS_LOCAL_APP_MODE) {
    return true;
  }

  return getDatastore().teams.isExisting();
}

export async function createTeam({
  name,
  collectorAuthenticationEnforced = true,
}: {
  name: string;
  collectorAuthenticationEnforced?: boolean;
}) {
  if (await isTeamExisting()) {
    throw new Error('Team already exists');
  }

  return getDatastore().teams.create({ name, collectorAuthenticationEnforced });
}

export async function getAllTeams(fields?: readonly (keyof TeamRecord)[]) {
  if (config.IS_LOCAL_APP_MODE) {
    return [LOCAL_APP_TEAM];
  }

  const teams = await getDatastore().teams.getAll();
  return fields ? teams.map(team => pick(team, fields)) : teams;
}

export async function getTeam<const F extends readonly (keyof TeamRecord)[]>(
  id: string | ObjectId,
  fields: F,
): Promise<Pick<TeamRecord, F[number] | '_id' | 'id'> | null>;
export async function getTeam(
  id: string | ObjectId,
): Promise<TeamRecord | null>;
export async function getTeam(
  id: string | ObjectId,
  fields?: readonly (keyof TeamRecord)[],
) {
  if (config.IS_LOCAL_APP_MODE) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return LOCAL_APP_TEAM as any;
  }

  const team = await getDatastore().teams.getById(id.toString());
  // Projection is applied here so the response never carries fields the
  // caller did not ask for (e.g. hookId).
  return team && fields ? pick(team, [...fields, '_id', 'id']) : team;
}

export async function getTeamByApiKey(apiKey: string) {
  if (config.IS_LOCAL_APP_MODE) {
    return LOCAL_APP_TEAM;
  }

  return getDatastore().teams.getByApiKey(apiKey);
}

export function rotateTeamApiKey(teamId: string | ObjectId) {
  return getDatastore().teams.rotateApiKey(teamId.toString());
}

export function setTeamName(teamId: string | ObjectId, name: string) {
  return getDatastore().teams.setName(teamId.toString(), name);
}

export function updateTeamClickhouseSettings(
  teamId: string | ObjectId,
  settings: TeamClickHouseSettingsUpdate,
) {
  return getDatastore().teams.updateClickhouseSettings(
    teamId.toString(),
    settings,
  );
}

/**
 * Distinct tags applied to the team's entities. Scoped to one kind of entity
 * when `resourceType` is given.
 */
export async function getTags(
  teamId: string | ObjectId,
  resourceType?: TagResourceType,
) {
  const { alerts, dashboards, savedSearches } = getDatastore();
  const id = teamId.toString();

  let sources: Promise<string[]>[];
  switch (resourceType) {
    case undefined:
      sources = [
        alerts.distinctTags(id),
        dashboards.distinctTags(id),
        savedSearches.distinctTags(id),
      ];
      break;
    case 'alert':
      sources = [alerts.distinctTags(id)];
      break;
    case 'dashboard':
      sources = [dashboards.distinctTags(id)];
      break;
    case 'savedSearch':
      sources = [savedSearches.distinctTags(id)];
      break;
    default:
      resourceType satisfies never;
      throw new Error(`${resourceType} is not a valid TagResourceType`);
  }

  return [...new Set((await Promise.all(sources)).flat())];
}
