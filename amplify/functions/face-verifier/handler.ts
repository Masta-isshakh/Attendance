import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import {
  CompareFacesCommand,
  InvalidParameterException,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import type { Schema } from '../../data/resource';

const rekognition = new RekognitionClient({});
const dynamo = new DynamoDBClient({});

/**
 * Similarity below this is treated as a different person. 90 is deliberately
 * strict: a false accept lets someone check in for a colleague, which is the
 * exact fraud this feature exists to prevent. A false reject only costs the
 * employee a retry.
 */
const SIMILARITY_THRESHOLD = 90;

export const handler: Schema['verifyFace']['functionHandler'] = async (event) => {
  const bucket = process.env.MEDIA_BUCKET_NAME;
  const tableName = process.env.EMPLOYEE_TABLE_NAME;
  if (!bucket) throw new Error('MEDIA_BUCKET_NAME is not configured');
  if (!tableName) throw new Error('EMPLOYEE_TABLE_NAME is not configured');

  const identity = event.identity as { sub?: string; username?: string } | null;
  const callerSub = identity?.sub;
  if (!callerSub) throw new Error('Unauthenticated.');

  const { selfieKey } = event.arguments;
  if (!selfieKey) throw new Error('selfieKey is required.');

  // The selfie must live under the caller's own storage prefix. Without this a
  // caller could point at somebody else's stored image.
  if (!selfieKey.startsWith('selfies/')) {
    throw new Error('Invalid selfie reference.');
  }

  // The reference photo is resolved from the CALLER'S OWN record. If the client
  // supplied it, passing the same key as both source and target would score a
  // trivial 100% match and defeat the whole check.
  const found = await dynamo.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': { S: callerSub } },
      Limit: 200,
    }),
  );

  const profilePhotoKey = found.Items?.[0]?.profilePhotoKey?.S;
  if (!profilePhotoKey) {
    return { matched: false, similarity: 0, reason: 'NO_PROFILE_PHOTO' };
  }

  // A selfie and its reference must never be the same object.
  if (profilePhotoKey === selfieKey) {
    throw new Error('Invalid selfie reference.');
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

    // Rekognition found a face, but it is not the same person.
    if ((result.UnmatchedFaces ?? []).length > 0) {
      return { matched: false, similarity: best, reason: 'DIFFERENT_PERSON' };
    }

    return { matched: false, similarity: best, reason: 'NO_FACE_DETECTED' };
  } catch (error) {
    // Raised when an image contains no detectable face at all, which is normal
    // user error (bad lighting, covered camera), not a fault.
    if (error instanceof InvalidParameterException) {
      return { matched: false, similarity: 0, reason: 'NO_FACE_DETECTED' };
    }
    throw error;
  }
};
