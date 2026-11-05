import {
  PresetDashboard,
  PresetDashboardFilter,
} from '@hyperdx/common-utils/dist/types';

import { getDatastore } from '@/datastore';
import type { ObjectId } from '@/models';

export async function getPresetDashboardFilters(
  teamId: string | ObjectId,
  source: string | ObjectId,
  presetDashboard: PresetDashboard,
) {
  return getDatastore().presetDashboardFilters.list(
    teamId.toString(),
    source.toString(),
    presetDashboard,
  );
}

export const createPresetDashboardFilter = async (
  teamId: string | ObjectId,
  presetDashboardFilter: PresetDashboardFilter,
) => {
  return getDatastore().presetDashboardFilters.create(
    teamId.toString(),
    presetDashboardFilter,
  );
};

export const updatePresetDashboardFilter = async (
  teamId: string | ObjectId,
  presetDashboardFilter: PresetDashboardFilter,
) => {
  return getDatastore().presetDashboardFilters.update(
    teamId.toString(),
    presetDashboardFilter.id,
    presetDashboardFilter,
  );
};

export const deletePresetDashboardFilter = async (
  teamId: string | ObjectId,
  presetDashboard: PresetDashboard,
  presetDashboardFilterId: string | ObjectId,
) => {
  return getDatastore().presetDashboardFilters.delete(
    teamId.toString(),
    presetDashboard,
    presetDashboardFilterId.toString(),
  );
};
