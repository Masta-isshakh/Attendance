import { defineStorage } from '@aws-amplify/backend';

/**
 * Media bucket.
 *
 * `{entity_id}` resolves to the caller's Identity Pool identityId, NOT an
 * organization id — it is the only supported dynamic segment. That gives each
 * user private access to their own files, which is correct for selfies and
 * profile photos.
 *
 * Cross-tenant access (an admin viewing an employee's photo) deliberately does
 * NOT go through a static `allow.groups(['ADMIN'])` rule, because that would
 * let an admin of one organization read another organization's photos. Admins
 * fetch photos through the `getEmployeePhotoUrl` mutation instead, which checks
 * organization membership and returns a short-lived presigned URL.
 */
export const storage = defineStorage({
  name: 'attendanceMedia',
  access: (allow) => ({
    // The employee's own profile photo, captured at first login.
    'profile-photos/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
    // Check-in / check-out selfies awaiting face verification.
    'selfies/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
    // Organization logos. Readable by any signed-in user so employees can see
    // their own org branding; only the owning admin can write their own.
    'org-logos/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
      allow.authenticated.to(['read']),
    ],
  }),
});
