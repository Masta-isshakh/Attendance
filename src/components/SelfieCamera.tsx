import { useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Body, Button, Heading, LoadingScreen } from './ui';
import { palette, radius, spacing, typography } from '../theme';

/**
 * Front-facing selfie capture with a review step.
 *
 * `expo-camera`'s legacy `Camera` component was removed; SDK 57 uses
 * `CameraView` plus the `useCameraPermissions` hook.
 */
export function SelfieCamera({
  onCapture,
  onCancel,
  busy = false,
  busyLabel,
}: {
  onCapture: (uri: string) => void;
  onCancel?: () => void;
  busy?: boolean;
  busyLabel?: string;
}) {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [ready, setReady] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  if (!permission) return <LoadingScreen />;

  if (!permission.granted) {
    return (
      <View style={styles.permission}>
        <View style={styles.permissionIcon}>
          <Ionicons name="camera-outline" size={28} color={palette.brand} />
        </View>
        <Heading>{t('errors.cameraPermission')}</Heading>
        <Body muted center>
          {t('employee.selfieNoticeBody')}
        </Body>
        <Button label={t('employee.grantPermission')} onPress={() => void requestPermission()} />
        {onCancel ? <Button label={t('common.cancel')} onPress={onCancel} variant="ghost" /> : null}
      </View>
    );
  }

  async function takePicture() {
    // The shutter is disabled until onCameraReady fires: calling
    // takePictureAsync before the camera is mounted rejects, and an early tap
    // would otherwise look like a dead button.
    if (!cameraRef.current || capturing || !ready) return;

    setCapturing(true);
    setCaptureError(null);
    try {
      // No skipProcessing: on Android it returns un-rotated images and ignores
      // `quality`, which is the worst possible input for face comparison.
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (photo?.uri) {
        setPreview(photo.uri);
      } else {
        setCaptureError(t('errors.generic'));
      }
    } catch {
      setCaptureError(t('errors.generic'));
    } finally {
      setCapturing(false);
    }
  }

  if (preview) {
    return (
      <View style={styles.container}>
        <View style={styles.previewFrame}>
          <Image source={{ uri: preview }} style={styles.preview} />
        </View>
        <View style={styles.actions}>
          <Button
            label={busy ? (busyLabel ?? t('common.loading')) : t('employee.usePhoto')}
            onPress={() => onCapture(preview)}
            loading={busy}
          />
          <Button
            label={t('employee.retakeSelfie')}
            onPress={() => setPreview(null)}
            variant="secondary"
            disabled={busy}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.cameraFrame}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="front"
          onCameraReady={() => setReady(true)}
        />
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('employee.takeSelfie')}
          accessibilityState={{ disabled: capturing || !ready }}
          onPress={takePicture}
          disabled={capturing || !ready}
          style={({ pressed }) => [
            styles.shutter,
            (capturing || !ready) && styles.shutterDisabled,
            pressed && styles.shutterPressed,
          ]}
        >
          <View style={styles.shutterInner} />
        </Pressable>
        <Text style={styles.hint}>
          {captureError ?? (ready ? t('employee.takeSelfie') : t('common.loading'))}
        </Text>
        {onCancel ? <Button label={t('common.cancel')} onPress={onCancel} variant="ghost" /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.lg },
  cameraFrame: {
    flex: 1,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: palette.ink,
  },
  camera: { flex: 1 },
  previewFrame: {
    flex: 1,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: palette.ink,
  },
  preview: { flex: 1, transform: [{ scaleX: -1 }] },
  actions: { gap: spacing.md, alignItems: 'stretch' },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: palette.brand,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  shutterPressed: { opacity: 0.7 },
  shutterDisabled: { opacity: 0.4 },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.brand,
  },
  hint: { ...typography.caption, color: palette.muted, textAlign: 'center' },
  permission: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  permissionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
