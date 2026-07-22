import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { attendanceRecorder } from './functions/attendance-recorder/resource';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { employeeManager } from './functions/employee-manager/resource';
import { faceVerifier } from './functions/face-verifier/resource';
import { orgProvisioner } from './functions/org-provisioner/resource';
import { storage } from './storage/resource';

const backend = defineBackend({
  auth,
  data,
  storage,
  orgProvisioner,
  employeeManager,
  faceVerifier,
  attendanceRecorder,
});

/* ---------------------------------------------------------------------------
 * Cognito user pool overrides.
 *
 * WARNING: usernameAttributes, aliasAttributes and usernameConfiguration are
 * IMMUTABLE once the pool exists. `UpdateUserPool` has no parameters for them,
 * so editing these values and redeploying reports SUCCESS while silently
 * changing nothing. Changing them for real means destroying the pool
 * (`npx ampx sandbox delete`) and deploying again, which deletes every user.
 *
 * Get these right before the first deploy.
 * ------------------------------------------------------------------------- */
const { cfnUserPool, cfnUserPoolClient } = backend.auth.resources.cfnResources;

// Free `username` as the sign-in identifier so employees sign in with a
// username. `defineAuth` on its own would set this to ['email'].
cfnUserPool.usernameAttributes = [];

// Email as an alias, so admins can still type their email address to sign in.
// Note: with this set, Cognito REJECTS any username that looks like an email,
// which is why admins are created with a username such as "admin-acme".
cfnUserPool.aliasAttributes = ['email'];

// The product has no sign-up screen. Without this, anyone holding the public
// client id could create their own account.
cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// Usernames match case-insensitively, so "Jane.Doe" and "jane.doe" are the same
// person. Also immutable after creation.
cfnUserPool.usernameConfiguration = {
  caseSensitive: false,
};

cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 8,
    requireLowercase: true,
    requireUppercase: true,
    requireNumbers: true,
    requireSymbols: false,
    temporaryPasswordValidityDays: 7,
  },
};

// Never let the sign-in screen reveal whether an account exists.
cfnUserPoolClient.preventUserExistenceErrors = 'ENABLED';

/* ---------------------------------------------------------------------------
 * Function environment + IAM
 * ------------------------------------------------------------------------- */
const userPoolId = backend.auth.resources.userPool.userPoolId;
const userPoolArn = backend.auth.resources.userPool.userPoolArn;
const mediaBucket = backend.storage.resources.bucket;

const employeeTable = backend.data.resources.tables.Employee;
const organizationTable = backend.data.resources.tables.Organization;
const attendanceTable = backend.data.resources.tables.AttendanceRecord;

// The attendance recorder is the sole writer of attendance data. It reads the
// employee and organization to re-verify the geofence, and writes the record
// plus the employee's status.
backend.attendanceRecorder.addEnvironment('EMPLOYEE_TABLE_NAME', employeeTable.tableName);
backend.attendanceRecorder.addEnvironment('ORGANIZATION_TABLE_NAME', organizationTable.tableName);
backend.attendanceRecorder.addEnvironment('ATTENDANCE_TABLE_NAME', attendanceTable.tableName);
backend.attendanceRecorder.addEnvironment('MEDIA_BUCKET_NAME', backend.storage.resources.bucket.bucketName);

organizationTable.grantReadData(backend.attendanceRecorder.resources.lambda);
employeeTable.grantReadWriteData(backend.attendanceRecorder.resources.lambda);
attendanceTable.grantReadWriteData(backend.attendanceRecorder.resources.lambda);

backend.storage.resources.bucket.grantRead(
  backend.attendanceRecorder.resources.lambda,
  'profile-photos/*',
);
backend.storage.resources.bucket.grantRead(
  backend.attendanceRecorder.resources.lambda,
  'selfies/*',
);

backend.attendanceRecorder.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['rekognition:CompareFaces'],
    resources: ['*'],
  }),
);

backend.orgProvisioner.addEnvironment('USER_POOL_ID', userPoolId);
backend.employeeManager.addEnvironment('USER_POOL_ID', userPoolId);
backend.employeeManager.addEnvironment('MEDIA_BUCKET_NAME', mediaBucket.bucketName);
backend.employeeManager.addEnvironment('EMPLOYEE_TABLE_NAME', employeeTable.tableName);
backend.faceVerifier.addEnvironment('MEDIA_BUCKET_NAME', mediaBucket.bucketName);
backend.faceVerifier.addEnvironment('EMPLOYEE_TABLE_NAME', employeeTable.tableName);

// Both functions resolve S3 keys from the Employee record rather than trusting
// keys supplied by the client.
employeeTable.grantReadData(backend.employeeManager.resources.lambda);
employeeTable.grantReadData(backend.faceVerifier.resources.lambda);

backend.orgProvisioner.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'cognito-idp:CreateGroup',
      'cognito-idp:GetGroup',
      'cognito-idp:AdminAddUserToGroup',
    ],
    resources: [userPoolArn],
  }),
);

backend.employeeManager.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminDeleteUser',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminEnableUser',
      'cognito-idp:AdminUpdateUserAttributes',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminGetUser',
      // Required to prove a target user really belongs to the caller's org.
      'cognito-idp:AdminListGroupsForUser',
    ],
    resources: [userPoolArn],
  }),
);

// Presigned URLs for the admin roster, and Rekognition's S3 reads. Scoped to
// the media prefixes these functions legitimately touch.
mediaBucket.grantRead(backend.employeeManager.resources.lambda, 'profile-photos/*');
mediaBucket.grantRead(backend.faceVerifier.resources.lambda, 'profile-photos/*');
mediaBucket.grantRead(backend.faceVerifier.resources.lambda, 'selfies/*');

backend.faceVerifier.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['rekognition:CompareFaces'],
    // CompareFaces operates on images, not on a resource, so it cannot be
    // scoped by ARN.
    resources: ['*'],
  }),
);

export default backend;
