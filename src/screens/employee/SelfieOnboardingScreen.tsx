import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Body, Button, Display, ErrorBanner, Screen } from '../../components/ui';
import { SelfieCamera } from '../../components/SelfieCamera';
import { useSession } from '../../context/SessionContext';
import { client } from '../../lib/amplify';
import { extractServerMessage, toMessageKey } from '../../lib/errors';
import { mediaPaths, uploadImage } from '../../lib/media';
import { palette, spacing } from '../../theme';

/**
 * Shown once, on the employee's very first sign-in.
 *
 * The photo captured here becomes both their profile picture and the reference
 * image every future check-in is compared against, so it is taken deliberately
 * rather than pulled from the photo library.
 */
export function SelfieOnboardingScreen() {
  const { t } = useTranslation();
  const { employee, setEmployee, markFaceVerified, signOut } = useSession();

  const [showCamera, setShowCamera] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCapture(uri: string) {
    if (!employee) return;

    setSaving(true);
    setError(null);
    try {
      const key = await uploadImage(uri, mediaPaths.profilePhoto());

      const { data: updated, errors } = await client.models.Employee.update({
        id: employee.id,
        profilePhotoKey: key,
        hasCompletedFirstLogin: true,
      });

      // Amplify returns { data: null, errors } rather than throwing. Without
      // this branch a failed write left the employee on a spinner forever, on a
      // screen they cannot skip.
      if (errors?.length || !updated) {
        throw Object.assign(new Error('profile update failed'), { errors });
      }

      // The photo they just took is this session's verification — don't
      // immediately send them to the login selfie gate.
      markFaceVerified();
      setEmployee(updated);
    } catch (caught) {
      setError(extractServerMessage(caught) ?? t(toMessageKey(caught)));
      setShowCamera(false);
    } finally {
      setSaving(false);
    }
  }

  if (showCamera) {
    return (
      <Screen>
        <ErrorBanner message={error} />
        <SelfieCamera
          onCapture={handleCapture}
          onCancel={() => setShowCamera(false)}
          busy={saving}
          busyLabel={t('employee.savingPhoto')}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.icon}>
          <Ionicons name="camera" size={32} color={palette.brand} />
        </View>

        <Display>{t('employee.selfieNoticeTitle')}</Display>
        <Body muted>{t('employee.selfieNoticeBody')}</Body>

        <ErrorBanner message={error} />

        <View style={styles.actions}>
          <Button label={t('common.continue')} onPress={() => setShowCamera(true)} />
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
