import React from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { COLORS, FONTS } from '../lib/theme';

/** Original artwork, shared with the Kalak website (never re-typeset). */
export function KalakLogo() {
  return <Image source={require('../../assets/brand/kalak-logo.webp')} accessibilityLabel="Kalak, comida real para mascotas" style={styles.logo} resizeMode="contain" />;
}

/** Repeat the original Andean border at its native aspect ratio on every platform. */
export function Guarda() {
  const { width } = useWindowDimensions();
  const tileWidth = 1580 / 60 * 12;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.guarda}>
    {Array.from({ length: Math.ceil(width / tileWidth) }, (_, i) => <Image key={i} source={require('../../assets/brand/guarda.webp')} style={{ width: tileWidth, height: 12 }} resizeMode="stretch" />)}
  </View>;
}

export function PageHeading({ title, subtitle, eyebrow = 'KALAK logística', action }: { title: string; subtitle?: string; eyebrow?: string; action?: React.ReactNode }) {
  const { width } = useWindowDimensions();
  return <View style={styles.heading}>
    <View style={styles.headingText}>
      <View style={styles.eyebrowRow}><View style={styles.accentLine} /><Text style={styles.eyebrow}>{eyebrow}</Text></View>
      <Text accessibilityRole="header" style={[styles.title, width < 600 && styles.mobileTitle]}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
    {action ? <View style={styles.action}>{action}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  logo: { width: 49, height: 59 },
  guarda: { height: 12, flexDirection: 'row', overflow: 'hidden', backgroundColor: COLORS.background },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 18, paddingVertical: 8 },
  headingText: { flex: 1, minWidth: 220, gap: 7 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  accentLine: { width: 20, height: 3, backgroundColor: COLORS.primary },
  eyebrow: { fontFamily: FONTS.semibold, fontSize: 10, letterSpacing: 1.6, color: COLORS.accent },
  title: { fontFamily: FONTS.display, fontWeight: '600', fontSize: 40, lineHeight: 48, letterSpacing: .4, color: COLORS.ink, textTransform: 'uppercase' },
  mobileTitle: { fontSize: 32, lineHeight: 40 },
  subtitle: { fontSize: 14, lineHeight: 22, color: COLORS.muted, maxWidth: 660 },
  action: { maxWidth: '100%', flexShrink: 1 },
});
