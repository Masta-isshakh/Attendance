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

export async function uploadImage(uri: string, key: string): Promise<string> {
  const compressed = await compressImage(uri);
  const blob = await uriToBlob(compressed);

  const operation = uploadData({
    path: key,
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
 * Storage paths.
 *
 * `{entity_id}` in the access rules resolves to the caller's identity id, so
 * these helpers must produce paths under that same prefix for the rules to
 * grant access.
 */
export const mediaPaths = {
  profilePhoto: (identityId: string) =>
    `profile-photos/${identityId}/profile.jpg`,
  selfie: (identityId: string, stamp: string) =>
    `selfies/${identityId}/${stamp}.jpg`,
  orgLogo: (identityId: string) => `org-logos/${identityId}/logo.jpg`,
};
