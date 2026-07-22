import { defineFunction } from '@aws-amplify/backend';

/**
 * Creates the two Cognito groups that back a new organization and enrols the
 * calling admin in them.
 *
 * Groups cannot be declared per-organization at build time — `defineAuth`'s
 * `groups` option is a static string array — so they are created at runtime
 * through the Cognito API.
 */
export const orgProvisioner = defineFunction({
  name: 'org-provisioner',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 512,
});
