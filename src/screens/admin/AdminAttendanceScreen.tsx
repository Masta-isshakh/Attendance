import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Caption,
  EmptyState,
  ErrorBanner,
  LoadingScreen,
  Title,
} from '../../components/ui';
import { AttendanceRow } from '../../components/AttendanceRow';
import { useSession } from '../../context/SessionContext';
import type { AttendanceRecordType } from '../../lib/amplify';
import { dayKeyFor, listOrganizationRecords } from '../../lib/attendance';
import { toMessageKey } from '../../lib/errors';
import { palette, radius, spacing, typography } from '../../theme';

type Filter = 'ALL' | 'TODAY' | 'WEEK';

export function AdminAttendanceScreen() {
  const { t } = useTranslation();
  const { organization } = useSession();

  const [records, setRecords] = useState<AttendanceRecordType[]>([]);
  const [filter, setFilter] = useState<Filter>('TODAY');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organization) return;
    try {
      setRecords(await listOrganizationRecords(organization.organizationId, 400));
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

  const filtered = useMemo(() => {
    if (filter === 'ALL') return records;

    const now = new Date();
    if (filter === 'TODAY') {
      const today = dayKeyFor(now);
      return records.filter((record) => record.dayKey === today);
    }

    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return records.filter((record) => new Date(record.checkInAt) >= weekAgo);
  }, [records, filter]);

  if (loading) return <LoadingScreen />;

  const filters: Array<{ value: Filter; label: string }> = [
    { value: 'TODAY', label: t('admin.filterToday') },
    { value: 'WEEK', label: t('admin.filterWeek') },
    { value: 'ALL', label: t('admin.filterAll') },
  ];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Title>{t('admin.attendance')}</Title>
      </View>

      <View style={styles.filters}>
        {filters.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === option.value }}
            onPress={() => setFilter(option.value)}
            style={[styles.chip, filter === option.value && styles.chipActive]}
          >
            <Text
              style={[styles.chipText, filter === option.value && styles.chipTextActive]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ErrorBanner message={error} />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        contentContainerStyle={
          filtered.length === 0 ? styles.emptyWrap : styles.list
        }
        ListEmptyComponent={
          <EmptyState
            icon="calendar-outline"
            title={t('admin.noAttendanceYet')}
            body={t('admin.noAttendanceBody')}
          />
        }
        renderItem={({ item }) => (
          <AttendanceRow
            record={item}
            title={item.employeeUsername ?? t('common.none')}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListFooterComponent={
          filtered.length > 0 ? (
            <View style={styles.footer}>
              <Caption>{`${filtered.length}`}</Caption>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  filters: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  chipActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  chipText: { ...typography.label, color: palette.body },
  chipTextActive: { color: '#fff' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  separator: { height: 1, backgroundColor: palette.line },
  footer: { paddingVertical: spacing.lg, alignItems: 'center' },
});
