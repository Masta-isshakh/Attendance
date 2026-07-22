import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { employeeManager } from '../functions/employee-manager/resource';
import { faceVerifier } from '../functions/face-verifier/resource';
import { orgProvisioner } from '../functions/org-provisioner/resource';

/**
 * Tenant isolation
 * ----------------
 * Every tenant-scoped model carries two Cognito group names:
 *
 *   memberGroup = "org_<uuid>"        -> admin + all employees. Read access.
 *   adminGroup  = "org_<uuid>_admin"  -> the owning admin only. Write access.
 *
 * `allow.groupDefinedIn(field)` evaluates the caller's verified `cognito:groups`
 * claim against the value stored on the record, so isolation is enforced by
 * AppSync itself. It is never enforced by a client-side `filter` — `filter` is a
 * client-supplied argument, so an employee of org B could simply omit it and
 * read org A's records.
 *
 * Splitting member/admin groups is what stops an employee from rewriting their
 * own organization's geofence or attendance mode.
 */
const schema = a
  .schema({
    AttendanceMode: a.enum(['MANUAL', 'AUTOMATIC']),
    EmployeeStatus: a.enum(['ACTIVE', 'INACTIVE']),
    AttendanceMethod: a.enum(['MANUAL', 'AUTOMATIC']),

    Organization: a
      .model({
        organizationId: a.string().required(),
        memberGroup: a.string().required(),
        adminGroup: a.string().required(),
        name: a.string().required(),
        logoKey: a.string(),
        adminUserId: a.string().required(),
        adminUsername: a.string().required(),

        // Geofence configuration.
        latitude: a.float(),
        longitude: a.float(),
        radiusMeters: a.integer(),
        geofenceRuleEnabled: a.boolean(),
        attendanceMode: a.ref('AttendanceMode'),

        // How long a location ping stays trustworthy. Status is derived from
        // timestamped pings rather than a device-pushed boolean, because OS
        // geofence events are batched and can arrive minutes late.
        presenceStalenessMinutes: a.integer(),

        employees: a.hasMany('Employee', 'organizationId'),
        attendance: a.hasMany('AttendanceRecord', 'organizationId'),
      })
      .identifier(['organizationId'])
      .authorization((allow) => [
        allow.groupDefinedIn('adminGroup'),
        allow.groupDefinedIn('memberGroup').to(['read']),
      ]),

    Employee: a
      .model({
        // Tenancy and identity fields are admin-writable ONLY. Without these
        // field-level rules the owner rule below would let an employee move
        // their own record into another organization, or rewrite the email
        // that acts as their sign-in alias.
        organizationId: a
          .string()
          .required()
          .authorization((allow) => [allow.groupDefinedIn('adminGroup')]),
        memberGroup: a
          .string()
          .required()
          .authorization((allow) => [allow.groupDefinedIn('adminGroup')]),
        adminGroup: a
          .string()
          .required()
          .authorization((allow) => [allow.groupDefinedIn('adminGroup')]),

        // Cognito `sub`. Stable even if the username is ever changed.
        userId: a
          .string()
          .required()
          .authorization((allow) => [allow.groupDefinedIn('adminGroup')]),
        username: a
          .string()
          .required()
          .authorization((allow) => [allow.groupDefinedIn('adminGroup')]),
        email: a
          .string()
          .required()
          .authorization((allow) => [allow.groupDefinedIn('adminGroup')]),
        phoneNumber: a.string(),
        fullName: a.string(),

        profilePhotoKey: a.string(),
        hasCompletedFirstLogin: a.boolean(),

        status: a.ref('EmployeeStatus'),
        isCheckedIn: a.boolean(),
        lastSeenInsideAt: a.datetime(),
        lastKnownLatitude: a.float(),
        lastKnownLongitude: a.float(),
        lastStatusChangeAt: a.datetime(),
        disabled: a.boolean(),

        organization: a.belongsTo('Organization', 'organizationId'),
        attendance: a.hasMany('AttendanceRecord', 'employeeId'),
      })
      .secondaryIndexes((index) => [index('organizationId').sortKeys(['username'])])
      .authorization((allow) => [
        allow.groupDefinedIn('adminGroup'),
        // An employee may read and update only their own record.
        allow.ownerDefinedIn('userId').identityClaim('sub').to(['read', 'update']),
      ]),

    AttendanceRecord: a
      .model({
        organizationId: a.string().required(),
        memberGroup: a.string().required(),
        adminGroup: a.string().required(),

        employeeId: a.id().required(),
        userId: a.string().required(),
        employeeUsername: a.string(),

        checkInAt: a.datetime().required(),
        checkOutAt: a.datetime(),
        checkInLatitude: a.float(),
        checkInLongitude: a.float(),
        checkOutLatitude: a.float(),
        checkOutLongitude: a.float(),

        method: a.ref('AttendanceMethod'),
        checkInFaceSimilarity: a.float(),
        checkOutFaceSimilarity: a.float(),

        // Rolling presence, used to derive ACTIVE/INACTIVE honestly.
        lastSeenInsideAt: a.datetime(),
        totalSecondsPresent: a.integer(),
        dayKey: a.string().required(),

        organization: a.belongsTo('Organization', 'organizationId'),
        employee: a.belongsTo('Employee', 'employeeId'),
      })
      .secondaryIndexes((index) => [
        index('organizationId').sortKeys(['checkInAt']).name('byOrganizationAndDate'),
        index('userId').sortKeys(['checkInAt']).name('byUserAndDate'),
      ])
      .authorization((allow) => [
        allow.groupDefinedIn('adminGroup'),
        allow.ownerDefinedIn('userId').identityClaim('sub').to(['create', 'read', 'update']),
      ]),

    // ---- Custom mutation payloads -----------------------------------------

    ProvisionOrganizationResult: a.customType({
      organizationId: a.string().required(),
      adminGroup: a.string().required(),
      memberGroup: a.string().required(),
    }),

    EmployeeAccountResult: a.customType({
      userId: a.string(),
      username: a.string(),
      email: a.string(),
      status: a.string(),
      message: a.string(),
    }),

    PhotoUrlResult: a.customType({
      url: a.string().required(),
      expiresInSeconds: a.integer().required(),
    }),

    FaceVerificationResult: a.customType({
      matched: a.boolean().required(),
      similarity: a.float().required(),
      reason: a.string().required(),
    }),

    // ---- Custom mutations --------------------------------------------------

    // ADMIN-only: with `allow.authenticated()` any signed-in employee could
    // mint themselves an organization, land in its `_admin` group and be
    // routed into the admin workspace. Admins are placed in ADMIN by hand in
    // the Cognito console, so this still permits legitimate first-time setup.
    provisionOrganization: a
      .mutation()
      .arguments({})
      .returns(a.ref('ProvisionOrganizationResult'))
      .authorization((allow) => [allow.group('ADMIN')])
      .handler(a.handler.function(orgProvisioner)),

    createEmployeeAccount: a
      .mutation()
      .arguments({
        organizationId: a.string().required(),
        username: a.string().required(),
        email: a.string().required(),
        phoneNumber: a.string(),
        temporaryPassword: a.string().required(),
      })
      .returns(a.ref('EmployeeAccountResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(employeeManager)),

    updateEmployeeAccount: a
      .mutation()
      .arguments({
        organizationId: a.string().required(),
        username: a.string().required(),
        email: a.string(),
        phoneNumber: a.string(),
        enabled: a.string(),
      })
      .returns(a.ref('EmployeeAccountResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(employeeManager)),

    deleteEmployeeAccount: a
      .mutation()
      .arguments({
        organizationId: a.string().required(),
        username: a.string().required(),
      })
      .returns(a.ref('EmployeeAccountResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(employeeManager)),

    // Takes a username, never an S3 key. Accepting a key let an admin of one
    // organization presign any object in the shared bucket, including another
    // organization's employee photos.
    getEmployeePhotoUrl: a
      .mutation()
      .arguments({
        organizationId: a.string().required(),
        username: a.string().required(),
      })
      .returns(a.ref('PhotoUrlResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(employeeManager)),

    // Only the selfie key is supplied, and it must live under the caller's own
    // identity prefix. The reference photo is resolved server-side from the
    // caller's Employee record — otherwise passing the same key twice scores a
    // trivial 100% match.
    verifyFace: a
      .mutation()
      .arguments({
        selfieKey: a.string().required(),
      })
      .returns(a.ref('FaceVerificationResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(faceVerifier)),
  })
  .authorization((allow) => [
    allow.resource(orgProvisioner),
    allow.resource(employeeManager),
    allow.resource(faceVerifier),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // Owner- and group-based rules require the user pool, not the identity pool.
    defaultAuthorizationMode: 'userPool',
  },
});
