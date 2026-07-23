import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { palette, radius, shadow, spacing, typography } from '../theme';

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function Screen({
  children,
  scroll = false,
  edges = ['top', 'bottom'],
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
}) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, style]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screenContent, style]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {content}
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

/* -------------------------------------------------------------------------- */
/* Typography                                                                  */
/* -------------------------------------------------------------------------- */

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Display({ children }: { children: ReactNode }) {
  return <Text style={styles.display}>{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function Body({
  children,
  muted = false,
  center = false,
}: {
  children: ReactNode;
  muted?: boolean;
  center?: boolean;
}) {
  return (
    <Text style={[styles.body, muted && styles.bodyMuted, center && styles.center]}>
      {children}
    </Text>
  );
}

export function Caption({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'danger' }) {
  return (
    <Text style={[styles.caption, tone === 'danger' && styles.captionDanger]}>{children}</Text>
  );
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variantStyles[variant],
        pressed && !isDisabled && styles.buttonPressed,
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? palette.brand : '#fff'} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? (
            <Ionicons
              name={icon}
              size={18}
              color={variant === 'secondary' || variant === 'ghost' ? palette.brand : '#fff'}
            />
          ) : null}
          <Text style={[styles.buttonLabel, variantTextStyles[variant]]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  ...inputProps
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  // Password fields get a show/hide eye. Start hidden; toggling flips
  // secureTextEntry so the raw characters become visible.
  const isPassword = inputProps.secureTextEntry === true;
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={styles.inputWrap}>
        <TextInput
          {...inputProps}
          secureTextEntry={isPassword ? !revealed : inputProps.secureTextEntry}
          style={[
            styles.input,
            isPassword && styles.inputWithIcon,
            error ? styles.inputError : null,
            inputProps.style,
          ]}
          placeholderTextColor={palette.faint}
        />
        {isPassword ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            onPress={() => setRevealed((previous) => !previous)}
            hitSlop={10}
            style={styles.eyeButton}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={palette.muted}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <Caption tone="danger">{error}</Caption> : hint ? <Caption>{hint}</Caption> : null}
    </View>
  );
}

export function Toggle({
  label,
  description,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      onPress={() => !disabled && onChange(!value)}
      style={styles.toggleRow}
    >
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {description ? <Caption>{description}</Caption> : null}
      </View>
      <View style={[styles.track, value && styles.trackOn, disabled && styles.trackDisabled]}>
        <View style={[styles.thumb, value && styles.thumbOn]} />
      </View>
    </Pressable>
  );
}

export function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <View style={[styles.pill, active ? styles.pillActive : styles.pillInactive]}>
      <View style={[styles.dot, active ? styles.dotActive : styles.dotInactive]} />
      <Text style={[styles.pillText, active ? styles.pillTextActive : styles.pillTextInactive]}>
        {label}
      </Text>
    </View>
  );
}

export function Avatar({
  uri,
  name,
  size = 44,
}: {
  uri?: string | null;
  name?: string | null;
  size?: number;
}) {
  const initials = (name ?? '?')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  if (uri) {
    return (
      <Image
        source={{ uri }}
        accessibilityLabel={name ?? undefined}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: palette.line,
        }}
      />
    );
  }

  return (
    <View
      style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Text style={[styles.avatarInitials, { fontSize: size * 0.36 }]}>{initials || '?'}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={palette.brand} />
      </View>
      <Heading>{title}</Heading>
      <Body muted center>
        {body}
      </Body>
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function LoadingScreen({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={palette.brand} />
      <Text style={styles.loadingText}>{message ?? t('common.loading')}</Text>
    </View>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBanner}>
      <Ionicons name="alert-circle" size={18} color={palette.danger} />
      <Text style={styles.errorBannerText}>{message}</Text>
    </View>
  );
}

export function SuccessBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.successBanner}>
      <Ionicons name="checkmark-circle" size={18} color={palette.success} />
      <Text style={styles.successBannerText}>{message}</Text>
    </View>
  );
}

export function StatTile({ value, label }: { value: string | number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const content = (
    <View style={styles.row}>
      {left}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.rowPressed}
    >
      {content}
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: palette.brand },
  secondary: { backgroundColor: palette.brandSoft },
  danger: { backgroundColor: palette.danger },
  ghost: { backgroundColor: 'transparent' },
};

const variantTextStyles = {
  primary: { color: '#FFFFFF' },
  secondary: { color: palette.brand },
  danger: { color: '#FFFFFF' },
  ghost: { color: palette.brand },
} as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  screenContent: { flex: 1, paddingHorizontal: spacing.lg },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },

  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: palette.line,
    ...shadow,
  },
  divider: { height: 1, backgroundColor: palette.line, marginVertical: spacing.sm },

  display: { ...typography.display, color: palette.ink },
  title: { ...typography.title, color: palette.ink },
  heading: { ...typography.heading, color: palette.ink },
  body: { ...typography.body, color: palette.body, lineHeight: 21 },
  bodyMuted: { color: palette.muted },
  center: { textAlign: 'center' },
  caption: { ...typography.caption, color: palette.muted, lineHeight: 17 },
  captionDanger: { color: palette.danger },

  button: {
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { ...typography.heading },

  field: { gap: spacing.xs },
  fieldLabel: { ...typography.label, color: palette.body },
  inputWrap: { justifyContent: 'center' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: palette.surface,
    color: palette.ink,
    fontSize: 15,
  },
  inputWithIcon: { paddingRight: 48 },
  eyeButton: {
    position: 'absolute',
    right: spacing.md,
    height: 48,
    justifyContent: 'center',
  },
  inputError: { borderColor: palette.danger },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { ...typography.heading, color: palette.ink },
  track: {
    width: 48,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: palette.line,
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: palette.brand },
  trackDisabled: { opacity: 0.5 },
  thumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  thumbOn: { alignSelf: 'flex-end' },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  pillActive: { backgroundColor: palette.successSoft },
  pillInactive: { backgroundColor: palette.canvas },
  pillText: { ...typography.caption, fontWeight: '600' },
  pillTextActive: { color: palette.success },
  pillTextInactive: { color: palette.muted },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotActive: { backgroundColor: palette.success },
  dotInactive: { backgroundColor: palette.faint },

  avatarFallback: {
    backgroundColor: palette.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { color: palette.brand, fontWeight: '700' },

  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyAction: { marginTop: spacing.md, alignSelf: 'stretch' },

  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: palette.canvas,
  },
  loadingText: { ...typography.body, color: palette.muted },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorBannerText: { ...typography.body, color: palette.danger, flex: 1 },

  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.successSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  successBannerText: { ...typography.body, color: palette.success, flex: 1 },

  stat: { flex: 1, gap: 2 },
  statValue: { ...typography.display, color: palette.ink },
  statLabel: { ...typography.caption, color: palette.muted },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...typography.heading, color: palette.ink },
  rowSubtitle: { ...typography.caption, color: palette.muted },
});
