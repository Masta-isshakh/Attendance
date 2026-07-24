import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  Avatar,
  Body,
  Card,
  Caption,
  Display,
  Divider,
  EmptyState,
  ErrorBanner,
  Heading,
  StatusPill,
} from '../../components/ui';
import { AttendanceRow } from '../../components/AttendanceRow';
import { useSession } from '../../context/SessionContext';
import type { AttendanceRecordType } from '../../lib/amplify';
import {
  checkRange,
  dayKeyFor,
  findOpenRecord,
  formatDuration,
  listRecentRecords,
  radiusOf,
  secondsBetween,
} from '../../lib/attendance';
import { toMessageKey } from '../../lib/errors';
import { getCurrentPosition, supportsBackgroundLocation } from '../../lib/location';
import { formatTime } from '../../lib/datetime';
import { getImageUrl } from '../../lib/media';
import { palette, radius, spacing } from '../../theme';

export function EmployeeHomeScreen() {
  const { t } = useTranslation();
  const { employee, organization } = useSession();

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [records, setRecords] = useState<AttendanceRecordType[]>([]);
  const [openRecord, setOpenRecord] = useState<AttendanceRecordType | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [inside, setInside] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!employee || !organization) return;

    try {
      if (employee.profilePhotoKey) setPhotoUrl(await getImageUrl(employee.profilePhotoKey));

      const [recent, open] = await Promise.all([
        listRecentRecords(employee, 20),
        findOpenRecord(employee),
      ]);
      setRecords(recent);
      setOpenRecord(open);
      setError(null);
    } catch (caught) {
      // Without this the pull-to-refresh spinner hangs forever and the screen
      // silently shows stale data.
      setError(t(toMessageKey(caught)));
    }

    // A foreground reading so the employee can see where they stand before
    // tapping anything.
    const position = await getCurrentPosition();
    if (position.ok) {
      const range = checkRange(organization, position.coordinates, position.accuracy);
      setDistance(range.distance);
      setInside(range.inside);
    } else {
      // Resolve the "checking…" state either way, so it cannot spin forever.
      setInside(false);
      setDistance(null);
    }

    setRefreshing(false);
  }, [employee, organization, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!employee || !organization) return null;

  const name = employee.fullName ?? employee.username;
  const isActive = employee.status === 'ACTIVE';
  // dayKey is written from the LOCAL date, so it must be compared against the
  // local date too — toISOString() would be a day off either side of midnight
  // for anyone not on UTC.
  const todayKey = dayKeyFor(new Date());
  const todaySeconds = records
    .filter((record) => record.dayKey === todayKey)
    .reduce((total, record) => total + (record.totalSecondsPresent ?? secondsBetween(record, new Date())), 0);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
      >
        <View style={styles.header}>
          <Avatar uri={photoUrl} name={name} size={56} />
          <View style={styles.headerText}>
            <Display>{t('employee.welcomeBack', { name: name.split(/[\s.]/)[0] })}</Display>
            <Caption>{organization.name}</Caption>
          </View>
        </View>

        <ErrorBanner message={error} />

        <Card>
          <View style={styles.statusRow}>
            <StatusPill
              active={isActive}
              label={isActive ? t('employee.statusActive') : t('employee.statusInactive')}
            />
            {openRecord ? (
              <Caption>
                {t('employee.checkedInAt', { time: formatTime(openRecord.checkInAt) })}
              </Caption>
            ) : (
              <Caption>{t('employee.notCheckedIn')}</Caption>
            )}
          </View>

          <Divider />

          <View style={styles.locationRow}>
            <Ionicons
              name={inside ? 'location' : 'location-outline'}
              size={18}
              color={inside ? palette.success : palette.muted}
            />
            <Body muted>
              {inside === null
                ? t('employee.checkingLocation')
                : inside
                  ? t('employee.seenInsideJustNow')
                  : distance != null
                    ? t('employee.distanceAway', { distance })
                    : t('employee.outsideArea')}
            </Body>
          </View>

          {openRecord ? (
            <View style={styles.durationRow}>
              <Caption>{t('employee.hoursToday')}</Caption>
              <Heading>{formatDuration(todaySeconds)}</Heading>
            </View>
          ) : null}
        </Card>

        {organization.attendanceMode === 'AUTOMATIC' ? (
          <Card style={styles.autoCard}>
            <View style={styles.autoRow}>
              <Ionicons name="flash-outline" size={18} color={palette.brand} />
              <Heading>{t('employee.automaticModeOn')}</Heading>
            </View>
            <Body muted>
              {supportsBackgroundLocation
                ? t('employee.automaticModeBody')
                : t('admin.attendanceModeAutomaticNative')}
            </Body>
          </Card>
        ) : null}

        <Card>
          <Heading>{t('employee.myAttendance')}</Heading>
          <Divider />
          {records.length === 0 ? (
            <EmptyState
              icon="time-outline"
              title={t('employee.noHistoryYet')}
              body={t('employee.noHistoryBody')}
            />
          ) : (
            records
              .slice(0, 5)
              .map((record) => (
                <AttendanceRow key={record.id} record={record} title={t('attendance.checkIn')} />
              ))
          )}
        </Card>

        <View style={styles.radiusNote}>
          <Caption>{`${t('admin.radius')}: ${radiusOf(organization)} m`}</Caption>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  durationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  autoCard: { backgroundColor: palette.brandSoft, borderColor: palette.brand },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  radiusNote: { alignItems: 'center', paddingTop: spacing.sm, borderRadius: radius.sm },
});
