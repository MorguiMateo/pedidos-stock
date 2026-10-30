import React, { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Chip, Icon, Text, TextInput } from 'react-native-paper';
import Decimal from '../../lib/decimal';
import type { LocationId, Unit } from '../../lib/types';
import { COLORS, FONTS, RADII, LOCATION_META } from '../../lib/theme';
import { PageHeading } from '../../components/brand';

export const ink = COLORS.ink;
export const accent = COLORS.accent;
export const muted = COLORS.muted;
export const placeColors: Record<LocationId, string> = { cocina: LOCATION_META.cocina.color, mendieta: LOCATION_META.mendieta.color, salta: LOCATION_META.salta.color, carrodilla: LOCATION_META.carrodilla.color };
export const placeNames: Record<LocationId, string> = { cocina: 'Cocina central', mendieta: 'Mendieta', salta: 'Salta', carrodilla: 'Carrodilla' };
export const units: Unit[] = ['g', 'kg', 'ml', 'l', 'unidad'];
export const d = (value: string | number) => new Decimal(typeof value === 'string' ? value.trim().replace(',', '.') : value);
export const qty = (value: string | number) => d(value).toDecimalPlaces(6).toString();
export const price = (value: string) => `$ ${d(value).toFixed(2).replace('.', ',')}`;
export { today as dateToday } from '../../lib/format';
export const dateLabel = (value: string) => {
  if (value.includes('T')) return new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Mendoza', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
  const parts = value.split('-'); return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
};
export function validDate(value: string) { const parsed = new Date(`${value}T12:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
export function numberValue(value: string, label: string, options: { positive?: boolean; integer?: boolean; nonzero?: boolean } = {}) {
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value.trim())) throw new Error(`${label}: ingresá un número válido.`);
  const parsed = d(value);
  if (!parsed.isFinite() || parsed.isNegative() && !options.nonzero || options.positive && !parsed.gt(0) || options.nonzero && parsed.isZero()) throw new Error(`${label}: ${options.nonzero ? 'el cambio no puede ser cero' : options.positive ? 'debe ser mayor que cero' : 'no puede ser negativo'}.`);
  if (options.integer && !parsed.isInteger()) throw new Error(`${label}: usá unidades enteras.`);
  if (options.integer && parsed.gt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label}: cantidad demasiado grande.`);
  return parsed.toString();
}
export const compatibleUnits = (unit: Unit): Unit[] => unit === 'g' || unit === 'kg' ? ['g', 'kg'] : unit === 'ml' || unit === 'l' ? ['ml', 'l'] : ['unidad'];
export function convert(value: string, from: Unit, to: Unit) {
  if (!compatibleUnits(from).includes(to)) throw new Error('Las unidades de la receta no son compatibles.');
  if (from === to) return d(value);
  return from === 'kg' || from === 'l' ? d(value).times(1000) : d(value).div(1000);
}
export function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const hints: Record<string, string> = { INSUFFICIENT_STOCK: 'No alcanza el stock libre. Revisá las cantidades disponibles.', INSUFFICIENT_RESERVED_STOCK: 'No alcanza el stock reservado.', VERSION_CONFLICT: 'Otro dispositivo actualizó este registro. Cerrá el formulario y volvé a abrirlo con los datos actualizados.', INVALID_TRANSITION: 'El estado cambió y esta acción ya no está disponible.', IDEMPOTENCY_CONFLICT: 'La operación ya existe con otros datos. Actualizá e intentá otra vez.' };
  const key = Object.keys(hints).find(code => message.includes(code));
  return key ? `${hints[key]}\n${message}` : message;
}
export function Page({ children, refresh, loading }: { children: ReactNode; refresh: () => Promise<unknown>; loading: boolean }) {
  return <ScrollView style={s.page} contentContainerStyle={s.pageContent} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void refresh(); }} tintColor={accent} />}><View style={s.content}>{children}</View></ScrollView>;
}
export function Heading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return <PageHeading eyebrow={eyebrow} title={title} subtitle={subtitle} action={action} />;
}
export function Card({ children, style }: { children: ReactNode; style?: object }) { return <View style={[s.card, style]}>{children}</View>; }
export function Title({ children, caption, action }: { children: ReactNode; caption?: string; action?: ReactNode }) { return <View style={s.sectionHeading}><View style={s.grow}><Text style={s.sectionTitle}>{children}</Text>{caption ? <Text style={s.caption}>{caption}</Text> : null}</View>{action}</View>; }
export function Note({ children, error = false }: { children: ReactNode; error?: boolean }) { return <View accessibilityRole={error ? 'alert' : undefined} style={[s.note, error && s.error]}><Icon source={error ? 'alert-circle-outline' : 'information-outline'} size={19} color={error ? COLORS.danger : accent} /><Text style={[s.noteText, error && { color: COLORS.danger }]}>{children}</Text></View>; }
export function Blank({ title, text }: { title: string; text: string }) { return <View style={s.blank}><Icon source="package-variant-closed" size={29} color={muted} /><Text accessibilityRole="header" style={s.blankTitle}>{title}</Text><Text style={s.caption}>{text}</Text></View>; }
export function Action({ children, onPress, disabled, loading, secondary = false, icon }: { children: string; onPress: () => void; disabled?: boolean; loading?: boolean; secondary?: boolean; icon?: string }) { return <Button mode={secondary ? 'outlined' : 'contained'} onPress={onPress} disabled={disabled || loading} loading={loading} icon={icon} buttonColor={secondary ? undefined : COLORS.primary} textColor={secondary ? accent : COLORS.ink} style={s.button} contentStyle={{ minHeight: 48 }} labelStyle={{ fontWeight: '700' }}>{children}</Button>; }
export function Options<T extends string>({ values, value, onChange, label }: { values: { value: T; label: string; color?: string }[]; value: T; onChange: (value: T) => void; label?: string }) { return <View style={{ gap: 8 }}>{label ? <Text style={s.label}>{label}</Text> : null}<View style={s.wrap}>{values.map(option => <Chip key={option.value} selected={value === option.value} onPress={() => onChange(option.value)} showSelectedCheck={false} icon={option.color ? () => <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: option.color }} /> : undefined} accessibilityLabel={`${option.label}${value === option.value ? ', seleccionado' : ''}`} style={{ minHeight: 44, backgroundColor: value === option.value ? COLORS.orangeSoft : COLORS.background, borderWidth: 1, borderColor: value === option.value ? COLORS.primary : COLORS.border }} textStyle={{ color: value === option.value ? accent : muted, fontWeight: value === option.value ? '700' : '400' }}>{option.label}</Chip>)}</View></View>; }
export function Input({ label, value, onChange, numeric = false, multiline = false, helper }: { label: string; value: string; onChange: (value: string) => void; numeric?: boolean; multiline?: boolean; helper?: string }) { return <View style={{ gap: 4 }}><TextInput label={label} value={value} onChangeText={onChange} mode="outlined" keyboardType={numeric ? 'decimal-pad' : 'default'} multiline={multiline} outlineColor={COLORS.sand} activeOutlineColor={accent} style={{ backgroundColor: COLORS.surface }} accessibilityLabel={label} />{helper ? <Text style={s.caption}>{helper}</Text> : null}</View>; }
export function Form({ visible, title, children, close, save, saving, disabled, submitLabel = 'Guardar', error }: { visible: boolean; title: string; children: ReactNode; close: () => void; save: () => void; saving: boolean; disabled: boolean; submitLabel?: string; error?: string }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!saving) close(); }}><KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={s.modal}><View style={s.modalHeader}><Text style={[s.sectionTitle, s.grow]}>{title}</Text><Button disabled={saving} onPress={close} textColor={muted} accessibilityLabel="Cerrar formulario">Cerrar</Button></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.form}>{children}{error ? <Note error>{error}</Note> : null}</ScrollView><View style={s.modalFooter}><Action onPress={save} disabled={disabled} loading={saving}>{submitLabel}</Action></View></View></KeyboardAvoidingView></Modal>;
}
export function Loading() { return <View style={s.blank}><ActivityIndicator color={accent} /><Text style={s.caption}>Cargando datos del negocio…</Text></View>; }
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.background }, pageContent: { padding: 20, paddingBottom: 40 }, content: { width: '100%', maxWidth: 1240, alignSelf: 'center', gap: 20 }, grow: { flex: 1, minWidth: 160 }, card: { backgroundColor: COLORS.surface, borderRadius: RADII.tile, padding: 18, gap: 16, borderWidth: 1, borderColor: COLORS.border }, sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, sectionTitle: { color: ink, fontFamily: FONTS.display, fontSize: 23, lineHeight: 30, fontWeight: '600', textTransform: 'uppercase', letterSpacing: .2 }, caption: { color: muted, fontSize: 12, lineHeight: 18 }, label: { fontSize: 12, color: ink, fontWeight: '700' }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, row: { flexDirection: 'row', gap: 12, alignItems: 'center' }, note: { flexDirection: 'row', gap: 9, padding: 13, backgroundColor: COLORS.soft, borderRadius: 13 }, noteText: { flex: 1, fontSize: 13, lineHeight: 19, color: accent }, error: { backgroundColor: COLORS.dangerSoft }, blank: { alignItems: 'center', padding: 24, gap: 9 }, blankTitle: { fontWeight: '700', color: ink, fontSize: 15 }, button: { borderRadius: RADII.pill, borderColor: COLORS.sand }, overlay: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'center', padding: 14 }, modal: { backgroundColor: COLORS.surface, borderRadius: RADII.tile, maxHeight: '94%', maxWidth: 660, width: '100%', alignSelf: 'center', flexShrink: 1 }, modalHeader: { flexDirection: 'row', alignItems: 'center', padding: 18, borderBottomWidth: 1, borderBottomColor: COLORS.border }, form: { padding: 20, gap: 17 }, modalFooter: { padding: 18, borderTopWidth: 1, borderTopColor: COLORS.border }, line: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 14, gap: 10 }, value: { fontFamily: FONTS.bold, fontSize: 26, fontWeight: '700', color: ink }, badge: { fontSize: 11, fontWeight: '700', color: accent, backgroundColor: COLORS.soft, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, overflow: 'hidden' }, danger: { color: COLORS.danger }, cell: { width: 104, padding: 12, justifyContent: 'center' }, tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border, minHeight: 60 }, tableHead: { backgroundColor: COLORS.background, minHeight: 42 }, cellText: { color: ink, fontSize: 13 }, tableName: { width: 165 }, summary: { flex: 1, borderWidth: 1, borderColor: COLORS.border, minWidth: 145, backgroundColor: COLORS.soft, padding: 15, borderRadius: RADII.tile, gap: 4 }, smallTitle: { fontSize: 15, color: ink, fontWeight: '700' },
});
