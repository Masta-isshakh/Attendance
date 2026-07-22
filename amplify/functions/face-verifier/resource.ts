import { defineFunction } from '@aws-amplify/backend';

/**
 * Compares a check-in selfie against the employee's stored profile photo using
 * Amazon Rekognition.
 *
 * `defineFunction` defaults to a 3 second timeout, which a Rekognition
 * round-trip plus two S3 reads plus a cold start will exceed. 30s matches
 * AppSync's hard ceiling; 1024MB roughly halves cold-start time.
 */
export const faceVerifier = defineFunction({
  name: 'face-verifier',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 1024,
});
