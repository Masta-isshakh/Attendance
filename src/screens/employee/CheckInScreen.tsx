import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import { Body, Button, Display, ErrorBanner, LoadingScreen, Screen } from '../../components/ui';
import { SelfieCamera } from '../../components/SelfieCamera';
import { useSession } from '../../context/SessionContext';
import { client } from '../../lib/amplify';
import {
  checkRange,
  performCheckIn,
  performCheckOut,
  radiusOf,
} from '../../lib/attendance';
import { extractServerMessage, toMessageKey } from '../../lib/errors';
import type { Coordinates } from '../../lib/geo';
import { failureMessageKey, getCurrentPosition } from '../../lib/location';
import { deleteImage, mediaPaths, uploadImage } from '../../lib/media';
import { palette, spacing } from '../../theme';

type Phase = 'LOCATING' | 'CAMERA' | 'SUBMITTING' | 'BLOCKED' | 'DONE';

/** Server rejection codes → something a person can act on. */
function reasonToMessage(reason: string, t: TFunction): string {
  switch (reason) {
    case 'OUT_OF_RANGE':
      return t('errors.outsideRadiusSimple');
    case 'NO_FACE_DETECTED':
      return t('errors.faceNotDetected');
    case 'DIFFERENT_PERSON':
    case 'INVALID_SELFIE':
      return t('errors.faceNoMatch');
    case 'NO_PROFILE_PHOTO':
      return t('errors.noProfilePhoto');
    case 'NO_LOCATION_SET':
      return t('admin.locationNotSetBody');
    case 'NO_EMPLOYEE_RECORD':
    case 'NO_ORGANIZATION':
      return t('errors.noOrganization');
    default:
      return t('errors.generic');
  }
}

/**
 * Manual check-in / check-out.
 *
 * The location check here is only for fast, friendly feedback — the server
 * re-derives the distance from the organization's stored coordinates and re-runs
 * the face comparison before writing anything. The client has no write access
 * to attendance at all, so a rejection from the server is final.
 */
export function CheckInScreen({
  mode,
  onClose,
}: {
  mode: 'IN' | 'OUT';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { employee, organization, setEmployee } = useSession();

  const [phase, setPhase] = useState<Phase>('LOCATING');
  const [position, setPosition] = useState<Coordinates | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const committedRef = useRef(false);

  const requiresFace = organization?.attendanceMode !== 'AUTOMATIC';

  const verifyLocation = useCallback(async () => {
    if (!organization) return;

    setPhase('LOCATING');
    setError(null);

    const result = await getCurrentPosition();
    if (!result.ok) {
      setError(t(failureMessageKey(result.failure)));
      setPhase('BLOCKED');
      return;
    }

    // Only CHECK-IN is gated on the radius. Gating check-out would trap anyone
    // who left the office without checking out.
    if (mode === 'IN') {
      const range = checkRange(organization, result.coordinates, result.accuracy);
      if (!range.inside) {
        setError(
          range.reason === 'NO_LOCATION_SET'
            ? t('admin.locationNotSetBody')
            : t('errors.outsideRadius', {
                distance: range.distance,
                organization: organization.name,
                radius: radiusOf(organization),
              }),
        );
        setPhase('BLOCKED');
        return;
      }
    }

    setPosition(result.coordinates);
    setAccuracy(result.accuracy);
    setPhase(requiresFace ? 'CAMERA' : 'SUBMITTING');
  }, [organization, requiresFace, mode, t]);

  useEffect(() => {
    void verifyLocation();
  }, [verifyLocation]);

  const submit = useCallback(
    async (selfieKey: string | null, currentPosition: Coordinates, currentAccuracy: number | null) => {
      if (!employee) return;

      // A second submit from a re-render or double tap would open a second
      // shift and corrupt the hours worked.
      if (committedRef.current) return;
      committedRef.current = true;

      setPhase('SUBMITTING');
      try {
        const outcome =
          mode === 'IN'
            ? await performCheckIn({
                position: currentPosition,
                accuracy: currentAccuracy,
                selfieKey,
              })
            : await performCheckOut({
                position: currentPosition,
                accuracy: currentAccuracy,
                selfieKey,
              });

        if (!outcome.ok) {
          committedRef.current = false;
          if (selfieKey) await deleteImage(selfieKey);
          setError(reasonToMessage(outcome.reason, t));
          setPhase(requiresFace ? 'CAMERA' : 'BLOCKED');
          return;
        }

        const { data: refreshed } = await client.models.Employee.get({ id: employee.id });
        if (refreshed) setEmployee(refreshed);

        setPhase('DONE');
        onClose();
      } catch (caught) {
        committedRef.current = false;
        setError(extractServerMessage(caught) ?? t(toMessageKey(caught)));
        setPhase('BLOCKED');
      }
    },
    [employee, mode, requiresFace, setEmployee, onClose, t],
  );

  // Automatic mode has no camera step, so submit as soon as location resolves.
  useEffect(() => {
    if (phase === 'SUBMITTING' && !requiresFace && position && !committedRef.current) {
      void submit(null, position, accuracy);
    }
  }, [phase, requiresFace, position, accuracy, submit]);

  async function handleSelfie(uri: string) {
    if (!position) return;

    setPhase('SUBMITTING');
    setError(null);

    try {
      const key = await uploadImage(
        uri,
        mediaPaths.selfie(`${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`),
      );
      await submit(key, position, accuracy);
    } catch (caught) {
      setError(extractServerMessage(caught) ?? t(toMessageKey(caught)));
      setPhase('CAMERA');
    }
  }

  if (phase === 'LOCATING') {
    return <LoadingScreen message={t('employee.checkingLocation')} />;
  }

  if (phase === 'SUBMITTING' || phase === 'DONE') {
    return (
      <LoadingScreen
        message={mode === 'IN' ? t('employee.checkingIn') : t('employee.checkingOut')}
      />
    );
  }

  if (phase === 'BLOCKED') {
    return (
      <Screen>
        <View style={styles.blocked}>
          <View style={styles.icon}>
            <Ionicons name="alert-circle-outline" size={30} color={palette.danger} />
          </View>
          <Display>{mode === 'IN' ? t('employee.checkIn') : t('employee.checkOut')}</Display>
          <Body muted>{error ?? t('errors.generic')}</Body>
          <View style={styles.actions}>
            <Button label={t('common.retry')} onPress={() => void verifyLocation()} />
            <Button label={t('common.cancel')} onPress={onClose} variant="ghost" />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ErrorBanner message={error} />
      <SelfieCamera onCapture={handleSelfie} onCancel={onClose} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  blocked: { flex: 1, justifyContent: 'center', gap: spacing.md },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  actions: { gap: spacing.sm, marginTop: spacing.xl },
});
