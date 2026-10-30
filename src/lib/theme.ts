import { configureFonts, MD3LightTheme, type MD3Theme } from 'react-native-paper';
import type { LocationId } from './types';

// Kalak v2 palette. Orange fills use charcoal text; small text uses the darker accent.
export const COLORS = {
  background: '#FAF7F0', surface: '#FFFFFF', ink: '#20221D', muted: '#626156',
  primary: '#EF792C', accent: '#B74712', border: '#E4DCC8', soft: '#EFE9DA',
  sand: '#D5CEB2', orangeSoft: '#FFF0E5', orangeLight: '#F7A06C',
  success: '#2F7A3A', successSoft: '#EAF3E8', warning: '#865A16',
  warningSoft: '#FFF2DB', danger: '#A53930', dangerSoft: '#FCEEEA',
  disabled: '#9B978B', backdrop: '#20221D80',
};
export const FONTS = {
  regular: 'Inter-Regular', medium: 'Inter-Medium', semibold: 'Inter-SemiBold',
  bold: 'Inter-Bold', display: 'Oswald-SemiBold',
};
export const RADII = { tile: 14, pill: 999 };
// Location colors identify data and retain their established meaning.
export const LOCATION_META = {
  cocina: { name: 'Cocina central', color: '#8B7553', soft: '#F1ECE2' },
  mendieta: { name: 'Mendieta', color: '#8757D5', soft: '#F0E9FB' },
  salta: { name: 'Salta', color: '#D95555', soft: '#FBECEC' },
  carrodilla: { name: 'Carrodilla', color: '#319C75', soft: '#E6F3EC' },
} satisfies Record<LocationId, { name: string; color: string; soft: string }>;
const display = { fontFamily: FONTS.display, fontWeight: '600' as const, letterSpacing: .3 };
export const theme: MD3Theme = {
  ...MD3LightTheme,
  roundness: RADII.tile / 2,
  fonts: {
    ...configureFonts({ config: { fontFamily: FONTS.regular } }),
    labelLarge: { ...MD3LightTheme.fonts.labelLarge, fontFamily: FONTS.semibold, fontWeight: '600' },
    labelMedium: { ...MD3LightTheme.fonts.labelMedium, fontFamily: FONTS.semibold, fontWeight: '600' },
    labelSmall: { ...MD3LightTheme.fonts.labelSmall, fontFamily: FONTS.medium },
    titleSmall: { ...MD3LightTheme.fonts.titleSmall, fontFamily: FONTS.semibold, fontWeight: '600' },
    titleMedium: { ...MD3LightTheme.fonts.titleMedium, ...display, fontSize: 22, lineHeight: 29 },
    titleLarge: { ...MD3LightTheme.fonts.titleLarge, ...display, fontSize: 26, lineHeight: 33 },
    headlineSmall: { ...MD3LightTheme.fonts.headlineSmall, ...display, fontSize: 28, lineHeight: 35 },
    headlineMedium: { ...MD3LightTheme.fonts.headlineMedium, ...display, fontSize: 32, lineHeight: 39 },
    headlineLarge: { ...MD3LightTheme.fonts.headlineLarge, ...display, fontSize: 38, lineHeight: 46 },
    displaySmall: { ...MD3LightTheme.fonts.displaySmall, ...display },
    displayMedium: { ...MD3LightTheme.fonts.displayMedium, ...display },
    displayLarge: { ...MD3LightTheme.fonts.displayLarge, ...display },
  },
  colors: {
    ...MD3LightTheme.colors,
    primary: COLORS.accent, onPrimary: COLORS.surface,
    primaryContainer: COLORS.orangeSoft, onPrimaryContainer: COLORS.accent,
    secondary: COLORS.accent, onSecondary: COLORS.surface, secondaryContainer: COLORS.soft, onSecondaryContainer: COLORS.ink,
    tertiary: COLORS.success, onTertiary: COLORS.surface, tertiaryContainer: COLORS.successSoft, onTertiaryContainer: COLORS.success,
    surface: COLORS.surface, surfaceVariant: COLORS.soft, onSurfaceVariant: COLORS.muted,
    background: COLORS.background, onSurface: COLORS.ink, onBackground: COLORS.ink,
    outline: COLORS.sand, outlineVariant: COLORS.border,
    error: COLORS.danger, errorContainer: COLORS.dangerSoft, onErrorContainer: COLORS.danger,
    surfaceDisabled: COLORS.soft, onSurfaceDisabled: COLORS.muted,
    inverseSurface: COLORS.ink, inverseOnSurface: COLORS.background, inversePrimary: COLORS.orangeLight, backdrop: COLORS.backdrop,
    elevation: { level0: 'transparent', level1: COLORS.background, level2: '#F6F1E7', level3: COLORS.soft, level4: COLORS.soft, level5: COLORS.border },
  },
};
export const calendarTheme = {
  backgroundColor: COLORS.surface, calendarBackground: COLORS.surface,
  textSectionTitleColor: COLORS.muted, selectedDayBackgroundColor: COLORS.primary, selectedDayTextColor: COLORS.ink,
  todayTextColor: COLORS.accent, dayTextColor: COLORS.ink, textDisabledColor: COLORS.disabled,
  arrowColor: COLORS.accent, monthTextColor: COLORS.ink,
  textDayFontFamily: FONTS.regular, textMonthFontFamily: FONTS.display, textDayHeaderFontFamily: FONTS.medium,
  textMonthFontWeight: '600' as const, textDayFontSize: 14, textMonthFontSize: 22, textDayHeaderFontSize: 12,
};
