import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  Avatar,
  Body,
  Card,
  Caption,
  Divider,
  EmptyState,
  ErrorBanner,
  Heading,
  ListRow,
  LoadingScreen,
  StatTile,
  StatusPill,
  Title,
} from '../../components/ui';
import { useSession } from '../../context/SessionContext';
import { client, type EmployeeRecord } from '../../lib/amplify';
import { dayKeyFor, listOrganizationRecords } from '../../lib/attendance';
import { toMessageKey } from '../../lib/errors';
import { minutesSince } from '../../lib/geo';
import { getImageUrl } from '../../lib/media';
import { palette, spacing } from '../../theme';
import { SafeAreaView } from 'react-native-safe-area-context';

export function AdminOverviewScreen() {
  const { t } = useTranslation();
  const { organization } = useSession();

  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [checkedInToday, setCheckedInToday] = useState(0);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organization) return;
    try {
      const { data } = await client.models.Employee.list({
        filter: { organizationId: { eq: organization.organizationId } },
        limit: 500,
      });
      setEmployees(data ?? []);

      const records = await listOrganizationRecords(organization.organizationId, 300);
      const today = dayKeyFor(new Date());
      setCheckedInToday(new Set(
        records.filter((record) => record.dayKey === today).map((record) => record.userId),
      ).size);

      if (organization.logoKey) setLogoUrl(await getImageUrl(organization.logoKey));
      setError(null);
    } catch (caught) {
      setError(t(toMessageKey(caught)));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [organization, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingScreen />;

  const active = employees.filter((employee) => employee.status === 'ACTIVE');
  const locationSet = organization?.latitude != null && organization?.longitude != null;

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
          <Avatar uri={logoUrl} name={organization?.name} size={48} />
          <View style={styles.headerText}>
            <Title>{organization?.name ?? t('common.appName')}</Title>
            <Caption>{t('admin.workspace')}</Caption>
          </View>
        </View>

        <ErrorBanner message={error} />

        {!locationSet ? (
          <Card style={styles.warningCard}>
            <View style={styles.warningRow}>
              <Ionicons name="location-outline" size={20} color={palette.warning} />
              <Heading>{t('admin.locationNotSet')}</Heading>
            </View>
            <Body muted>{t('admin.locationNotSetBody')}</Body>
          </Card>
        ) : null}

        <Card>
          <View style={styles.stats}>
            <StatTile value={active.length} label={t('admin.activeNow')} />
            <StatTile value={employees.length} label={t('admin.totalEmployees')} />
            <StatTile value={checkedInToday} label={t('admin.checkedInToday')} />
          </View>
        </Card>

        <Card>
          <Heading>{t('admin.activeNow')}</Heading>
          <Divider />
          {active.length === 0 ? (
            <EmptyState
              icon="person-outline"
              title={t('employee.statusInactive')}
              body={t('admin.noAttendanceBody')}
            />
          ) : (
            active.map((employee) => (
              <ListRow
                key={employee.id}
                title={employee.fullName ?? employee.username}
                subtitle={presenceLabel(employee, t)}
                left={<Avatar name={employee.fullName ?? employee.username} size={36} />}
                right={<StatusPill active label={t('employee.statusActive')} />}
              />
            ))
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function presenceLabel(employee: EmployeeRecord, t: TFunction) {
  const minutes = minutesSince(
    employee.lastSeenInsideAt ? new Date(employee.lastSeenInsideAt) : null,
    new Date(),
  );
  if (minutes == null) return employee.email;
  if (minutes === 0) return t('employee.seenInsideJustNow');
  return t('employee.seenInsideAgo', { minutes });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  stats: { flexDirection: 'row', gap: spacing.md },
  warningCard: { backgroundColor: palette.warningSoft, borderColor: palette.warning },
  warningRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
