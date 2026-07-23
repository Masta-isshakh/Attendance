import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminListGroupsForUserCommand,
  type AdminListGroupsForUserCommandOutput,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Schema } from '../../data/resource';

const cognito = new CognitoIdentityProviderClient({});
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

const EMAIL_SHAPED = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Once `aliasAttributes: ['email']` is set, Cognito rejects any username that
 * looks like an email address. Fail early with a clear message instead of
 * surfacing Cognito's opaque InvalidParameterException.
 */
function assertUsernameIsNotEmailShaped(username: string) {
  if (EMAIL_SHAPED.test(username)) {
    throw new Error(
      'Username must not look like an email address. Choose a plain username, e.g. "jane.doe".',
    );
  }
}

/**
 * The caller must be the admin of the organization they are acting on.
 * `cognito:groups` is read from the verified JWT, so it cannot be spoofed by
 * the client.
 */
function assertCallerOwnsOrganization(event: { identity: unknown }, organizationId: string) {
  const identity = event.identity as { groups?: string[] | null } | null;
  const groups = identity?.groups ?? [];
  const adminGroup = `${organizationId}_admin`;
  if (!groups.includes(adminGroup)) {
    throw new Error('Forbidden: you are not an admin of this organization.');
  }
}

/**
 * The caller admins the organization they named — but that says nothing about
 * the *target*. Without this check an admin of org A could pass their own
 * organizationId together with an org B employee's username and delete or
 * rewrite them, since all tenants share one Cognito user pool.
 */
async function assertTargetBelongsToOrganization(
  userPoolId: string,
  username: string,
  organizationId: string,
): Promise<void> {
  const groups: string[] = [];
  let nextToken: string | undefined;

  try {
    do {
      const page: AdminListGroupsForUserCommandOutput = await cognito.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: userPoolId,
          Username: username,
          Limit: 60,
          NextToken: nextToken,
        }),
      );
      for (const group of page.Groups ?? []) {
        if (group.GroupName) groups.push(group.GroupName);
      }
      nextToken = page.NextToken;
    } while (nextToken);
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      // Identical message to the not-in-this-org case, so this cannot be used
      // to enumerate usernames across tenants.
      throw new Error('Employee not found in this organization.');
    }
    throw error;
  }

  if (!groups.includes(organizationId)) {
    throw new Error('Employee not found in this organization.');
  }
}

function callerUsername(event: { identity: unknown }): string {
  const identity = event.identity as { username?: string } | null;
  if (!identity?.username) throw new Error('Unauthenticated.');
  return identity.username;
}

// Amplify's Lambda resolver payload puts `fieldName` and `typeName` at the TOP
// level, not under `info` — the event has no `info` property at all. Reading
// `event.info.fieldName` throws "Cannot read properties of undefined".
type AnyEvent = {
  fieldName: string;
  typeName: string;
  identity: unknown;
  arguments: Record<string, string | null | undefined>;
};

async function createEmployee(event: AnyEvent) {
  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) throw new Error('USER_POOL_ID is not configured');

  const username = String(event.arguments.username ?? '').trim();
  const email = String(event.arguments.email ?? '').trim().toLowerCase();
  const phoneNumber = event.arguments.phoneNumber?.trim() || undefined;
  const temporaryPassword = String(event.arguments.temporaryPassword ?? '');
  const organizationId = String(event.arguments.organizationId ?? '');

  if (!username || !email || !temporaryPassword || !organizationId) {
    throw new Error('username, email, temporaryPassword and organizationId are required.');
  }
  assertUsernameIsNotEmailShaped(username);
  assertCallerOwnsOrganization(event, organizationId);

  const attributes = [
    { Name: 'email', Value: email },
    // Required for email to work as a sign-in alias.
    { Name: 'email_verified', Value: 'true' },
    ...(phoneNumber ? [{ Name: 'phone_number', Value: phoneNumber }] : []),
  ];

  try {
    const created = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: username,
        TemporaryPassword: temporaryPassword,
        UserAttributes: attributes,
        // Defaults to SMS, which would silently send nothing here.
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );

    const userId =
      created.User?.Attributes?.find((attribute) => attribute.Name === 'sub')?.Value ?? '';

    // Member group scopes their data to this organization; EMPLOYEE drives
    // workspace routing after sign-in.
    for (const groupName of [organizationId, 'EMPLOYEE']) {
      await cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: username,
          GroupName: groupName,
        }),
      );
    }

    return {
      userId,
      username,
      email,
      status: 'INVITED',
      message: 'Employee created. Cognito emailed their username and temporary password.',
    };
  } catch (error) {
    if (error instanceof UsernameExistsException) {
      throw new Error(`The username "${username}" is already taken. Usernames must be unique.`);
    }
    throw error;
  }
}

