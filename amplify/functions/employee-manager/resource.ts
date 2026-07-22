import { defineFunction } from '@aws-amplify/backend';

/**
 * Cognito-side lifecycle for employee accounts: create, disable/enable, delete,
 * plus presigned photo URLs for the admin roster.
 *
 * One function serves several custom mutations; it dispatches on
 * `event.info.fieldName`.
 */
export const employeeManager = defineFunction({
  name: 'employee-manager',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 512,
});
