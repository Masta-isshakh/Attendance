import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import type { AttendanceRecordType } from '../lib/amplify';
import { formatDuration, secondsBetween } from '../lib/attendance';
import { formatShortDate, formatTime } from '../lib/datetime';
import { palette, spacing, typography } from '../theme';

function formatDay(iso: string, t: (key: string) => string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return t('attendance.today');
  if (sameDay(date, yesterday)) return t('attendance.yesterday');
  return formatShortDate(iso);
}

export function AttendanceRow({
  record,
  title,
}: {
  record: AttendanceRecordType;
  title: string;
}) {
  const { t } = useTranslation();
  const open = !record.checkOutAt;
  const seconds = record.totalSecondsPresent ?? secondsBetween(record, new Date());

  return (
    <View style={styles.row}>
      <View style={styles.dayBadge}>
        <Text style={styles.dayText}>{formatDay(record.checkInAt, t)}</Text>
      </View>

      <View style={styles.details}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.times}>
          <Ionicons name="log-in-outline" size={14} color={palette.success} />
          <Text style={styles.time}>{formatTime(record.checkInAt)}</Text>
          {record.checkOutAt ? (
            <>
              <Ionicons name="log-out-outline" size={14} color={palette.muted} />
              <Text style={styles.time}>{formatTime(record.checkOutAt)}</Text>
            </>
          ) : (
            <Text style={styles.live}>{t('attendance.stillActive')}</Text>
          )}
        </View>
        {record.checkInFaceSimilarity != null ? (
          <Text style={styles.meta}>
            {t('attendance.faceMatch', { score: Math.round(record.checkInFaceSimilarity) })}
            {' · '}
            {record.method === 'AUTOMATIC'
              ? t('attendance.methodAutomatic')
              : t('attendance.methodManual')}
          </Text>
        ) : (
          <Text style={styles.meta}>
            {record.method === 'AUTOMATIC'
              ? t('attendance.methodAutomatic')
              : t('attendance.methodManual')}
          </Text>
        )}
      </View>

      <Text style={[styles.duration, open && styles.durationOpen]}>
        {formatDuration(seconds)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  dayBadge: {
    minWidth: 58,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: palette.brandSoft,
    alignItems: 'center',
  },
  dayText: { ...typography.caption, color: palette.brand, fontWeight: '600' },
  details: { flex: 1, gap: 3 },
  title: { ...typography.heading, color: palette.ink },
  times: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  time: { ...typography.caption, color: palette.body, marginRight: spacing.sm },
  live: { ...typography.caption, color: palette.success, fontWeight: '600' },
  meta: { ...typography.caption, color: palette.faint },
  duration: { ...typography.label, color: palette.body },
  durationOpen: { color: palette.success },
});
