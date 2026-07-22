import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
  CreateGroupCommand,
  GroupExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'node:crypto';
import type { Schema } from '../../data/resource';

const cognito = new CognitoIdentityProviderClient({});

/**
 * Two groups are created per organization:
 *   org_<id>_admin  -> the single owning admin. Grants write access.
 *   org_<id>        -> every member (admin + employees). Grants read access.
 *
 * Splitting them is what stops an employee from editing their own
 * organization's company location or attendance mode.
 */
async function ensureGroup(userPoolId: string, groupName: string, description: string) {
  try {
    await cognito.send(
      new CreateGroupCommand({
        UserPoolId: userPoolId,
        GroupName: groupName,
        Description: description,
      }),
    );
  } catch (error) {
    // Re-provisioning an existing organization must not fail.
    if (!(error instanceof GroupExistsException)) throw error;
  }
}

export const handler: Schema['provisionOrganization']['functionHandler'] = async (event) => {
  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) throw new Error('USER_POOL_ID is not configured');

  const identity = event.identity as
    | { username?: string; sub?: string; groups?: string[] | null }
    | null;
  const username = identity?.username;
  if (!username) throw new Error('Unauthenticated: no Cognito username on the request');

  // Defence in depth behind the ADMIN-only rule on the mutation. Without this,
  // any authenticated caller could mint an organization and add themselves to
  // its admin group.
  const groups = identity?.groups ?? [];
  if (!groups.includes('ADMIN')) {
    throw new Error('Forbidden: only administrators can create an organization.');
  }

  // Already runs an organization: one admin owns exactly one organization.
  if (groups.some((group) => group.startsWith('org_') && group.endsWith('_admin'))) {
    throw new Error('You already have an organization.');
  }

  // The id is always generated here. Accepting one from the client would let a
  // caller be added to an existing organization's admin group.
  const organizationId = `org_${randomUUID()}`;
  const memberGroup = organizationId;
  const adminGroup = `${organizationId}_admin`;

  await ensureGroup(userPoolId, memberGroup, 'All members of the organization');
  await ensureGroup(userPoolId, adminGroup, 'Owning admin of the organization');

  for (const groupName of [memberGroup, adminGroup]) {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: groupName,
      }),
    );
  }

  return { organizationId, adminGroup, memberGroup };
};
