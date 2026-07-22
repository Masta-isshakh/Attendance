import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { client } from './amplify';
import { performCheckIn, performCheckOut, recordPresencePing } from './attendance';
import { isConfidentlyInside, type Coordinates } from './geo';

export const GEOFENCE_TASK = 'attendance-geofence';
export const LOCATION_TASK = 'attendance-location';
const CONTEXT_KEY = 'attendance.geofenceContext';

/**
 * The background task runs in a separate JS context with no React state, so
 * everything it needs is persisted here when the app is in the foreground.
 */
export type GeofenceContext = {
  employeeId: string;
  userId: string;
  organizationId: string;
  memberGroup: string;
  adminGroup: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  geofenceRuleEnabled: boolean;
  attendanceMode: 'MANUAL' | 'AUTOMATIC';
  presenceStalenessMinutes: number;
};

export async function saveGeofenceContext(context: GeofenceContext): Promise<void> {
  await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
}

export async function loadGeofenceContext(): Promise<GeofenceContext | null> {
  try {
    const raw = await AsyncStorage.getItem(CONTEXT_KEY);
    return raw ? (JSON.parse(raw) as GeofenceContext) : null;
  } catch {
    return null;
  }
}

export async function clearGeofenceContext(): Promise<void> {
  await AsyncStorage.removeItem(CONTEXT_KEY);
}

async function applyPosition(coordinates: Coordinates, accuracy: number | null) {
  const context = await loadGeofenceContext();
  if (!context) return;

  const { data: employee } = await client.models.Employee.get({ id: context.employeeId });
  if (!employee) return;

  // Every branch below is decided server-side. The background task only reports
  // where the device is; it cannot assert that anyone is present.
  if (context.attendanceMode === 'AUTOMATIC') {
    const inside = checkRangeFromContext(context, coordinates, accuracy);

    // Arriving checks you in, leaving checks you out — no selfie, which is the
    // trade the admin accepted when choosing automatic mode.
    if (inside && !employee.isCheckedIn) {
      await performCheckIn({ position: coordinates, accuracy, selfieKey: null });
      return;
    }
    if (!inside && employee.isCheckedIn) {
      await performCheckOut({ position: coordinates, accuracy, selfieKey: null });
      return;
    }
  }

  // Manual mode with the geofence rule on: presence follows location, but the
  // shift itself is only ended by an explicit check-out.
  await recordPresencePing({ position: coordinates, accuracy });
}

/**
 * A cheap local check used only to decide *which* server call to make. The
 * server re-derives the real answer either way.
 */
function checkRangeFromContext(
  context: GeofenceContext,
  coordinates: Coordinates,
  accuracy: number | null,
): boolean {
  return isConfidentlyInside(
    coordinates,
    { latitude: context.latitude, longitude: context.longitude },
    context.radiusMeters,
    accuracy,
  );
}

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { region } = data as { region: Location.LocationRegion };
  if (!region.latitude || !region.longitude) return;

  // A geofence event tells us we crossed a boundary, but not precisely where we
  // are now — take a real reading rather than trusting the region centre.
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    await applyPosition(
      { latitude: position.coords.latitude, longitude: position.coords.longitude },
      position.coords.accuracy ?? null,
    );
  } catch {
    // Never throw out of a background task — the OS treats it as a crash.
  }
});

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const latest = locations?.[locations.length - 1];
  if (!latest) return;

  try {
    await applyPosition(
      { latitude: latest.coords.latitude, longitude: latest.coords.longitude },
      latest.coords.accuracy ?? null,
    );
  } catch {
    // Swallow — see above.
  }
});

export const backgroundSupported = Platform.OS !== 'web';

/**
 * Registers (or re-registers) background tracking.
 *
 * Must be called on every app launch and foreground: Android will not restart
 * the app for location events after a force-kill, and iOS only relaunches for
 * geofence transitions. Re-registering is the only way to recover.
 */
export async function startBackgroundTracking(context: GeofenceContext): Promise<boolean> {
  if (!backgroundSupported) return false;

  await saveGeofenceContext(context);

  const foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return false;
  const background = await Location.getBackgroundPermissionsAsync();
  if (background.status !== 'granted') return false;

  try {
    const geofencing = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
    if (geofencing) await Location.stopGeofencingAsync(GEOFENCE_TASK);

    await Location.startGeofencingAsync(GEOFENCE_TASK, [
      {
        identifier: context.organizationId,
        latitude: context.latitude,
        longitude: context.longitude,
        radius: Math.max(context.radiusMeters, 100), // iOS ignores tiny regions.
        notifyOnEnter: true,
        notifyOnExit: true,
      },
    ]);

    const tracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (!tracking) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 50,
        timeInterval: 5 * 60 * 1000,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: 'Attendance',
          notificationBody: 'Tracking your attendance at work',
        },
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function stopBackgroundTracking(): Promise<void> {
  if (!backgroundSupported) return;
  try {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // Nothing to stop.
  }
  await clearGeofenceContext();
}