async function updateEmployeeAccount(event: AnyEvent) {
  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) throw new Error('USER_POOL_ID is not configured');

  const username = String(event.arguments.username ?? '');
  const organizationId = String(event.arguments.organizationId ?? '');
  if (!username || !organizationId) throw new Error('username and organizationId are required.');
  assertCallerOwnsOrganization(event, organizationId);
  await assertTargetBelongsToOrganization(userPoolId, username, organizationId);

  const email = event.arguments.email?.trim().toLowerCase();
  const phoneNumber = event.arguments.phoneNumber?.trim();

  const attributes = [
    ...(email ? [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }] : []),
    ...(phoneNumber ? [{ Name: 'phone_number', Value: phoneNumber }] : []),
  ];

  if (attributes.length > 0) {
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: username,
        UserAttributes: attributes,
      }),
    );
  }

  const enabled = event.arguments.enabled;
  if (enabled === 'true') {
    await cognito.send(new AdminEnableUserCommand({ UserPoolId: userPoolId, Username: username }));
  } else if (enabled === 'false') {
    await cognito.send(new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: username }));
  }

  return { userId: '', username, email: email ?? '', status: 'UPDATED', message: 'Employee updated.' };
}

async function deleteEmployeeAccount(event: AnyEvent) {
  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) throw new Error('USER_POOL_ID is not configured');

  const username = String(event.arguments.username ?? '');
  const organizationId = String(event.arguments.organizationId ?? '');
  if (!username || !organizationId) throw new Error('username and organizationId are required.');
  assertCallerOwnsOrganization(event, organizationId);

  if (username === callerUsername(event)) {
    throw new Error('You cannot delete your own admin account.');
  }

  await assertTargetBelongsToOrganization(userPoolId, username, organizationId);

  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));

  return { userId: '', username, email: '', status: 'DELETED', message: 'Employee deleted.' };
}

/**
 * Admins need to see employee photos, but the S3 access rules deliberately
 * scope `profile-photos/{entity_id}/*` to the owning identity so that an admin
 * of one organization cannot read another organization's media. This mutation
 * re-opens that door narrowly: it verifies the caller admins the organization,
 * then hands back a short-lived presigned URL.
 */
async function getEmployeePhotoUrl(event: AnyEvent) {
  const bucket = process.env.MEDIA_BUCKET_NAME;
  const tableName = process.env.EMPLOYEE_TABLE_NAME;
  if (!bucket) throw new Error('MEDIA_BUCKET_NAME is not configured');
  if (!tableName) throw new Error('EMPLOYEE_TABLE_NAME is not configured');

  const organizationId = String(event.arguments.organizationId ?? '');
  const username = String(event.arguments.username ?? '');
  if (!organizationId || !username) {
    throw new Error('organizationId and username are required.');
  }
  assertCallerOwnsOrganization(event, organizationId);

  // The key is resolved from the record, never taken from the caller. Accepting
  // a key would let an admin presign ANY object in the shared bucket — the
  // exact cross-tenant leak the storage rules exist to prevent.
  const found = await dynamo.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: '#org = :org AND #username = :username',
      ExpressionAttributeNames: { '#org': 'organizationId', '#username': 'username' },
      ExpressionAttributeValues: {
        ':org': { S: organizationId },
        ':username': { S: username },
      },
      Limit: 200,
    }),
  );

  const record = found.Items?.[0];
  const key = record?.profilePhotoKey?.S;
  if (!record || !key) throw new Error('Employee not found in this organization.');

  // Defence in depth: only ever presign profile photos.
  if (!key.startsWith('profile-photos/')) {
    throw new Error('Employee not found in this organization.');
  }

  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: 900,
  });
  return { url, expiresInSeconds: 900 };
}

export const handler: Schema['createEmployeeAccount']['functionHandler'] = async (event) => {
  const anyEvent = event as unknown as AnyEvent;
  switch (anyEvent.fieldName) {
    case 'createEmployeeAccount':
      return (await createEmployee(anyEvent)) as never;
    case 'updateEmployeeAccount':
      return (await updateEmployeeAccount(anyEvent)) as never;
    case 'deleteEmployeeAccount':
      return (await deleteEmployeeAccount(anyEvent)) as never;
    case 'getEmployeePhotoUrl':
      return (await getEmployeePhotoUrl(anyEvent)) as never;
    default:
      throw new Error(`Unsupported operation: ${anyEvent.fieldName}`);
  }
};
