import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AdminOverviewScreen } from '../screens/admin/AdminOverviewScreen';
import { EmployeesScreen } from '../screens/admin/EmployeesScreen';
import { AdminAttendanceScreen } from '../screens/admin/AdminAttendanceScreen';
import { AdminSettingsScreen } from '../screens/admin/AdminSettingsScreen';
import { palette, spacing, typography } from '../theme';

type Tab = 'OVERVIEW' | 'EMPLOYEES' | 'ATTENDANCE' | 'SETTINGS';

export function AdminTabs() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('OVERVIEW');

  const tabs: Array<{ key: Tab; icon: keyof typeof Ionicons.glyphMap; label: string }> = [
    { key: 'OVERVIEW', icon: 'grid-outline', label: t('admin.overview') },
    { key: 'EMPLOYEES', icon: 'people-outline', label: t('admin.employees') },
    { key: 'ATTENDANCE', icon: 'calendar-outline', label: t('admin.attendance') },
    { key: 'SETTINGS', icon: 'settings-outline', label: t('admin.settings') },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {tab === 'OVERVIEW' ? <AdminOverviewScreen /> : null}
        {tab === 'EMPLOYEES' ? <EmployeesScreen /> : null}
        {tab === 'ATTENDANCE' ? <AdminAttendanceScreen /> : null}
        {tab === 'SETTINGS' ? <AdminSettingsScreen /> : null}
      </View>

      <SafeAreaView edges={['bottom']} style={styles.barSafeArea}>
        <View style={styles.bar}>
          {tabs.map((item) => {
            const active = tab === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(item.key)}
                style={styles.tab}
              >
                <Ionicons
                  name={item.icon}
                  size={22}
                  color={active ? palette.brand : palette.faint}
                />
                <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  content: { flex: 1 },
  barSafeArea: { backgroundColor: palette.surface },
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: palette.line,
    backgroundColor: palette.surface,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: spacing.xs },
  label: { ...typography.caption, color: palette.faint },
  labelActive: { color: palette.brand, fontWeight: '600' },
});
