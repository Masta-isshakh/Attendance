import { defineFunction } from '@aws-amplify/backend';

/**
 * The only writer of attendance.
 *
 * Check-in and check-out used to be written by the app, which meant the
 * geofence and face checks were enforced on the device — anyone able to call
 * the API could mark themselves present from home. This function re-verifies
 * location and identity server-side before anything is recorded.
 *
 * Needs the long timeout because a check-in may include a Rekognition
 * CompareFaces round-trip.
 */
export const attendanceRecorder = defineFunction({
  name: 'attendance-recorder',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 1024,
  resourceGroupName: 'data',
});
