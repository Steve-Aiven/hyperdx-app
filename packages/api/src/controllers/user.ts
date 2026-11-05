import type { OnboardingTaskId } from '@hyperdx/common-utils/dist/types';
import { isPersistableUserId as isPersistableUserIdHex } from '@hyperdx/common-utils/dist/types';

import { getDatastore } from '@/datastore';
import type { ObjectId } from '@/models';
import logger from '@/utils/logger';

export function findUserByAccessKey(accessKey: string) {
  return getDatastore().users.findByAccessKey(accessKey);
}

/**
 * Rotates a user's personal access key, immediately revoking the previous one.
 *
 * There is exactly one key per user and no grace period: findUserByAccessKey
 * above is hit uncached on every bearer request (see validateUserAccessKey), so
 * requests presenting the old key start 401ing the instant this returns.
 */
export function rotateUserAccessKey(userId: string | ObjectId) {
  return getDatastore().users.rotateAccessKey(userId.toString());
}

export function findUserById(id: string | ObjectId) {
  return getDatastore().users.findById(id.toString());
}

// Backends match emails case-insensitively (emails are stored lowercased).
export function findUserByEmail(email: string) {
  return getDatastore().users.findByEmail(email);
}

export function findUsersByTeam(team: string | ObjectId) {
  return getDatastore().users.findByTeam(team.toString());
}

// Type-guard wrapper over the shared 24-hex check; rejects the synthetic
// `_local_user_` id injected in IS_LOCAL_APP_MODE (see isPersistableUserIdHex).
function isPersistableUserId(
  userId: string | ObjectId | undefined | null,
): userId is string | ObjectId {
  return userId != null && isPersistableUserIdHex(String(userId));
}

// Returns null for a non-persistable user so the route reports unchanged
// default state rather than a write that silently matched nothing.
export async function completeOnboardingTask(
  userId: string | ObjectId,
  taskId: OnboardingTaskId,
) {
  if (!isPersistableUserId(userId)) {
    return null;
  }
  return getDatastore().users.completeOnboardingTask(userId.toString(), taskId);
}

export function setOnboardingDismissed(
  userId: string | ObjectId,
  isDismissed: boolean,
) {
  if (!isPersistableUserId(userId)) {
    return null;
  }
  return getDatastore().users.setOnboardingDismissed(
    userId.toString(),
    isDismissed,
  );
}

// Fire-and-forget recording from an unrelated write path (alert/dashboard save,
// MCP tool call): must never fail or delay the triggering operation, so errors
// are swallowed. These fire on every save / tool call; the repositories skip
// the write once the task is recorded.
export function recordOnboardingTaskCompletion(
  userId: string | ObjectId | undefined | null,
  taskId: OnboardingTaskId,
) {
  if (!isPersistableUserId(userId)) {
    return;
  }
  void getDatastore()
    .users.completeOnboardingTask(userId.toString(), taskId)
    .catch(err => {
      logger.warn(
        { error: err, userId: userId.toString(), taskId },
        'Failed to record onboarding task completion',
      );
    });
}

export function deleteTeamMember(
  teamId: string | ObjectId,
  userIdToDelete: string,
  userIdRequestingDelete: string | ObjectId,
) {
  return getDatastore().users.deleteFromTeam(
    teamId.toString(),
    userIdToDelete,
    userIdRequestingDelete.toString(),
  );
}
