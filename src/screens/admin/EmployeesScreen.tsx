import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Platform, RefreshControl, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  Avatar,
  Button,
  Caption,
  EmptyState,
  ErrorBanner,
  Field,
  ListRow,
  LoadingScreen,
  Screen,
  StatusPill,
  SuccessBanner,
  Title,
} from '../../components/ui';
import { useSession } from '../../context/SessionContext';
import { client, type EmployeeRecord } from '../../lib/amplify';
import { listAllPages } from '../../lib/attendance';
import { extractServerMessage, toMessageKey } from '../../lib/errors';
import { minutesSince } from '../../lib/geo';
import { palette, spacing } from '../../theme';
import { EmployeeFormScreen } from './EmployeeFormScreen';

/**
 * Cross-platform confirm — `Alert` does nothing on web. Button labels are
 * translated: this is the app's only destructive action, so it is the last
 * place that should fall back to English.
 */
async function confirmDestructive(
  title: string,
  message: string,
  cancelLabel: string,
  confirmLabel: string,
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' ? window.confirm(`${title}\n\n${message}`) : false;
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export function EmployeesScreen() {
  const { t } = useTranslation();
  const { organization } = useSession();

  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmployeeRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!organization) return;
    try {
      const data = await listAllPages<EmployeeRecord>((nextToken) =>
        client.models.Employee.list({
          filter: { organizationId: { eq: organization.organizationId } },
          limit: 200,
          nextToken,
        }),
      );
      const sorted = [...data].sort((a, b) => a.username.localeCompare(b.username));
      setEmployees(sorted);
      setError(null);

      // Profile photos live under each employee's own identity prefix, which
      // an admin cannot read directly — the mutation checks organization
      // membership and hands back a short-lived presigned URL.
      const withPhotos = sorted.filter((employee) => employee.profilePhotoKey);
      const resolved = await Promise.all(
        withPhotos.map(async (employee) => {
          try {
            const { data: result } = await client.mutations.getEmployeePhotoUrl({
              organizationId: organization.organizationId,
              username: employee.username,
            });
            return result?.url ? ([employee.id, result.url] as const) : null;
          } catch {
            return null;
          }
        }),
      );
      setPhotos(Object.fromEntries(resolved.filter(Boolean) as Array<readonly [string, string]>));
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
    const needle = query.trim().toLowerCase();
    if (!needle) return employees;
    return employees.filter(
      (employee) =>
        employee.username.toLowerCase().includes(needle) ||
        employee.email.toLowerCase().includes(needle) ||
        (employee.fullName ?? '').toLowerCase().includes(needle),
    );
  }, [employees, query]);

  async function handleDelete(employee: EmployeeRecord) {
    if (!organization) return;
    const confirmed = await confirmDestructive(
      t('admin.deleteEmployee'),
      t('admin.deleteEmployeeConfirm', { name: employee.fullName ?? employee.username }),
      t('common.cancel'),
      t('common.delete'),
    );
    if (!confirmed) return;

    try {
      // Cognito account first: if this fails the employee can still sign in,
      // and an orphaned Cognito user is worse than an orphaned record.
      const { errors } = await client.mutations.deleteEmployeeAccount({
        organizationId: organization.organizationId,
        username: employee.username,
      });
      if (errors?.length) throw Object.assign(new Error('delete failed'), { errors });

      // Remove the employee's attendance rows first: deleting the Employee
      // record alone would orphan them, leaving history the admin can see but
      // no longer attribute or clean up.
      const records = await listAllPages<{ id: string }>((nextToken) =>
        client.models.AttendanceRecord.list({
          filter: { userId: { eq: employee.userId } },
          limit: 200,
          nextToken,
        }),
      );
      for (const record of records) {
        await client.models.AttendanceRecord.delete({ id: record.id });
      }

      await client.models.Employee.delete({ id: employee.id });
      setNotice(t('admin.employeeDeleted'));
      await load();
    } catch (caught) {
      setError(extractServerMessage(caught) ?? t(toMessageKey(caught)));
    }
  }

  if (creating || editing) {
    return (
      <EmployeeFormScreen
        employee={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(message) => {
          setCreating(false);
          setEditing(null);
          setNotice(message);
          void load();
        }}
      />
    );
  }

  if (loading) return <LoadingScreen />;

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <Title>{t('admin.employees')}</Title>
        <Button
          label={t('admin.addEmployee')}
          onPress={() => setCreating(true)}
          icon="add"
          style={styles.addButton}
        />
      </View>

      {employees.length > 0 ? (
        <Field
          label=""
          placeholder={t('common.search')}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
      ) : null}

      <ErrorBanner message={error} />
      <SuccessBanner message={notice} />

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
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={filtered.length === 0 ? styles.emptyWrap : styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={t('admin.noEmployeesYet')}
            body={t('admin.noEmployeesBody')}
            action={<Button label={t('admin.addEmployee')} onPress={() => setCreating(true)} />}
          />
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.fullName ?? item.username}
            subtitle={subtitleFor(item, t)}
            left={<Avatar uri={photos[item.id]} name={item.fullName ?? item.username} />}
            right={
              <View style={styles.rowActions}>
                <StatusPill
                  active={item.status === 'ACTIVE'}
                  label={
                    item.status === 'ACTIVE'
                      ? t('employee.statusActive')
                      : t('employee.statusInactive')
                  }
                />
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={palette.danger}
                  onPress={() => void handleDelete(item)}
                  suppressHighlighting
                />
              </View>
            }
            onPress={() => setEditing(item)}
          />
        )}
      />
    </Screen>
  );
}

function subtitleFor(employee: EmployeeRecord, t: TFunction) {
  if (employee.status === 'ACTIVE') return employee.email;
  const seen = minutesSince(
    employee.lastSeenInsideAt ? new Date(employee.lastSeenInsideAt) : null,
    new Date(),
  );
  if (seen == null) return employee.email;
  return t('employee.seenInsideAgo', { minutes: seen });
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  addButton: { minHeight: 40, paddingHorizontal: spacing.md },
  list: { paddingBottom: spacing.xxxl },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  separator: { height: 1, backgroundColor: palette.line },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
