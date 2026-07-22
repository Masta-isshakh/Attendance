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
  // This function is both a data resolver AND reads a data table, which puts
  // the function and data stacks in a circular dependency. Placing it in the
  // data stack is the documented resolution.
  resourceGroupName: 'data',
});
