import { fetchAuthSession } from 'aws-amplify/auth';
import { client, type AttendanceRecordType, type EmployeeRecord, type OrganizationRecord } from './amplify';
import {
  DEFAULT_RADIUS_METRES,
  DEFAULT_STALENESS_MINUTES,
  derivePresence,
  distanceInMetres,
  isConfidentlyInside,
  isConfidentlyOutside,
  type Coordinates,
} from './geo';

export function dayKeyFor(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function currentIdentityId(): Promise<string> {
  const session = await fetchAuthSession();
  const identityId = session.identityId;
  if (!identityId) throw new Error('No identity id on the session');
  return identityId;
}

export function organizationCentre(organization: OrganizationRecord): Coordinates | null {
  if (organization.latitude == null || organization.longitude == null) return null;
  return { latitude: organization.latitude, longitude: organization.longitude };
}

export function radiusOf(organization: OrganizationRecord): number {
  return organization.radiusMeters ?? DEFAULT_RADIUS_METRES;
}

export function stalenessOf(organization: OrganizationRecord): number {
  return organization.presenceStalenessMinutes ?? DEFAULT_STALENESS_MINUTES;
}

export type RangeCheck =
  | { inside: true; distance: number }
  | { inside: false; distance: number; reason: 'OUT_OF_RANGE' }
  | { inside: false; distance: null; reason: 'NO_LOCATION_SET' };

export function checkRange(
  organization: OrganizationRecord,
  position: Coordinates,
  accuracy: number | null,
): RangeCheck {
  const centre = organizationCentre(organization);
  if (!centre) return { inside: false, distance: null, reason: 'NO_LOCATION_SET' };

  const radius = radiusOf(organization);
  const distance = Math.round(distanceInMetres(position, centre));

  if (isConfidentlyInside(position, centre, radius, accuracy)) {
    return { inside: true, distance };
  }
  return { inside: false, distance, reason: 'OUT_OF_RANGE' };
}

/**
 * AppSync applies `limit` as the DynamoDB page size and the `filter` only
 * afterwards, so a filtered `list` with a small limit routinely returns an empty
 * page while matching rows sit further along. Every filtered read must follow
 * `nextToken` or it silently loses data as the table grows.
 */
export async function listAllPages<T>(
  fetchPage: (nextToken?: string) => Promise<{ data: T[] | null; nextToken?: string | null }>,
  maxPages = 20,
): Promise<T[]> {
  const collected: T[] = [];
  let token: string | undefined;
  let pages = 0;

  do {
    const page = await fetchPage(token);
    if (page.data) collected.push(...page.data);
    token = page.nextToken ?? undefined;
    pages += 1;
  } while (token && pages < maxPages);

  return collected;
}

/** The employee's currently-open shift, if any. */
export async function findOpenRecord(
  employee: EmployeeRecord,
): Promise<AttendanceRecordType | null> {
  const records = await listAllPages<AttendanceRecordType>((nextToken) =>
    client.models.AttendanceRecord.list({
      filter: {
        userId: { eq: employee.userId },
        checkOutAt: { attributeExists: false },
      },
      limit: 200,
      nextToken,
    }),
  );

  if (records.length === 0) return null;

  // Most recent first — a stale open record must never shadow a newer one.
  return [...records].sort((a, b) => (a.checkInAt < b.checkInAt ? 1 : -1))[0] ?? null;
}

export async function listRecentRecords(
  employee: EmployeeRecord,
  limit = 60,
): Promise<AttendanceRecordType[]> {
  const records = await listAllPages<AttendanceRecordType>((nextToken) =>
    client.models.AttendanceRecord.list({
      filter: { userId: { eq: employee.userId } },
      limit: 200,
      nextToken,
    }),
  );
  return [...records]
    .sort((a, b) => (a.checkInAt < b.checkInAt ? 1 : -1))
    .slice(0, limit);
}

export async function listOrganizationRecords(
  organizationId: string,
  limit = 400,
): Promise<AttendanceRecordType[]> {
  const records = await listAllPages<AttendanceRecordType>((nextToken) =>
    client.models.AttendanceRecord.list({
      filter: { organizationId: { eq: organizationId } },
      limit: 200,
      nextToken,
    }),
  );
  return [...records]
    .sort((a, b) => (a.checkInAt < b.checkInAt ? 1 : -1))
    .slice(0, limit);
}

export type AttendanceOutcome = {
  ok: boolean;
  reason: string;
  similarity: number;
  recordId: string | null;
};

/**
 * Check-in and check-out are performed by a Lambda, not written from here.
 *
 * The device reports where it thinks it is and which selfie it took; the server
 * independently re-derives the distance from the organization's stored
 * coordinates and re-runs the face comparison against the employee's stored
 * profile photo. Nothing the client asserts is taken on trust — the client no
 * longer has write access to AttendanceRecord at all.
 */
export async function performCheckIn({
  position,
  accuracy,
  selfieKey,
}: {
  position: Coordinates;
  accuracy: number | null;
  selfieKey: string | null;
}): Promise<AttendanceOutcome> {
  const { data, errors } = await client.mutations.submitCheckIn({
    latitude: position.latitude,
    longitude: position.longitude,
    accuracy,
    selfieKey,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  });

  if (errors?.length || !data) {
    throw Object.assign(new Error('check-in failed'), { errors });
  }
  return {
    ok: data.ok,
    reason: data.reason,
    similarity: data.similarity ?? 0,
    recordId: data.recordId ?? null,
  };
}

export async function performCheckOut({
  position,
  accuracy,
  selfieKey,
}: {
  position: Coordinates;
  accuracy: number | null;
  selfieKey: string | null;
}): Promise<AttendanceOutcome> {
  const { data, errors } = await client.mutations.submitCheckOut({
    latitude: position.latitude,
    longitude: position.longitude,
    accuracy,
    selfieKey,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  });

  if (errors?.length || !data) {
    throw Object.assign(new Error('check-out failed'), { errors });
  }
  return {
    ok: data.ok,
    reason: data.reason,
    similarity: data.similarity ?? 0,
    recordId: data.recordId ?? null,
  };
}

/**
 * Reports a location sighting. The server re-derives ACTIVE/INACTIVE from it —
 * the device never asserts its own status.
 */
export async function recordPresencePing({
  position,
  accuracy,
}: {
  position: Coordinates;
  accuracy: number | null;
}): Promise<'ACTIVE' | 'INACTIVE' | null> {
  const { data } = await client.mutations.submitPresencePing({
    latitude: position.latitude,
    longitude: position.longitude,
    accuracy,
  });
  if (!data?.ok) return null;
  return data.reason === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
}

/**
 * Repairs the state where `isCheckedIn` is true but no open record exists — for
 * example if a check-out write half-failed. Without this the employee is stuck
 * with a Check Out button that can never succeed.
 */
export async function clearCheckedInFlag(employee: EmployeeRecord): Promise<void> {
  await client.models.Employee.update({
    id: employee.id,
    isCheckedIn: false,
    status: 'INACTIVE',
    lastStatusChangeAt: new Date().toISOString(),
  });
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function secondsBetween(record: AttendanceRecordType, now: Date): number {
  const start = new Date(record.checkInAt).getTime();
  const end = record.checkOutAt ? new Date(record.checkOutAt).getTime() : now.getTime();
  return Math.max(0, Math.round((end - start) / 1000));
}
