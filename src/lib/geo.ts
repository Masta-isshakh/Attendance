/**
 * Geofence maths and the presence state machine.
 *
 * Deliberately pure and dependency-free so the rules can be reasoned about (and
 * unit-tested) without a device, a network, or a running app.
 */

export type Coordinates = { latitude: number; longitude: number };

const EARTH_RADIUS_METRES = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres. Accurate to well under a metre at the
 * hundred-metre scale this app cares about.
 */
export function distanceInMetres(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(a));
}

export function isWithinRadius(
  current: Coordinates,
  centre: Coordinates,
  radiusMetres: number,
): boolean {
  return distanceInMetres(current, centre) <= radiusMetres;
}

/**
 * How far outside the radius a reading must fall before we accept that someone
 * has actually left. Entry and exit deliberately use different thresholds:
 * without hysteresis, GPS jitter around the boundary flips an employee between
 * ACTIVE and INACTIVE every few minutes.
 */
const EXIT_HYSTERESIS_METRES = 25;

/**
 * Is the employee inside the geofence?
 *
 * GPS accuracy is a radius of uncertainty. An earlier version required the
 * *entire* uncertainty circle to sit inside the fence, which was unusable in
 * practice: with a 100 m radius and a typical 30-65 m urban accuracy it demanded
 * a distance near zero, and at accuracy >= radius it made check-in
 * mathematically impossible.
 *
 * Instead, give the employee the benefit of a bounded amount of doubt — capped
 * so a wildly imprecise reading can never wave someone in from far away.
 */
export function isConfidentlyInside(
  current: Coordinates,
  centre: Coordinates,
  radiusMetres: number,
  accuracyMetres: number | null | undefined,
): boolean {
  const distance = distanceInMetres(current, centre);
  const tolerance = Math.min(accuracyMetres ?? 0, radiusMetres * 0.5);
  return distance <= radiusMetres + tolerance;
}

/**
 * Has the employee genuinely left?
 *
 * Absence of proof of presence is not proof of absence, so exit requires
 * clearing the radius by a margin. Being merely "not confidently inside" is not
 * enough to mark somebody absent from work.
 */
export function isConfidentlyOutside(
  current: Coordinates,
  centre: Coordinates,
  radiusMetres: number,
  accuracyMetres: number | null | undefined,
): boolean {
  const distance = distanceInMetres(current, centre);
  const margin = Math.max(EXIT_HYSTERESIS_METRES, Math.min(accuracyMetres ?? 0, radiusMetres));
  return distance > radiusMetres + margin;
}

export type PresenceInputs = {
  /** Is the employee currently checked in at all? */
  isCheckedIn: boolean;
  /** Whether the admin enabled the "leaving the radius deactivates you" rule. */
  geofenceRuleEnabled: boolean;
  /** Most recent moment we saw them inside the radius. */
  lastSeenInsideAt: Date | null;
  /** How long a sighting stays trustworthy. */
  stalenessMinutes: number;
  /** Current instant, injected so this stays pure and testable. */
  now: Date;
  /** Latest reading, when one is available. */
  currentlyInside: boolean | null;
};

export type PresenceStatus = 'ACTIVE' | 'INACTIVE';

/**
 * The single place that decides ACTIVE vs INACTIVE.
 *
 * The two admin-configurable behaviours differ only after check-in:
 *
 *  - Rule ENABLED  -> presence tracks location. Leaving deactivates, returning
 *                     reactivates, with no further taps.
 *  - Rule DISABLED -> checking in "pins" the employee active for the whole
 *                     shift; only an explicit check-out ends it.
 *
 * Status is derived from a timestamped sighting rather than a boolean pushed by
 * the device, because OS geofence events are batched and can arrive minutes
 * late — and stop entirely if the app is force-killed. A stale sighting must
 * not be read as "still here".
 */
export function derivePresence(inputs: PresenceInputs): PresenceStatus {
  const {
    isCheckedIn,
    geofenceRuleEnabled,
    lastSeenInsideAt,
    stalenessMinutes,
    now,
    currentlyInside,
  } = inputs;

  // Not checked in: nothing to be active about, under either rule.
  if (!isCheckedIn) return 'INACTIVE';

  // Rule off: the check-in itself keeps them active until they check out.
  if (!geofenceRuleEnabled) return 'ACTIVE';

  // Rule on: trust a fresh reading above anything else.
  if (currentlyInside === true) return 'ACTIVE';
  if (currentlyInside === false) return 'INACTIVE';

  // No reading right now — fall back to how recently they were seen inside.
  if (!lastSeenInsideAt) return 'INACTIVE';
  const ageMinutes = (now.getTime() - lastSeenInsideAt.getTime()) / 60_000;
  return ageMinutes <= stalenessMinutes ? 'ACTIVE' : 'INACTIVE';
}

/** Human-friendly "seen 4 minutes ago", used instead of a fake live indicator. */
export function minutesSince(instant: Date | null, now: Date): number | null {
  if (!instant) return null;
  return Math.max(0, Math.floor((now.getTime() - instant.getTime()) / 60_000));
}

export const DEFAULT_RADIUS_METRES = 100;
export const DEFAULT_STALENESS_MINUTES = 15;
