import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { EmployeeHomeScreen } from '../screens/employee/EmployeeHomeScreen';
import { EmployeeProfileScreen } from '../screens/employee/EmployeeProfileScreen';
import { CheckInScreen } from '../screens/employee/CheckInScreen';
import { useSession } from '../context/SessionContext';
import {
  backgroundSupported,
  startBackgroundTracking,
  stopBackgroundTracking,
} from '../lib/geofenceTask';
import { ensureBackgroundPermission } from '../lib/location';
import { DEFAULT_RADIUS_METRES, DEFAULT_STALENESS_MINUTES } from '../lib/geo';
import { palette, spacing, typography } from '../theme';

type Tab = 'HOME' | 'PROFILE';

/**
 * A hand-rolled bottom bar rather than `@react-navigation/bottom-tabs`, because
 * the centre control is not a tab: it is the primary action, it is visually
 * larger than the icons either side, and its label flips between Check In and
 * Check Out with the employee's state.
 */
export function EmployeeTabs() {
  const { t } = useTranslation();
  const { employee, organization, refresh } = useSession();

  const [tab, setTab] = useState<Tab>('HOME');
  const [checkFlow, setCheckFlow] = useState<'IN' | 'OUT' | null>(null);
  const [trackingBlocked, setTrackingBlocked] = useState(false);

  const isCheckedIn = Boolean(employee?.isCheckedIn);

  // Background tracking must be re-armed on every foreground: the OS drops
  // registrations when the app is force-killed and will not restore them.
  useEffect(() => {
    if (!backgroundSupported || !employee || !organization) return;
    if (organization.latitude == null || organization.longitude == null) return;

    const wantsTracking =
      organization.attendanceMode === 'AUTOMATIC' ||
      (organization.geofenceRuleEnabled ?? true);

    async function arm() {
      if (!employee || !organization) return;
      if (!wantsTracking) {
        await stopBackgroundTracking();
        setTrackingBlocked(false);
        return;
      }
      const granted = await ensureBackgroundPermission();
      if (!granted) {
        // Silence here would leave the home screen claiming automatic check-in
        // is working while nothing is tracking at all.
        setTrackingBlocked(true);
        return;
      }

      const started = await startBackgroundTracking({
        employeeId: employee.id,
        userId: employee.userId,
        organizationId: organization.organizationId,
        memberGroup: organization.memberGroup,
        adminGroup: organization.adminGroup,
        latitude: organization.latitude ?? 0,
        longitude: organization.longitude ?? 0,
        radiusMeters: organization.radiusMeters ?? DEFAULT_RADIUS_METRES,
        geofenceRuleEnabled: organization.geofenceRuleEnabled ?? true,
        attendanceMode:
          (organization.attendanceMode as 'MANUAL' | 'AUTOMATIC') ?? 'MANUAL',
        presenceStalenessMinutes:
          organization.presenceStalenessMinutes ?? DEFAULT_STALENESS_MINUTES,
      });
      setTrackingBlocked(!started);
    }

    void arm();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void arm();
        void refresh();
      }
    });
    return () => subscription.remove();
  }, [employee, organization, refresh]);

  if (checkFlow) {
    return (
      <CheckInScreen
        mode={checkFlow}
        onClose={() => {
          setCheckFlow(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      {trackingBlocked ? (
        <SafeAreaView edges={['top']} style={styles.warningBar}>
          <Text style={styles.warningText}>{t('employee.backgroundPermissionBody')}</Text>
        </SafeAreaView>
      ) : null}

      <View style={styles.content}>
        {tab === 'HOME' ? <EmployeeHomeScreen /> : <EmployeeProfileScreen />}
      </View>

      <SafeAreaView edges={['bottom']} style={styles.barSafeArea}>
        <View style={styles.bar}>
          <TabButton
            icon={tab === 'HOME' ? 'home' : 'home-outline'}
            label={t('employee.home')}
            active={tab === 'HOME'}
            onPress={() => setTab('HOME')}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isCheckedIn ? t('employee.checkOut') : t('employee.checkIn')}
            onPress={() => setCheckFlow(isCheckedIn ? 'OUT' : 'IN')}
            style={({ pressed }) => [
              styles.action,
              isCheckedIn ? styles.actionOut : styles.actionIn,
              pressed && styles.actionPressed,
            ]}
          >
            <Ionicons
              name={isCheckedIn ? 'log-out-outline' : 'log-in-outline'}
              size={26}
              color="#fff"
            />
            <Text style={styles.actionLabel} numberOfLines={1}>
              {isCheckedIn ? t('employee.checkOut') : t('employee.checkIn')}
            </Text>
          </Pressable>

          <TabButton
            icon={tab === 'PROFILE' ? 'person' : 'person-outline'}
            label={t('employee.profile')}
            active={tab === 'PROFILE'}
            onPress={() => setTab('PROFILE')}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

function TabButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.tab}
    >
      <Ionicons name={icon} size={24} color={active ? palette.brand : palette.faint} />
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  content: { flex: 1 },
  warningBar: { backgroundColor: palette.warningSoft, paddingHorizontal: spacing.lg },
  warningText: {
    ...typography.caption,
    color: palette.warning,
    paddingVertical: spacing.sm,
  },
  barSafeArea: { backgroundColor: palette.surface },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? 0 : spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    backgroundColor: palette.surface,
  },
  tab: { alignItems: 'center', gap: 2, width: 76, paddingVertical: spacing.xs },
  tabLabel: { ...typography.caption, color: palette.faint },
  tabLabelActive: { color: palette.brand, fontWeight: '600' },
  action: {
    flex: 1,
    maxWidth: 168,
    minHeight: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    marginHorizontal: spacing.sm,
    marginTop: -18,
    shadowColor: '#0F172A',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  actionIn: { backgroundColor: palette.brand },
  actionOut: { backgroundColor: palette.success },
  actionPressed: { opacity: 0.9 },
  actionLabel: { ...typography.caption, color: '#fff', fontWeight: '700' },
});
