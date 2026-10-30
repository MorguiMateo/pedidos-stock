import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { useFonts } from 'expo-font';
import { PaperProvider, Icon, Text, IconButton, ActivityIndicator, Button } from 'react-native-paper';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LocaleConfig } from 'react-native-calendars';
import { COLORS, FONTS, theme } from '../src/lib/theme';
import { WorkspaceProvider, useWorkspace } from '../src/lib/workspace';
import { Notice } from '../src/components/ui';
import { Guarda, KalakLogo } from '../src/components/brand';
import { formatDate } from '../src/lib/format';
import { AuthGate } from '../src/features/auth/AuthScreen';
import { useAuth } from '../src/lib/auth';

LocaleConfig.locales.es = { monthNames: ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'], monthNamesShort: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'], dayNames: ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'], dayNamesShort: ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'], today: 'Hoy' };
LocaleConfig.defaultLocale = 'es';
export const unstable_settings = { anchor: 'index' };

// Material 3 navigation bar: the active destination gets a pill indicator behind its icon.
function TabIcon({ source, color, focused }: { source: string; color: unknown; focused: boolean }) {
  return <View style={[styles.tabIndicator, focused && styles.tabIndicatorActive]}><Icon source={source} color={typeof color === 'string' ? color : COLORS.accent} size={22} /></View>;
}

