import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import { Body, Button, Display, LoadingScreen, Screen } from '../../components/ui';
import { useSession } from '../../context/SessionContext';
import { client } from '../../lib/amplify';
import { checkRange, performCheckIn, performCheckOut, radiusOf } from '../../lib/attendance';
import { extractServerMessage, toMessageKey } from '../../lib/errors';
import { failureMessageKey, getCurrentPosition } from '../../lib/location';
import { palette, spacing } from '../../theme';

type Phase = 'LOCATING' | 'SUBMITTING' | 'BLOCKED' | 'DONE';

/** Server rejection codes → something a person can act on. */
function reasonToMessage(reason: string, t: TFunction): string {
  switch (reason) {
    case 'OUT_OF_RANGE':
      return t('errors.outsideRadiusSimple');
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
 * Identity was already proven by the login selfie face-match, so this step only
 * confirms location. The server independently re-derives the distance from the
 * organization's stored coordinates before recording anything.
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
  const [error, setError] = useState<string | null>(null);
  const committedRef = useRef(false);

  const run = useCallback(async () => {
    if (!employee || !organization) return;

    committedRef.current = false;
    setPhase('LOCATING');
    setError(null);

    const result = await getCurrentPosition();
    if (!result.ok) {
      setError(t(failureMessageKey(result.failure)));
      setPhase('BLOCKED');
      return;
    }

    // Only CHECK-IN is gated on the radius. Gating check-out would trap anyone
    // who has already left the office.
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

    if (committedRef.current) return;
    committedRef.current = true;
    setPhase('SUBMITTING');

    try {
      const outcome =
        mode === 'IN'
          ? await performCheckIn({
              position: result.coordinates,
              accuracy: result.accuracy,
              selfieKey: null,
            })
          : await performCheckOut({
              position: result.coordinates,
              accuracy: result.accuracy,
              selfieKey: null,
            });

      if (!outcome.ok) {
        committedRef.current = false;
        setError(reasonToMessage(outcome.reason, t));
        setPhase('BLOCKED');
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
  }, [employee, organization, mode, setEmployee, onClose, t]);

  useEffect(() => {
    void run();
  }, [run]);

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

  return (
    <Screen>
      <View style={styles.blocked}>
        <View style={styles.icon}>
          <Ionicons name="alert-circle-outline" size={30} color={palette.danger} />
        </View>
        <Display>{mode === 'IN' ? t('employee.checkIn') : t('employee.checkOut')}</Display>
        <Body muted>{error ?? t('errors.generic')}</Body>
        <View style={styles.actions}>
          <Button label={t('common.retry')} onPress={() => void run()} />
          <Button label={t('common.cancel')} onPress={onClose} variant="ghost" />
        </View>
      </View>
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
