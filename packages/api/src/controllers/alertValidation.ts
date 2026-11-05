import {
  displayTypeSupportsBuilderAlerts,
  displayTypeSupportsRawSqlAlerts,
  isFormulaSourceKind,
  savedChartConfigSupportsAlerts,
  validateRawSqlForAlert,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  isPromqlSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';

import type { AlertInput } from '@/controllers/alerts';
import { getDatastore } from '@/datastore';
import { canonicalId } from '@/datastore/ids';
import type { ObjectId } from '@/models';
import { AlertSource, getAlertChannels } from '@/models/alert';
import { type AlertRefs } from '@/utils/alerts';
import { Api400Error } from '@/utils/errors';
import { objectIdSchema } from '@/utils/zod';

const validateObjectId = (id: string | undefined, message: string) => {
  if (objectIdSchema.safeParse(id).success === false) {
    throw new Api400Error(message);
  }
};

export const validateAlertInput = async (
  teamId: ObjectId | string,
  alertInput: Pick<
    AlertInput,
    | 'source'
    | 'dashboardId'
    | 'tileId'
    | 'savedSearchId'
    | 'chartConfig'
    | 'channel'
    | 'channels'
  >,
) => {
  const refs: AlertRefs = {};

  if (alertInput.source === AlertSource.TILE) {
    validateObjectId(alertInput.dashboardId, 'Invalid dashboard ID');

    const dashboard = await getDatastore().dashboards.getById(
      String(teamId),
      canonicalId(alertInput.dashboardId!),
    );

    if (dashboard == null) {
      throw new Api400Error('Dashboard not found');
    }
    refs.dashboard = dashboard;

    const tile = dashboard.tiles.find(tile => tile.id === alertInput.tileId);

    if (tile == null) {
      throw new Api400Error('Tile not found');
    }

    // The alert checker cannot evaluate these tiles, so the alert would never run.
    if (tile.config != null && !savedChartConfigSupportsAlerts(tile.config)) {
      if (isPromqlSavedChartConfig(tile.config)) {
        throw new Api400Error('Alerts are not supported on PromQL tiles');
      }
      const tileKind = isRawSqlSavedChartConfig(tile.config)
        ? 'Raw SQL tiles'
        : 'dashboard tiles';
      throw new Api400Error(
        `Alerts on ${tileKind} are only supported for Line, Stacked Bar, or Number display types`,
      );
    }

    if (tile.config != null && isRawSqlSavedChartConfig(tile.config)) {
      const { errors } = validateRawSqlForAlert(tile.config);
      if (errors.length > 0) {
        throw new Api400Error(
          `Raw SQL alert query is invalid: ${errors.join(', ')}`,
        );
      }
    }
  }

  if (alertInput.source === AlertSource.SAVED_SEARCH) {
    validateObjectId(alertInput.savedSearchId, 'Invalid saved search ID');

    const savedSearch = await getDatastore().savedSearches.getById(
      String(teamId),
      canonicalId(alertInput.savedSearchId!),
    );

    if (savedSearch == null) {
      throw new Api400Error('Saved search not found');
    }
    refs.savedSearch = savedSearch;
  }

  if (alertInput.source === AlertSource.INLINE) {
    const chartConfig = alertInput.chartConfig;
    if (chartConfig == null) {
      throw new Api400Error('Chart config is required');
    }

    if (isRawSqlSavedChartConfig(chartConfig)) {
      if (!displayTypeSupportsRawSqlAlerts(chartConfig.displayType)) {
        throw new Api400Error(
          'Alerts on Raw SQL charts are only supported for Line, Stacked Bar, or Number display types',
        );
      }

      const { errors } = validateRawSqlForAlert(chartConfig);
      if (errors.length > 0) {
        throw new Api400Error(
          `Raw SQL alert query is invalid: ${errors.join(', ')}`,
        );
      }

      // Raw SQL configs carry the connection directly; the source reference
      // is optional metadata for macro expansion ($__sourceTable).
      validateObjectId(chartConfig.connection, 'Invalid connection ID');
      const connectionExists = await getDatastore().connections.exists(
        String(teamId),
        canonicalId(chartConfig.connection),
      );
      if (!connectionExists) {
        throw new Api400Error('Connection not found');
      }
      if (chartConfig.source) {
        validateObjectId(chartConfig.source, 'Invalid source ID');
        const source = await getDatastore().sources.getById(
          String(teamId),
          canonicalId(chartConfig.source),
        );
        if (source == null) {
          throw new Api400Error('Source not found');
        }
        // The worker executes the query through chartConfig.connection while
        // expanding $__sourceTable/metricTables from this source. Accepting a
        // source on a different (even team-owned) connection would query the
        // wrong database - silently wrong values when the table also exists
        // there, repeated query failures when it does not.
        //
        // Compare canonical ids: a lexical comparison of raw strings would
        // reject an equivalent non-canonical spelling.
        if (source.connection !== canonicalId(chartConfig.connection)) {
          throw new Api400Error(
            'Source does not belong to the specified connection',
          );
        }
      }
    } else {
      // Builder configs: same display types the alert task can evaluate as a
      // time series (mirrors the tile-alert rules).
      if (!displayTypeSupportsBuilderAlerts(chartConfig.displayType)) {
        throw new Api400Error(
          'Inline chart alerts are only supported for Line, Stacked Bar, or Number display types',
        );
      }

      validateObjectId(chartConfig.source, 'Invalid source ID');
      const source = await getDatastore().sources.getById(
        String(teamId),
        canonicalId(chartConfig.source!),
      );
      if (source == null) {
        throw new Api400Error('Source not found');
      }

      // Same formula source-kind gate as dashboard tiles ("Add Formula" is
      // disabled in the editor for these kinds), so the API cannot persist a
      // config the editor refuses.
      if (
        'formulas' in chartConfig &&
        (chartConfig.formulas?.length ?? 0) > 0 &&
        !isFormulaSourceKind(source.kind)
      ) {
        throw new Api400Error(
          'Alerts with formulas require a Metric, Log, or Trace source',
        );
      }
    }
  }

  const channels = getAlertChannels(alertInput);
  if (channels.length === 0) {
    throw new Api400Error('At least one notification channel is required');
  }

  const webhookIds = channels
    .filter(c => c.type === 'webhook')
    .map(c => c.webhookId);
  for (const webhookId of webhookIds) {
    validateObjectId(webhookId, 'Invalid webhook ID');
  }
  const uniqueIds = [...new Set(webhookIds)];
  const found = await Promise.all(
    uniqueIds.map(id =>
      getDatastore().webhooks.getById(String(teamId), canonicalId(id)),
    ),
  );
  if (found.some(webhook => webhook == null)) {
    throw new Api400Error('Webhook not found');
  }

  return refs;
};
