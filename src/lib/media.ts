import { getUrl, remove, uploadData } from 'aws-amplify/storage';
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Selfies come off the camera at full sensor resolution — several megabytes.
 * Rekognition caps images at 15 MB and gains nothing above roughly 1080px, so
 * downscaling before upload makes check-in dramatically faster on mobile data
 * without hurting match accuracy.
 */
export async function compressImage(uri: string): Promise<string> {
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  context.resize({ width: 960 });
  const image = await context.renderAsync();
  const result = await image.saveAsync({
    compress: 0.7,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

async function uriToBlob(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  return response.blob();
}

/**
 * A storage path. For prefixes protected by `allow.entity('identity')` this
 * MUST be the callback form — Amplify only substitutes the caller's identity id
 * (and signs a request the IAM policy will accept) when the path is a function.
 * Passing a literal string that merely contains the id is rejected by S3 with
 * AccessDenied, because the SDK does not recognise it as an entity path.
 */
export type StoragePath = string | ((input: { identityId?: string }) => string);

export async function uploadImage(uri: string, path: StoragePath): Promise<string> {
  const compressed = await compressImage(uri);
  const blob = await uriToBlob(compressed);

  const operation = uploadData({
    path,
    data: blob,
    options: { contentType: 'image/jpeg' },
  });

  const result = await operation.result;
  return result.path;
}

export async function getImageUrl(key: string): Promise<string | null> {
  try {
    const result = await getUrl({ path: key, options: { expiresIn: 900 } });
    return result.url.toString();
  } catch {
    return null;
  }
}

export async function deleteImage(key: string): Promise<void> {
  try {
    await remove({ path: key });
  } catch {
    // A missing object is not an error worth surfacing.
  }
}

/**
 * Storage paths, as callbacks so Amplify fills in the caller's identity id and
 * signs the request the `allow.entity('identity')` policy will accept. The
 * resolved string is returned by `uploadImage` and stored on the record, so
 * later reads (which take a literal key) work unchanged.
 */
export const mediaPaths = {
  profilePhoto:
    () =>
    ({ identityId }: { identityId?: string }) =>
      `profile-photos/${identityId}/profile.jpg`,
  selfie:
    (stamp: string) =>
    ({ identityId }: { identityId?: string }) =>
      `selfies/${identityId}/${stamp}.jpg`,
  orgLogo:
    () =>
    ({ identityId }: { identityId?: string }) =>
      `org-logos/${identityId}/logo.jpg`,
};
