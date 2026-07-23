import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import {
  CompareFacesCommand,
  InvalidParameterException,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { randomUUID } from 'node:crypto';
import type { Schema } from '../../data/resource';

const dynamo = new DynamoDBClient({});
const rekognition = new RekognitionClient({});

const SIMILARITY_THRESHOLD = 90;
const DEFAULT_RADIUS_METRES = 100;
const EARTH_RADIUS_METRES = 6_371_000;

/* -------------------------------------------------------------------------- */
/* Geometry — mirrors src/lib/geo.ts. Duplicated deliberately: this copy is the
/* authoritative one, because the client's copy runs on a device the employee
/* controls and can be modified.
/* -------------------------------------------------------------------------- */

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

function distanceInMetres(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude));
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(a));
}

/* -------------------------------------------------------------------------- */

const str = (value: AttributeValue | undefined) => value?.S;
const num = (value: AttributeValue | undefined) =>
  value?.N != null ? Number(value.N) : undefined;
const bool = (value: AttributeValue | undefined) => value?.BOOL === true;

type EmployeeItem = Record<string, AttributeValue>;
type OrganizationItem = Record<string, AttributeValue>;

async function findEmployeeBySub(tableName: string, sub: string): Promise<EmployeeItem | null> {
  const result = await dynamo.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': { S: sub } },
      Limit: 500,
    }),
  );
  return result.Items?.[0] ?? null;
}

async function getOrganization(
  tableName: string,
  organizationId: string,
): Promise<OrganizationItem | null> {
  const result = await dynamo.send(
    new GetItemCommand({
      TableName: tableName,
      Key: { organizationId: { S: organizationId } },
    }),
  );
  return result.Item ?? null;
}

async function findOpenRecord(
  tableName: string,
  sub: string,
): Promise<Record<string, AttributeValue> | null> {
  const result = await dynamo.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: '#userId = :userId AND attribute_not_exists(#checkOutAt)',
      ExpressionAttributeNames: { '#userId': 'userId', '#checkOutAt': 'checkOutAt' },
      ExpressionAttributeValues: { ':userId': { S: sub } },
      Limit: 500,
    }),
  );
  const items = result.Items ?? [];
  if (items.length === 0) return null;
  return items.sort((a, b) => ((str(a.checkInAt) ?? '') < (str(b.checkInAt) ?? '') ? 1 : -1))[0];
}

async function verifyFace(
  bucket: string,
  profilePhotoKey: string,
  selfieKey: string,
): Promise<{ matched: boolean; similarity: number; reason: string }> {
  if (!selfieKey.startsWith('selfies/')) {
    return { matched: false, similarity: 0, reason: 'INVALID_SELFIE' };
  }
  if (selfieKey === profilePhotoKey) {
    return { matched: false, similarity: 0, reason: 'INVALID_SELFIE' };
  }

  try {
    const result = await rekognition.send(
      new CompareFacesCommand({
        SourceImage: { S3Object: { Bucket: bucket, Name: profilePhotoKey } },
        TargetImage: { S3Object: { Bucket: bucket, Name: selfieKey } },
        SimilarityThreshold: SIMILARITY_THRESHOLD,
        QualityFilter: 'AUTO',
      }),
    );
    const best = (result.FaceMatches ?? []).reduce<number>(
      (highest, match) => Math.max(highest, match.Similarity ?? 0),
      0,
    );
    if (best >= SIMILARITY_THRESHOLD) {
      return { matched: true, similarity: best, reason: 'MATCH' };
    }
    if ((result.UnmatchedFaces ?? []).length > 0) {
      return { matched: false, similarity: best, reason: 'DIFFERENT_PERSON' };
    }
    return { matched: false, similarity: best, reason: 'NO_FACE_DETECTED' };
  } catch (error) {
    if (error instanceof InvalidParameterException) {
      return { matched: false, similarity: 0, reason: 'NO_FACE_DETECTED' };
    }
    throw error;
  }
}

