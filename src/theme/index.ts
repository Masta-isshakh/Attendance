import { Platform } from 'react-native';

/**
 * A single source of truth for visual style. Screens never hardcode colours or
 * spacing so that the app reads as one product.
 */
export const palette = {
  brand: '#2563EB',
  brandDark: '#1D4ED8',
  brandSoft: '#EFF6FF',

  success: '#059669',
  successSoft: '#ECFDF5',
  warning: '#D97706',
  warningSoft: '#FFFBEB',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',

  ink: '#0F172A',
  body: '#334155',
  muted: '#64748B',
  faint: '#94A3B8',

  line: '#E2E8F0',
  surface: '#FFFFFF',
  canvas: '#F8FAFC',
  overlay: 'rgba(15, 23, 42, 0.55)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
} as const;

export const shadow = Platform.select({
  ios: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  android: { elevation: 3 },
  default: {},
}) as object;

export const theme = { palette, spacing, radius, typography, shadow };
export type Theme = typeof theme;
