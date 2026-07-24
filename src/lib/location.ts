import * as Location from 'expo-location';
import { Platform } from 'react-native';
import type { Coordinates } from './geo';

export type LocationFailure =
  | 'PERMISSION_DENIED'
  | 'SERVICES_DISABLED'
  | 'UNAVAILABLE'
  | 'TIMEOUT';

export type LocationResult =
  | { ok: true; coordinates: Coordinates; accuracy: number | null; timestamp: number }
  | { ok: false; failure: LocationFailure };

/**
 * Web browsers expose one-shot geolocation only. Background updates and
 * geofencing simply do not exist there, so callers must check this before
 * offering automatic attendance.
 */
export const supportsBackgroundLocation = Platform.OS !== 'web';

export async function ensureForegroundPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function getCurrentPosition(): Promise<LocationResult> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      const granted = await ensureForegroundPermission();
      if (!granted) return { ok: false, failure: 'PERMISSION_DENIED' };
    }

    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) return { ok: false, failure: 'SERVICES_DISABLED' };

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      ok: true,
      coordinates: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      },
      accuracy: position.coords.accuracy ?? null,
      timestamp: position.timestamp,
    };
  } catch {
    return { ok: false, failure: 'UNAVAILABLE' };
  }
}

export function failureMessageKey(failure: LocationFailure): string {
  switch (failure) {
    case 'PERMISSION_DENIED':
      return 'errors.locationPermission';
    case 'SERVICES_DISABLED':
      return 'errors.locationServicesOff';
    default:
      return 'errors.generic';
  }
}
