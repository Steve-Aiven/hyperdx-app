import { type AlertInterval } from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import * as config from '@/config';
import { getRecentAlertHistories } from '@/controllers/alertHistory';
import { populateDisplayRefs } from '@/controllers/alertRefs';
import { getAlertWithDisplayRefs } from '@/controllers/alerts';
import { getDatastore } from '@/datastore';
import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError, validateObjectId } from '@/mcp/utils/errors';
import { AlertState } from '@/models/alert';
import { translateAlertDocumentToExternalAlertWithChartConfig } from '@/routers/external-api/v2/utils/alertChartConfig';
import { populatedRefOrNull, resolveAlertDisplayFields } from '@/utils/alerts';

export function registerGetAlert({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  registerTool(
    'clickstack_get_alert',
    {
      title: 'Get Alert(s)',
      annotations: READ_ONLY_TOOL,
      description:
        'Without an ID: list all alerts as a high-level summary ' +
        '(id, name, displayName, tags, state, source, interval). Optionally ' +
        'filter by state ' +
        '(e.g. state="ALERT" for firing alerts). ' +
        'With an ID: get full alert detail including configuration, ' +
        'displayName, tags, and recent evaluation history.',
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe(
            'Alert ID from a previous list call or clickstack_save_alert. ' +
              'Omit to list all alerts, provide to get full detail.',
          ),
        state: z
          .enum(['ALERT', 'OK', 'DISABLED', 'INSUFFICIENT_DATA'])
          .optional()
          .describe(
            'List only alerts currently in this state; ignored when id is ' +
              'provided. Use ALERT to find alerts that are firing now.',
          ),
      }),
    },
    async ({ id, state }) => {
      // ── List all alerts (slim summary) ──
      if (!id) {
        const records = await getDatastore().alerts.list(
          teamId,
          state
            ? { state: Object.values(AlertState).filter(s => s === state) }
            : {},
        );
        const alerts = await populateDisplayRefs(teamId, records);

        const output = alerts.map(alert => {
          const { displayName, tags } = resolveAlertDisplayFields(alert, {
            savedSearch: populatedRefOrNull(alert.savedSearch),
            dashboard: populatedRefOrNull(alert.dashboard),
          });
          return {
            id: alert._id,
            name: alert.name,
            displayName,
            tags,
            state: alert.state,
            source: alert.source,
            interval: alert.interval,
            ...(frontendUrl ? { url: `${frontendUrl}/alerts` } : {}),
          };
        });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(output, null, 2) },
          ],
        };
      }

      // ── Get single alert (full detail) ──
      const idError = validateObjectId(id, 'alert ID');
      if (idError) return idError;

      // Resolves the refs the display name/tags derive from, so alerts written
      // before those fields existed still resolve to something meaningful.
      const alert = await getAlertWithDisplayRefs(id, teamId);
      if (!alert) {
        return mcpUserError('Alert not found');
      }

      const external =
        translateAlertDocumentToExternalAlertWithChartConfig(alert);

      const history = await getRecentAlertHistories({
        alertId: new ObjectId(alert._id),
        interval: alert.interval as AlertInterval,
        limit: 20,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...external,
                history,
                ...(frontendUrl ? { url: `${frontendUrl}/alerts` } : {}),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
