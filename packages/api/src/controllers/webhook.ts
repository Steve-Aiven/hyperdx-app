import { getDatastore } from '@/datastore';
import type { WebhookRecord } from '@/datastore/types';
import type { ObjectId } from '@/models';
import { WebhookService } from '@/models/webhook';
import { validateWebhookConfig } from '@/utils/validators';

export interface WebhookInput {
  name: string;
  service: WebhookService;
  url: string;
  description?: string;
  titleEmoji?: boolean;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Create a team-scoped webhook. Shared by the internal API, External API v2, and
 * MCP; callers handle their own duplicate-key errors and secret redaction.
 */
export async function createWebhook(
  team: ObjectId | string,
  input: WebhookInput,
) {
  validateWebhookConfig(input);

  return getDatastore().webhooks.create(String(team), input);
}

export type UpdateWebhookResult =
  | { status: 'ok'; webhook: WebhookRecord }
  | { status: 'not_found' }
  | { status: 'conflict' };

/**
 * Update (full replace) a team-scoped webhook. Readable fields (description,
 * body) are set/cleared by presence; write-only fields (headers, queryParams)
 * are preserved when omitted and cleared on empty {} — or cleared outright when
 * the destination (url/service) changes, so stored secrets are never forwarded
 * to a new destination. Shared by External API v2 and MCP.
 */
export async function updateWebhook(
  team: ObjectId | string,
  webhookId: string,
  input: WebhookInput,
): Promise<UpdateWebhookResult> {
  const { webhooks } = getDatastore();
  const teamId = String(team);
  const existing = await webhooks.getById(teamId, webhookId);
  if (existing == null) {
    return { status: 'not_found' };
  }

  const { name, service, url, description, titleEmoji, body } = input;
  validateWebhookConfig({ service, url, body });

  const destinationChanged =
    url !== existing.url || service !== existing.service;

  const resolveMap = (
    incoming: Record<string, string> | undefined,
    stored: Record<string, string> | undefined,
  ) => {
    if (incoming === undefined) return destinationChanged ? undefined : stored;
    return Object.keys(incoming).length === 0 ? undefined : incoming;
  };

  // Pin to the snapshotted url/service so a concurrent destination change
  // yields a conflict rather than attaching a secret to the wrong destination.
  const webhook = await webhooks.replace(
    teamId,
    webhookId,
    {
      name,
      service,
      url,
      description,
      titleEmoji,
      body,
      headers: resolveMap(input.headers, existing.headers),
      queryParams: resolveMap(input.queryParams, existing.queryParams),
    },
    { url: existing.url, service: existing.service },
  );

  if (webhook == null) {
    const stillExists = await webhooks.getById(teamId, webhookId);
    return stillExists != null
      ? { status: 'conflict' }
      : { status: 'not_found' };
  }

  return { status: 'ok', webhook };
}

export type DeleteWebhookResult =
  | { status: 'ok'; webhook: WebhookRecord }
  | { status: 'not_found' }
  | { status: 'referenced'; alertCount: number };

/**
 * Delete a webhook for a team, blocking deletion while alerts still reference it
 * so we never orphan an alert onto a missing destination.
 */
export async function deleteWebhook(
  team: ObjectId | string,
  webhookId: string,
): Promise<DeleteWebhookResult> {
  const { alerts, webhooks } = getDatastore();
  const teamId = String(team);
  // Match on webhookId alone (not channel.type) so a legacy/skewed alert that
  // still references this webhook also blocks deletion.
  const alertCount = await alerts.countByWebhook(teamId, webhookId);
  if (alertCount > 0) {
    return { status: 'referenced', alertCount };
  }

  const deleted = await webhooks.delete(teamId, webhookId);
  if (deleted == null) {
    return { status: 'not_found' };
  }

  return { status: 'ok', webhook: deleted };
}
