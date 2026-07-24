import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { EmployeeHomeScreen } from '../screens/employee/EmployeeHomeScreen';
import { EmployeeProfileScreen } from '../screens/employee/EmployeeProfileScreen';
import { CheckInScreen } from '../screens/employee/CheckInScreen';
import { useSession } from '../context/SessionContext';
import {
  checkRange,
  performCheckIn,
  performCheckOut,
  recordPresencePing,
} from '../lib/attendance';
import { ensureForegroundPermission } from '../lib/location';
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

  // The watch callback needs the *latest* employee (for isCheckedIn), so keep a
  // ref in sync rather than closing over a stale value.
  const employeeRef = useRef(employee);
  employeeRef.current = employee;

  const mode = organization?.attendanceMode;
  const lat = organization?.latitude;
  const lng = organization?.longitude;

  /**
   * AUTOMATIC mode: watch location in the FOREGROUND while the app is open and
   * auto check-in / check-out on entering / leaving the radius.
   *
   * This deliberately does NOT use background geofencing or an Android
   * foreground service. Those start a native service that hard-crashes on some
   * Android versions and cannot be caught from JS — which is exactly why the app
   * closed when an employee opened it under automatic mode. Foreground watching
   * needs only ordinary location permission, starts no service, and matches the
   * intent: detect the employee "when their location is on" and the app is open.
   */
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (mode !== 'AUTOMATIC') {
      setTrackingBlocked(false);
      return;
    }
    if (!organization || lat == null || lng == null) return;

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    async function handle(position: Location.LocationObject) {
      const current = employeeRef.current;
      if (!current || !organization) return;

      const coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      const accuracy = position.coords.accuracy ?? null;
      const range = checkRange(organization, coordinates, accuracy);

      try {
        if (range.inside && !current.isCheckedIn) {
          await performCheckIn({ position: coordinates, accuracy, selfieKey: null });
          await refresh();
        } else if (!range.inside && current.isCheckedIn) {
          await performCheckOut({ position: coordinates, accuracy, selfieKey: null });
          await refresh();
        } else {
          await recordPresencePing({ position: coordinates, accuracy });
        }
      } catch {
        // Transient network / permission blips must not break the watcher.
      }
    }

    async function start() {
      try {
        const granted = await ensureForegroundPermission();
        if (!granted) {
          setTrackingBlocked(true);
          return;
        }
        setTrackingBlocked(false);

        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 25,
            timeInterval: 30_000,
          },
          (position) => {
            void handle(position);
          },
        );

        if (cancelled) sub.remove();
        else subscription = sub;
      } catch {
        // Never let location setup crash the app; manual check-in still works.
        setTrackingBlocked(true);
      }
    }

    void start();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [mode, lat, lng, organization, refresh]);

  // Keep the roster/status fresh when the employee returns to the app.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

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
          <Text style={styles.warningText}>{t('employee.locationPermissionBody')}</Text>
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
