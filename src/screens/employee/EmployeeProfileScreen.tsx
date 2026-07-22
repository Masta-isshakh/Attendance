import { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  Avatar,
  Body,
  Button,
  Card,
  Caption,
  Divider,
  EmptyState,
  Heading,
  ListRow,
  StatusPill,
  Title,
} from '../../components/ui';
import { AttendanceRow } from '../../components/AttendanceRow';
import { LanguagePicker } from '../../components/LanguagePicker';
import { useSession } from '../../context/SessionContext';
import type { AttendanceRecordType } from '../../lib/amplify';
import { formatDuration, listRecentRecords, secondsBetween } from '../../lib/attendance';
import { getImageUrl } from '../../lib/media';
import { palette, spacing } from '../../theme';

export function EmployeeProfileScreen() {
  const { t } = useTranslation();
  const { employee, organization, signOut } = useSession();

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [records, setRecords] = useState<AttendanceRecordType[]>([]);

  const load = useCallback(async () => {
    if (!employee) return;
    if (employee.profilePhotoKey) setPhotoUrl(await getImageUrl(employee.profilePhotoKey));
    setRecords(await listRecentRecords(employee, 60));
  }, [employee]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!employee) return null;

  const name = employee.fullName ?? employee.username;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekSeconds = records
    .filter((record) => new Date(record.checkInAt) >= weekAgo)
    .reduce(
      (total, record) => total + (record.totalSecondsPresent ?? secondsBetween(record, now)),
      0,
    );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Avatar uri={photoUrl} name={name} size={72} />
          <View style={styles.headerText}>
            <Title>{name}</Title>
            <Caption>{employee.email}</Caption>
            <StatusPill
              active={employee.status === 'ACTIVE'}
              label={
                employee.status === 'ACTIVE'
                  ? t('employee.statusActive')
                  : t('employee.statusInactive')
              }
            />
          </View>
        </View>

        <Card>
          <Heading>{t('employee.account')}</Heading>
          <Divider />
          <ListRow
            title={employee.username}
            subtitle={t('admin.employeeUsername')}
            left={<Ionicons name="person-outline" size={20} color={palette.muted} />}
          />
          {employee.phoneNumber ? (
            <ListRow
              title={employee.phoneNumber}
              subtitle={t('admin.employeePhone')}
              left={<Ionicons name="call-outline" size={20} color={palette.muted} />}
            />
          ) : null}
          <ListRow
            title={organization?.name ?? '—'}
            subtitle={t('admin.organizationDetails')}
            left={<Ionicons name="business-outline" size={20} color={palette.muted} />}
          />
        </Card>

        <Card>
          <View style={styles.weekRow}>
            <Caption>{t('employee.thisWeek')}</Caption>
            <Heading>{formatDuration(weekSeconds)}</Heading>
          </View>
        </Card>

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
            records.map((record) => (
              <AttendanceRow key={record.id} record={record} title={t('attendance.checkIn')} />
            ))
          )}
        </Card>

        <LanguagePicker />

        <Card>
          <Heading>{t('employee.settings')}</Heading>
          <Body muted>{`${t('common.appName')} · ${Platform.OS}`}</Body>
        </Card>

        <Button label={t('auth.signOut')} onPress={() => void signOut()} variant="ghost" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  headerText: { flex: 1, gap: spacing.xs, alignItems: 'flex-start' },
  weekRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
