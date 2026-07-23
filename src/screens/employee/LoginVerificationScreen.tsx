import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Body, Button, Display, ErrorBanner, LoadingScreen, Screen } from '../../components/ui';
import { SelfieCamera } from '../../components/SelfieCamera';
import { useSession } from '../../context/SessionContext';
import { client } from '../../lib/amplify';
import { extractServerMessage, toMessageKey } from '../../lib/errors';
import { deleteImage, mediaPaths, uploadImage } from '../../lib/media';
import { palette, spacing } from '../../theme';

/**
 * Identity gate shown on every login / app launch (after the one-time
 * onboarding). The employee takes a live selfie which is matched server-side
 * against their stored profile photo; only a match lets them into the app.
 *
 * This is where face verification happens — check-in itself then only needs to
 * confirm location.
 */
export function LoginVerificationScreen() {
  const { t } = useTranslation();
  const { employee, markFaceVerified, signOut } = useSession();

  const [showCamera, setShowCamera] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelfie(uri: string) {
    if (!employee) return;

    setVerifying(true);
    setError(null);

    let selfieKey: string | null = null;
    try {
      selfieKey = await uploadImage(
        uri,
        mediaPaths.selfie(`login-${new Date().toISOString().replace(/[:.]/g, '-')}`),
      );

      const { data: verdict, errors } = await client.mutations.verifyFace({ selfieKey });
      if (errors?.length || !verdict) {
        throw Object.assign(new Error('verification failed'), { errors });
      }

      if (verdict.matched) {
        // The selfie is not attendance evidence — discard it once matched.
        await deleteImage(selfieKey);
        markFaceVerified();
        return;
      }

      await deleteImage(selfieKey);
      setError(
        verdict.reason === 'NO_FACE_DETECTED'
          ? t('errors.faceNotDetected')
          : verdict.reason === 'NO_PROFILE_PHOTO'
            ? t('errors.noProfilePhoto')
            : t('errors.faceNoMatch'),
      );
      setVerifying(false);
    } catch (caught) {
      if (selfieKey) await deleteImage(selfieKey);
      setError(extractServerMessage(caught) ?? t(toMessageKey(caught)));
      setVerifying(false);
    }
  }

  if (verifying) {
    return <LoadingScreen message={t('employee.verifyingFace')} />;
  }

  if (showCamera) {
    return (
      <Screen>
        <ErrorBanner message={error} />
        <SelfieCamera onCapture={handleSelfie} onCancel={() => setShowCamera(false)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.icon}>
          <Ionicons name="scan-outline" size={32} color={palette.brand} />
        </View>

        <Display>{t('employee.verifyTitle')}</Display>
        <Body muted>{t('employee.verifyBody')}</Body>

        <ErrorBanner message={error} />

        <View style={styles.actions}>
          <Button label={t('employee.takeSelfie')} onPress={() => setShowCamera(true)} />
          <Button label={t('auth.signOut')} onPress={() => void signOut()} variant="ghost" />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', gap: spacing.md },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: palette.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  actions: { gap: spacing.sm, marginTop: spacing.xl },
});
