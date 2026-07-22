import { defineAuth } from '@aws-amplify/backend';

/**
 * Cognito configuration.
 *
 * `loginWith.email` is required by `defineAuth` — Gen 2 exposes no `username`
 * option ("Amplify Auth does not support signing in with only username and
 * password"). On its own it produces `UsernameAttributes: ["email"]`, which
 * would force employees to sign in with an email address.
 *
 * `amplify/backend.ts` overrides that on the L1 CfnUserPool so that:
 *   - the Cognito username is a real username (employees sign in with it), and
 *   - email is an *alias*, so admins can still type their email to sign in.
 *
 * Those properties are immutable once the pool exists — read the warning in
 * backend.ts before changing anything here.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  userAttributes: {
    email: {
      required: true,
      mutable: true,
    },
    phoneNumber: {
      required: false,
      mutable: true,
    },
  },
  groups: ['ADMIN', 'EMPLOYEE'],
});
