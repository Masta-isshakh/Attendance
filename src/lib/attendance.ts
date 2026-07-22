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

export type CheckInInput = {
  employee: EmployeeRecord;
  organization: OrganizationRecord;
  position: Coordinates;
  method: 'MANUAL' | 'AUTOMATIC';
  faceSimilarity?: number | null;
};

export async function performCheckIn({
  employee,
  organization,
  position,
  method,
  faceSimilarity,
}: CheckInInput): Promise<AttendanceRecordType | null> {
  const now = new Date();

  const { data: record } = await client.models.AttendanceRecord.create({
    organizationId: organization.organizationId,
    memberGroup: organization.memberGroup,
    adminGroup: organization.adminGroup,
    employeeId: employee.id,
    userId: employee.userId,
    employeeUsername: employee.username,
    checkInAt: now.toISOString(),
    checkInLatitude: position.latitude,
    checkInLongitude: position.longitude,
    method,
    checkInFaceSimilarity: faceSimilarity ?? null,
    lastSeenInsideAt: now.toISOString(),
    dayKey: dayKeyFor(now),
  });

  await client.models.Employee.update({
    id: employee.id,
    isCheckedIn: true,
    status: 'ACTIVE',
    lastSeenInsideAt: now.toISOString(),
    lastKnownLatitude: position.latitude,
    lastKnownLongitude: position.longitude,
    lastStatusChangeAt: now.toISOString(),
  });

  return record ?? null;
}

export async function performCheckOut({
  employee,
  openRecord,
  position,
  method,
  faceSimilarity,
}: {
  employee: EmployeeRecord;
  openRecord: AttendanceRecordType;
  position: Coordinates | null;
  method: 'MANUAL' | 'AUTOMATIC';
  faceSimilarity?: number | null;
}): Promise<void> {
  const now = new Date();
  const startedAt = new Date(openRecord.checkInAt);
  const seconds = Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000));

  await client.models.AttendanceRecord.update({
    id: openRecord.id,
    checkOutAt: now.toISOString(),
    checkOutLatitude: position?.latitude ?? null,
    checkOutLongitude: position?.longitude ?? null,
    checkOutFaceSimilarity: faceSimilarity ?? null,
    totalSecondsPresent: seconds,
  });

  await client.models.Employee.update({
    id: employee.id,
    isCheckedIn: false,
    status: 'INACTIVE',
    lastStatusChangeAt: now.toISOString(),
    ...(position
      ? { lastKnownLatitude: position.latitude, lastKnownLongitude: position.longitude }
      : {}),
  });
  void method;
}

/**
 * Records a location sighting and re-derives ACTIVE/INACTIVE from it.
 *
 * This is the only path that changes status while a shift is open, so the two
 * geofence-rule behaviours live in exactly one place (`derivePresence`).
 */
export async function recordPresencePing({
  employee,
  organization,
  position,
  accuracy,
}: {
  employee: EmployeeRecord;
  organization: OrganizationRecord;
  position: Coordinates;
  accuracy: number | null;
}): Promise<'ACTIVE' | 'INACTIVE'> {
  const now = new Date();
  const centre = organizationCentre(organization);
  if (!centre) return (employee.status as 'ACTIVE' | 'INACTIVE') ?? 'INACTIVE';

  const inside = isConfidentlyInside(position, centre, radiusOf(organization), accuracy);

  // Marking someone absent needs stronger evidence than marking them present:
  // "not confidently inside" is not the same as "confidently outside", and
  // treating it as such flips people to INACTIVE on GPS jitter alone.
  const outside = isConfidentlyOutside(position, centre, radiusOf(organization), accuracy);
  const currentlyInside = inside ? true : outside ? false : null;

  const lastSeenInside = inside
    ? now
    : employee.lastSeenInsideAt
      ? new Date(employee.lastSeenInsideAt)
      : null;

  const status = derivePresence({
    isCheckedIn: Boolean(employee.isCheckedIn),
    geofenceRuleEnabled: organization.geofenceRuleEnabled ?? true,
    lastSeenInsideAt: lastSeenInside,
    stalenessMinutes: stalenessOf(organization),
    now,
    currentlyInside,
  });

  await client.models.Employee.update({
    id: employee.id,
    status,
    lastKnownLatitude: position.latitude,
    lastKnownLongitude: position.longitude,
    ...(inside ? { lastSeenInsideAt: now.toISOString() } : {}),
    ...(status !== employee.status ? { lastStatusChangeAt: now.toISOString() } : {}),
  });

  return status;
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
