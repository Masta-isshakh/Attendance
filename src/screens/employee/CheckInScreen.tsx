import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  Body,
  Button,
  Display,
  ErrorBanner,
  LoadingScreen,
  Screen,
} from '../../components/ui';
import { SelfieCamera } from '../../components/SelfieCamera';
import { useSession } from '../../context/SessionContext';
import { client } from '../../lib/amplify';
import {
  checkRange,
  clearCheckedInFlag,
  currentIdentityId,
  findOpenRecord,
  performCheckIn,
  performCheckOut,
  radiusOf,
} from '../../lib/attendance';
import { extractServerMessage, toMessageKey } from '../../lib/errors';
import type { Coordinates } from '../../lib/geo';
import { failureMessageKey, getCurrentPosition } from '../../lib/location';
import { mediaPaths, deleteImage, uploadImage } from '../../lib/media';
import { palette, spacing } from '../../theme';

type Phase = 'LOCATING' | 'CAMERA' | 'VERIFYING' | 'SAVING' | 'BLOCKED' | 'DONE';

/**
 * Manual check-in / check-out.
 *
 * Order is deliberate: location is verified *before* the camera opens, so an
 * employee who is nowhere near the office is never asked for a selfie they
 * cannot use.
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

    // Only CHECK-IN is gated on being inside the radius. Gating check-out too
    // would trap anyone who left the office without checking out — including
    // every employee under the "stay active until you check out" rule, which
    // exists precisely so people can leave the area while on the clock.
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
    // Automatic mode skips face verification entirely — there is no selfie.
    setPhase(requiresFace ? 'CAMERA' : 'SAVING');
  }, [organization, requiresFace, t]);

  useEffect(() => {
    void verifyLocation();
  }, [verifyLocation]);

  const commit = useCallback(
    async (similarity: number | null) => {
      if (!employee || !organization || !position) return;

      // Guard against a second commit from a re-render or a double tap: two
      // check-ins would open two shifts and corrupt the hours worked.
      if (committedRef.current) return;
      committedRef.current = true;

      setPhase('SAVING');
      try {
        if (mode === 'IN') {
          // Defensive: if a shift is somehow already open, close nothing and
          // do not open a second one.
          const existing = await findOpenRecord(employee);
          if (existing) {
            const { data: refreshedEmployee } = await client.models.Employee.get({
              id: employee.id,
            });
            if (refreshedEmployee) setEmployee(refreshedEmployee);
            setPhase('DONE');
            onClose();
            return;
          }

          await performCheckIn({
            employee,
            organization,
            position,
            method: requiresFace ? 'MANUAL' : 'AUTOMATIC',
            faceSimilarity: similarity,
          });
        } else {
          const openRecord = await findOpenRecord(employee);
          if (openRecord) {
            await performCheckOut({
              employee,
              openRecord,
              position,
              method: requiresFace ? 'MANUAL' : 'AUTOMATIC',
              faceSimilarity: similarity,
            });
          } else {
            // No open shift but the flag says checked in — repair the record
            // rather than closing the screen as if it worked, which would leave
            // a Check Out button that does nothing forever.
            await clearCheckedInFlag(employee);
          }
        }

        const { data: refreshed } = await client.models.Employee.get({ id: employee.id });
        if (refreshed) setEmployee(refreshed);

        setPhase('DONE');
        onClose();
      } catch (caught) {
        // Let the employee retry after a failure.
        committedRef.current = false;
        setError(extractServerMessage(caught) ?? t(toMessageKey(caught)));
        setPhase('BLOCKED');
      }
    },
    [employee, organization, position, mode, requiresFace, setEmployee, onClose, t],
  );

  // Automatic mode has no camera step, so commit as soon as location passes.
  useEffect(() => {
    if (phase === 'SAVING' && !requiresFace && position) {
      void commit(null);
    }
  }, [phase, requiresFace, position, commit]);

  async function handleSelfie(uri: string) {
    if (!employee?.profilePhotoKey) {
      setError(t('errors.generic'));
      setPhase('BLOCKED');
      return;
    }

    setPhase('VERIFYING');
    setError(null);

    let selfieKey: string | null = null;
    try {
      const identityId = await currentIdentityId();
      selfieKey = await uploadImage(
        uri,
        mediaPaths.selfie(identityId, `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`),
      );

      // Only the selfie is sent. The reference photo is resolved server-side
      // from the caller's own record.
      const { data: verdict, errors } = await client.mutations.verifyFace({
        selfieKey,
      });

      if (errors?.length || !verdict) {
        throw Object.assign(new Error('verification failed'), { errors });
      }

      if (!verdict.matched) {
        setError(
          verdict.reason === 'NO_FACE_DETECTED'
            ? t('errors.faceNotDetected')
            : verdict.reason === 'NO_PROFILE_PHOTO'
              ? t('errors.noProfilePhoto')
              : t('errors.faceNoMatch'),
        );
        setPhase('CAMERA');
        // A rejected selfie is not evidence of anything; don't retain it.
        await deleteImage(selfieKey);
        return;
      }

      await commit(verdict.similarity);
    } catch (caught) {
      if (selfieKey) await deleteImage(selfieKey);
      setError(extractServerMessage(caught) ?? t(toMessageKey(caught)));
      setPhase('BLOCKED');
    }
  }

  if (phase === 'LOCATING') {
    return <LoadingScreen message={t('employee.checkingLocation')} />;
  }

  if (phase === 'VERIFYING') {
    return <LoadingScreen message={t('employee.verifyingFace')} />;
  }

  if (phase === 'SAVING' || phase === 'DONE') {
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
          <Display>
            {mode === 'IN' ? t('employee.checkIn') : t('employee.checkOut')}
          </Display>
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