function dayKeyFrom(date: Date, offsetMinutes: number): string {
  // The employee's local day, reconstructed from the offset their device
  // reported, so a shift starting at 23:30 is not filed under the next day.
  const local = new Date(date.getTime() - offsetMinutes * 60_000);
  const year = local.getUTCFullYear();
  const month = `${local.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${local.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type Args = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  selfieKey?: string | null;
  timezoneOffsetMinutes?: number | null;
};

export const handler: Schema['submitCheckIn']['functionHandler'] = async (event) => {
  const employeeTable = process.env.EMPLOYEE_TABLE_NAME;
  const organizationTable = process.env.ORGANIZATION_TABLE_NAME;
  const attendanceTable = process.env.ATTENDANCE_TABLE_NAME;
  const bucket = process.env.MEDIA_BUCKET_NAME;

  if (!employeeTable || !organizationTable || !attendanceTable || !bucket) {
    throw new Error('Attendance recorder is not fully configured.');
  }

  const identity = event.identity as { sub?: string } | null;
  const sub = identity?.sub;
  if (!sub) throw new Error('Unauthenticated.');

  // Amplify's resolver payload exposes `fieldName` at the top level, not under
  // `info` (there is no `info` property). Dispatch on that.
  const operation = (event as unknown as { fieldName: string }).fieldName;
  const args = event.arguments as unknown as Args;

  const employee = await findEmployeeBySub(employeeTable, sub);
  if (!employee) return { ok: false, reason: 'NO_EMPLOYEE_RECORD', similarity: 0, recordId: null };

  const organizationId = str(employee.organizationId);
  if (!organizationId) {
    return { ok: false, reason: 'NO_ORGANIZATION', similarity: 0, recordId: null };
  }

  const organization = await getOrganization(organizationTable, organizationId);
  if (!organization) {
    return { ok: false, reason: 'NO_ORGANIZATION', similarity: 0, recordId: null };
  }

  const centreLat = num(organization.latitude);
  const centreLng = num(organization.longitude);
  const radius = num(organization.radiusMeters) ?? DEFAULT_RADIUS_METRES;
  const mode = str(organization.attendanceMode) ?? 'MANUAL';

  const now = new Date();
  const nowIso = now.toISOString();
  const position = { latitude: args.latitude, longitude: args.longitude };

  let distance: number | null = null;
  if (centreLat != null && centreLng != null) {
    distance = distanceInMetres(position, { latitude: centreLat, longitude: centreLng });
  }

  /* ---------------------------------------------------------------------- */
  /* CHECK IN                                                                */
  /* ---------------------------------------------------------------------- */
  if (operation === 'submitCheckIn') {
    if (centreLat == null || centreLng == null) {
      return { ok: false, reason: 'NO_LOCATION_SET', similarity: 0, recordId: null };
    }

    // Server-side geofence. The device's own opinion is never trusted.
    const tolerance = Math.min(args.accuracy ?? 0, radius * 0.5);
    if ((distance ?? Number.POSITIVE_INFINITY) > radius + tolerance) {
      return { ok: false, reason: 'OUT_OF_RANGE', similarity: 0, recordId: null };
    }

    // One open shift at a time.
    const existing = await findOpenRecord(attendanceTable, sub);
    if (existing) {
      return { ok: true, reason: 'ALREADY_CHECKED_IN', similarity: 0, recordId: str(existing.id) ?? null };
    }

    let similarity = 0;
    if (mode !== 'AUTOMATIC') {
      const profilePhotoKey = str(employee.profilePhotoKey);
      if (!profilePhotoKey) {
        return { ok: false, reason: 'NO_PROFILE_PHOTO', similarity: 0, recordId: null };
      }
      if (!args.selfieKey) {
        return { ok: false, reason: 'SELFIE_REQUIRED', similarity: 0, recordId: null };
      }
      const verdict = await verifyFace(bucket, profilePhotoKey, args.selfieKey);
      if (!verdict.matched) {
        return { ok: false, reason: verdict.reason, similarity: verdict.similarity, recordId: null };
      }
      similarity = verdict.similarity;
    }

    const recordId = randomUUID();
    await dynamo.send(
      new PutItemCommand({
        TableName: attendanceTable,
        Item: {
          id: { S: recordId },
          __typename: { S: 'AttendanceRecord' },
          organizationId: { S: organizationId },
          memberGroup: { S: str(employee.memberGroup) ?? organizationId },
          adminGroup: { S: str(employee.adminGroup) ?? `${organizationId}_admin` },
          employeeId: { S: str(employee.id) ?? '' },
          userId: { S: sub },
          employeeUsername: { S: str(employee.username) ?? '' },
          checkInAt: { S: nowIso },
          checkInLatitude: { N: String(position.latitude) },
          checkInLongitude: { N: String(position.longitude) },
          method: { S: mode === 'AUTOMATIC' ? 'AUTOMATIC' : 'MANUAL' },
          checkInFaceSimilarity: { N: String(similarity) },
          lastSeenInsideAt: { S: nowIso },
          dayKey: { S: dayKeyFrom(now, args.timezoneOffsetMinutes ?? 0) },
          createdAt: { S: nowIso },
          updatedAt: { S: nowIso },
        },
      }),
    );

    await dynamo.send(
      new UpdateItemCommand({
        TableName: employeeTable,
        Key: { id: { S: str(employee.id) ?? '' } },
        UpdateExpression:
          'SET #status = :status, #isCheckedIn = :true, #lastSeenInsideAt = :now, #lastKnownLatitude = :lat, #lastKnownLongitude = :lng, #lastStatusChangeAt = :now, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#isCheckedIn': 'isCheckedIn',
          '#lastSeenInsideAt': 'lastSeenInsideAt',
          '#lastKnownLatitude': 'lastKnownLatitude',
          '#lastKnownLongitude': 'lastKnownLongitude',
          '#lastStatusChangeAt': 'lastStatusChangeAt',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':status': { S: 'ACTIVE' },
          ':true': { BOOL: true },
          ':now': { S: nowIso },
          ':lat': { N: String(position.latitude) },
          ':lng': { N: String(position.longitude) },
        },
      }),
    );

    return { ok: true, reason: 'CHECKED_IN', similarity, recordId };
  }

  /* ---------------------------------------------------------------------- */
  /* CHECK OUT                                                               */
  /* ---------------------------------------------------------------------- */
  if (operation === 'submitCheckOut') {
    const open = await findOpenRecord(attendanceTable, sub);

    // No open shift: repair the flag rather than leaving a Check Out button
    // that can never succeed.
    if (!open) {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: employeeTable,
          Key: { id: { S: str(employee.id) ?? '' } },
          UpdateExpression:
            'SET #status = :inactive, #isCheckedIn = :false, #updatedAt = :now',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#isCheckedIn': 'isCheckedIn',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':inactive': { S: 'INACTIVE' },
            ':false': { BOOL: false },
            ':now': { S: nowIso },
          },
        }),
      );
      return { ok: true, reason: 'NO_OPEN_SHIFT', similarity: 0, recordId: null };
    }

    let similarity = 0;
    if (mode !== 'AUTOMATIC') {
      const profilePhotoKey = str(employee.profilePhotoKey);
      if (profilePhotoKey && args.selfieKey) {
        const verdict = await verifyFace(bucket, profilePhotoKey, args.selfieKey);
        if (!verdict.matched) {
          return {
            ok: false,
            reason: verdict.reason,
            similarity: verdict.similarity,
            recordId: null,
          };
        }
        similarity = verdict.similarity;
      } else if (!args.selfieKey) {
        return { ok: false, reason: 'SELFIE_REQUIRED', similarity: 0, recordId: null };
      }
    }

    const startedAt = new Date(str(open.checkInAt) ?? nowIso);
    const seconds = Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000));

    await dynamo.send(
      new UpdateItemCommand({
        TableName: attendanceTable,
        Key: { id: { S: str(open.id) ?? '' } },
        UpdateExpression:
          'SET #checkOutAt = :now, #checkOutLatitude = :lat, #checkOutLongitude = :lng, #checkOutFaceSimilarity = :similarity, #totalSecondsPresent = :seconds, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#checkOutAt': 'checkOutAt',
          '#checkOutLatitude': 'checkOutLatitude',
          '#checkOutLongitude': 'checkOutLongitude',
          '#checkOutFaceSimilarity': 'checkOutFaceSimilarity',
          '#totalSecondsPresent': 'totalSecondsPresent',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':now': { S: nowIso },
          ':lat': { N: String(position.latitude) },
          ':lng': { N: String(position.longitude) },
          ':similarity': { N: String(similarity) },
          ':seconds': { N: String(seconds) },
        },
      }),
    );

    await dynamo.send(
      new UpdateItemCommand({
        TableName: employeeTable,
        Key: { id: { S: str(employee.id) ?? '' } },
        UpdateExpression:
          'SET #status = :inactive, #isCheckedIn = :false, #lastStatusChangeAt = :now, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#isCheckedIn': 'isCheckedIn',
          '#lastStatusChangeAt': 'lastStatusChangeAt',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':inactive': { S: 'INACTIVE' },
          ':false': { BOOL: false },
          ':now': { S: nowIso },
        },
      }),
    );

    return { ok: true, reason: 'CHECKED_OUT', similarity, recordId: str(open.id) ?? null };
  }

  /* ---------------------------------------------------------------------- */
  /* PRESENCE PING — background geofence updates                             */
  /* ---------------------------------------------------------------------- */
  if (operation === 'submitPresencePing') {
    if (centreLat == null || centreLng == null || distance == null) {
      return { ok: false, reason: 'NO_LOCATION_SET', similarity: 0, recordId: null };
    }

    const geofenceRuleEnabled = organization.geofenceRuleEnabled
      ? bool(organization.geofenceRuleEnabled)
      : true;
    const isCheckedIn = bool(employee.isCheckedIn);

    const tolerance = Math.min(args.accuracy ?? 0, radius * 0.5);
    const inside = distance <= radius + tolerance;
    const exitMargin = Math.max(25, Math.min(args.accuracy ?? 0, radius));
    const outside = distance > radius + exitMargin;

    // With the rule off, a check-in pins the employee active until they check
    // out — location is irrelevant.
    let status: 'ACTIVE' | 'INACTIVE';
    if (!isCheckedIn) {
      status = 'INACTIVE';
    } else if (!geofenceRuleEnabled) {
      status = 'ACTIVE';
    } else if (inside) {
      status = 'ACTIVE';
    } else if (outside) {
      status = 'INACTIVE';
    } else {
      status = (str(employee.status) as 'ACTIVE' | 'INACTIVE') ?? 'INACTIVE';
    }

    await dynamo.send(
      new UpdateItemCommand({
        TableName: employeeTable,
        Key: { id: { S: str(employee.id) ?? '' } },
        UpdateExpression: inside
          ? 'SET #status = :status, #lastKnownLatitude = :lat, #lastKnownLongitude = :lng, #lastSeenInsideAt = :now, #updatedAt = :now'
          : 'SET #status = :status, #lastKnownLatitude = :lat, #lastKnownLongitude = :lng, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#lastKnownLatitude': 'lastKnownLatitude',
          '#lastKnownLongitude': 'lastKnownLongitude',
          '#updatedAt': 'updatedAt',
          ...(inside ? { '#lastSeenInsideAt': 'lastSeenInsideAt' } : {}),
        },
        ExpressionAttributeValues: {
          ':status': { S: status },
          ':lat': { N: String(position.latitude) },
          ':lng': { N: String(position.longitude) },
          ':now': { S: nowIso },
        },
      }),
    );

    return { ok: true, reason: status, similarity: 0, recordId: null };
  }

  throw new Error(`Unsupported operation: ${operation}`);
};