function AppShell() {
  const { isOnline, isConfigured, error, data, refresh, isLoading, isRefreshing } = useWorkspace();
  const auth = useAuth();
  const [signOutError, setSignOutError] = React.useState('');
  const signOut = async () => { try { await auth.signOut(); } catch (e) { setSignOutError(e instanceof Error ? e.message : 'No se pudo cerrar la sesión.'); } };
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 600;
  const connected = isOnline && isConfigured && !error;
  const connectionLabel = !isOnline ? 'Sin conexión' : !isConfigured ? 'Sin configurar' : error ? 'Sin sincronizar' : isRefreshing ? 'Sincronizando' : 'Compartido';
  return <View style={[styles.app, { paddingTop: insets.top }]}>
    <StatusBar style="dark" />
    <View style={[styles.brandBar, compact && styles.compactBar]}>
      <KalakLogo />
      <View style={styles.brandText}>
        <Text style={[styles.brandName, width < 360 && { fontSize: 19, lineHeight: 26 }]}>KALAK logística</Text>
        <Text style={styles.brandSub}>{data?.profile?.display_name || 'GESTIÓN KALAK'}</Text>
      </View>
      <View accessibilityLabel={`Estado: ${connectionLabel}`} style={[styles.shared, { backgroundColor: connected ? COLORS.successSoft : COLORS.warningSoft }]}>
        <View style={[styles.dot, { backgroundColor: connected ? COLORS.success : COLORS.warning }]} />
        {!compact ? <Text style={[styles.connectionText, { color: connected ? COLORS.success : COLORS.warning }]}>{connectionLabel}</Text> : null}
      </View>
      <IconButton icon="logout" size={22} iconColor={COLORS.muted} style={{ margin: 0 }} onPress={() => void signOut()} accessibilityLabel="Cerrar sesión" />
    </View>
    <Guarda />
    <View style={styles.syncBar}>
      <Text style={styles.connectionText}>Actualización automática cada minuto</Text>
      <Button mode="text" compact icon="refresh" loading={isRefreshing} disabled={!isOnline || !isConfigured || isRefreshing || !auth.session} onPress={() => void refresh()} accessibilityLabel="Actualizar información" contentStyle={{ minHeight: 48, paddingHorizontal: 4 }} labelStyle={{ fontFamily: FONTS.semibold, fontSize: 14 }}>Actualizar</Button>
    </View>
    {signOutError ? <View style={styles.notice}><Notice tone="error" text={signOutError} /></View> : null}
    {!isConfigured ? <View style={styles.notice}><Notice tone="warning" text="La conexión compartida todavía no está configurada. No se muestran datos de ejemplo ni se guardan cambios en este dispositivo." /></View> : !isOnline ? <View style={styles.notice}><Notice tone="warning" text={`Estás viendo la última información guardada${data?.updated_at ? ` (${formatDate(data.updated_at)})` : ''}. Conectate a internet para guardar cambios.`} /></View> : error ? <View style={styles.notice}><Notice tone="error" text={`No pudimos actualizar la información. ${error.message}`} /></View> : null}
    {data?.profile ? <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: COLORS.accent,
      tabBarInactiveTintColor: COLORS.muted,
      tabBarStyle: { backgroundColor: COLORS.surface, borderTopColor: COLORS.border, height: 76 + insets.bottom, paddingBottom: 10 + insets.bottom, paddingTop: 10, elevation: 0 },
      tabBarItemStyle: { minHeight: 56, paddingVertical: 0 },
      tabBarLabelStyle: { fontFamily: FONTS.semibold, fontSize: compact ? 11 : 12, textAlign: 'center', lineHeight: 16, marginTop: 4, flexShrink: 0 },
      sceneStyle: { backgroundColor: COLORS.background },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Ventas', tabBarIcon: ({ color, focused }) => <TabIcon source="calendar-check-outline" color={color} focused={focused} /> }} />
      <Tabs.Screen name="clients" options={{ title: 'Clientes', tabBarIcon: ({ color, focused }) => <TabIcon source="account-group-outline" color={color} focused={focused} /> }} />
      <Tabs.Screen name="purchases" options={{ href: null }} />
      <Tabs.Screen name="stock" options={{ title: 'Stock', tabBarIcon: ({ color, focused }) => <TabIcon source="package-variant-closed" color={color} focused={focused} /> }} />
      <Tabs.Screen name="production" options={{ href: null }} />
      <Tabs.Screen name="reports" options={{ title: 'Resumen', href: data.profile.role === 'admin' ? '/reports' : null, tabBarIcon: ({ color, focused }) => <TabIcon source="chart-box-outline" color={color} focused={focused} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Ajustes', href: data.profile.role === 'admin' ? '/settings' : null, tabBarIcon: ({ color, focused }) => <TabIcon source="cog-outline" color={color} focused={focused} /> }} />
    </Tabs> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 }}>{isLoading ? <ActivityIndicator color={COLORS.accent} style={{ marginBottom: 6 }} /> : null}<Text variant="titleMedium" style={{ textTransform: 'uppercase' }}>{isLoading ? 'Cargando tu espacio…' : 'Esperando habilitación'}</Text><Text style={{ textAlign: 'center', color: COLORS.muted, fontSize: 14, lineHeight: 21, maxWidth: 360 }}>Una administradora debe asignar tu cuenta y punto de retiro. Si ya lo hizo, actualizá la información.</Text></View>}
  </View>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    [FONTS.regular]: require('../assets/fonts/Inter-Regular.ttf'),
    [FONTS.medium]: require('../assets/fonts/Inter-Medium.ttf'),
    [FONTS.semibold]: require('../assets/fonts/Inter-SemiBold.ttf'),
    [FONTS.bold]: require('../assets/fonts/Inter-Bold.ttf'),
    [FONTS.display]: require('../assets/fonts/Oswald-SemiBold.ttf'),
  });
  // Font assets are bundled for offline use. A font failure must not block business data.
  return <SafeAreaProvider><PaperProvider theme={theme}>
    {!fontsLoaded && !fontError ? <View style={styles.loading}><ActivityIndicator color={COLORS.accent} accessibilityLabel="Cargando Kalak" /></View> : <WorkspaceProvider><AuthGate><AppShell /></AuthGate></WorkspaceProvider>}
  </PaperProvider></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: COLORS.background },
  brandBar: { backgroundColor: COLORS.background, paddingHorizontal: 24, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 14 },
  compactBar: { paddingHorizontal: 16, paddingRight: 8, gap: 12 },
  brandText: { flex: 1, minWidth: 0 },
  brandName: { fontFamily: FONTS.display, fontSize: 22, lineHeight: 28, letterSpacing: .4, textTransform: 'uppercase', color: COLORS.ink },
  brandSub: { fontFamily: FONTS.semibold, fontSize: 11, lineHeight: 14, color: COLORS.muted, letterSpacing: .8, marginTop: 1 },
  shared: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 24, minWidth: 24, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 999 },
  connectionText: { fontFamily: FONTS.medium, color: COLORS.muted, fontSize: 12 },
  dot: { height: 8, width: 8, borderRadius: 4 },
  syncBar: { paddingLeft: 16, paddingRight: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  notice: { paddingHorizontal: 16, paddingTop: 12 },
  tabIndicator: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  tabIndicatorActive: { backgroundColor: COLORS.orangeSoft },
  loading: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' },
});
