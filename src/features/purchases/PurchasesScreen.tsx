import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, IconButton, Text, TextInput } from 'react-native-paper';
import { Chip } from '../../components/ui';
import { Calendar } from 'react-native-calendars';
import Decimal from '../../lib/decimal';
import { COLORS } from '../../lib/theme';
import { expiryFourMonths } from '../../lib/operations';
import { useWorkspace } from '../../lib/workspace';
import { Purchase, PurchaseStatus, Unit } from '../../lib/types';
import { calendarTheme, Columns, Confirm, currency, DatePicker, dateLabel, dateNow, decimal, Empty, errorText, Form, Notice, Page, palette, Panel, styles, validDate } from '../sales/components';

const statuses: { id: PurchaseStatus; name: string; color: string; icon: string }[] = [{ id: 'planificada', name: 'Planificada', color: COLORS.warning, icon: 'clock-outline' }, { id: 'recibida', name: 'Recibida', color: COLORS.success, icon: 'package-variant-closed-check' }, { id: 'cancelada', name: 'Cancelada', color: COLORS.muted, icon: 'close-circle-outline' }];
type Line = { ingredient_id: string; quantity: string; unit: Unit; unit_price: string };
type Draft = { id?: string; supplier: string; expected_date: string; notes: string; lines: Line[]; version?: number };
type Mark = { dots: { key: string; color: string }[]; selected?: boolean; selectedColor?: string };
const unitsFor = (unit: Unit): Unit[] => unit === 'g' || unit === 'kg' ? ['g', 'kg'] : unit === 'ml' || unit === 'l' ? ['ml', 'l'] : ['unidad'];
function validNumber(value: string, positive: boolean) { const normalized = decimal(value); if (!/^\d+(\.\d+)?$/.test(normalized)) return false; const amount = new Decimal(normalized); return amount.isFinite() && (positive ? amount.gt(0) : amount.gte(0)); }
function lineTotal(line: Line) { return validNumber(line.quantity, true) && validNumber(line.unit_price, false) ? new Decimal(decimal(line.quantity)).mul(decimal(line.unit_price)) : new Decimal(0); }

export default function PurchasesScreen() {
  const ws = useWorkspace();
  const [day, setDay] = useState(dateNow);
  const [month, setMonth] = useState(() => dateNow().slice(0, 7));
  const [status, setStatus] = useState('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Purchase | null>(null);
  const [manufacturedOn, setManufacturedOn] = useState('');
  const [batchCode, setBatchCode] = useState('');
  const [receiptError, setReceiptError] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [confirm, setConfirm] = useState<{ purchase: Purchase; operation: 'receive_purchase' | 'cancel_purchase' } | null>(null);
  const available = ws.isConfigured && ws.isOnline;
  const disabled = !available || busy || ws.isSaving;
  const ingredients = ws.data?.items.filter(item => item.kind === 'ingredient') ?? [];
  const purchases = ws.data?.purchases ?? [];
  const filtered = purchases.filter(purchase => status === 'all' || purchase.status === status);
  const selected = filtered.filter(purchase => purchase.expected_date === day);
  const monthly = purchases.filter(purchase => purchase.expected_date.startsWith(month));
  const pending = monthly.filter(purchase => purchase.status === 'planificada');
  const marks = useMemo(() => { const result: Record<string, Mark> = {}; for (const purchase of filtered) { const currentStatus = statuses.find(item => item.id === purchase.status)!; const mark = result[purchase.expected_date] ?? { dots: [] }; if (!mark.dots.some(dot => dot.key === purchase.status)) mark.dots.push({ key: purchase.status, color: currentStatus.color }); result[purchase.expected_date] = mark; } result[day] = { ...result[day], dots: result[day]?.dots ?? [], selected: true, selectedColor: palette.accent }; return result; }, [filtered, day]);
  const newPurchase = () => { setFormError(''); setDraft({ supplier: '', expected_date: day, notes: '', lines: [] }); };
  const editPurchase = (purchase: Purchase) => { if (purchase.status !== 'planificada') return; setFormError(''); setDraft({ id: purchase.id, supplier: purchase.supplier, expected_date: purchase.expected_date, notes: purchase.notes, lines: purchase.lines.map(line => ({ ...line })), version: purchase.version }); };
  const changeLine = (index: number, patch: Partial<Line>) => setDraft(current => current ? { ...current, lines: current.lines.map((line, i) => i === index ? { ...line, ...patch } : line) } : current);
  const save = async () => {
    if (!draft || disabled) return;
    if (!validDate(draft.expected_date)) return setFormError('Elegí una fecha de recepción válida.');
    if (!draft.lines.length) return setFormError('Agregá al menos un ingrediente.');
    if (draft.lines.some(line => !validNumber(line.quantity, true) || !validNumber(line.unit_price, false))) return setFormError('Cada cantidad debe ser mayor a cero y cada precio debe ser cero o positivo. Usá números sin separador de miles.');
    if (draft.lines.some(line => { const item = ingredients.find(item => item.id === line.ingredient_id); return !item || !unitsFor(item.unit).includes(line.unit); })) return setFormError('Revisá las unidades de los ingredientes: sólo se permite convertir g/kg o ml/l.');
    setBusy(true); setFormError('');
    try { await ws.command('save_purchase', { ...(draft.id ? { id: draft.id } : {}), supplier: draft.supplier.trim(), expected_date: draft.expected_date, notes: draft.notes.trim(), lines: draft.lines.map(line => ({ ...line, quantity: decimal(line.quantity), unit_price: decimal(line.unit_price) })) }, draft.version); setDay(draft.expected_date); setMonth(draft.expected_date.slice(0, 7)); setDraft(null); } catch (e) { setFormError(errorText(e)); } finally { setBusy(false); }
  };
  const transition = async () => { if (!confirm || disabled) return; setBusy(true); setError(''); try { await ws.command(confirm.operation, { id: confirm.purchase.id }, confirm.purchase.version); setConfirm(null); } catch (e) { setConfirm(null); setError(errorText(e)); } finally { setBusy(false); } };

  const receive = async () => {
    if (!receipt || disabled) return;
    if (manufacturedOn && (!validDate(manufacturedOn) || manufacturedOn > dateNow())) return setReceiptError('La fecha de fabricación debe ser válida y no puede ser futura.');
    setBusy(true); setReceiptError('');
    try {
      await ws.command('receive_purchase', { id: receipt.id, ...(manufacturedOn ? { manufactured_on: manufacturedOn } : {}), ...(batchCode.trim() ? { batch_code: batchCode.trim() } : {}) }, receipt.version);
      setReceipt(null);
    } catch (e) { setReceiptError(errorText(e)); } finally { setBusy(false); }
  };

  return <Page eyebrow="ABASTECIMIENTO · COMPRAS" title="Todo para lo que viene." subtitle="Planificá los insumos y registrá cada recepción en cocina." action={<Button mode="contained" buttonColor={COLORS.primary} textColor={COLORS.ink} contentStyle={{ minHeight: 48 }} icon="plus" disabled={disabled || !ingredients.some(item => item.active)} onPress={newPurchase}>Nueva compra</Button>}>
    {error ? <Notice error>{error}</Notice> : null}
    <View style={[styles.row, { flexWrap: 'wrap', gap: 14 }]}><Panel style={{ flex: 1, minWidth: 150 }}><Text style={styles.muted}>Por recibir este mes</Text><Text style={styles.total}>{pending.length} {pending.length === 1 ? 'compra' : 'compras'}</Text></Panel><Panel style={{ flex: 1, minWidth: 180 }}><Text style={styles.muted}>Inversión del mes · no canceladas</Text><Text style={styles.total}>{currency(monthly.filter(purchase => purchase.status !== 'cancelada').reduce((sum, purchase) => sum.plus(purchase.total), new Decimal(0)))}</Text></Panel></View>
    <View style={styles.wrap}><Chip selected={status === 'all'} onPress={() => setStatus('all')}>Todos los estados</Chip>{statuses.map(item => <Chip key={item.id} icon={item.icon} selected={status === item.id} onPress={() => setStatus(item.id)}>{item.name}</Chip>)}</View>
    <Columns calendar={<Panel><Text variant="titleMedium" accessibilityRole="header" style={{ color: palette.ink, textTransform: 'uppercase' }}>Calendario de compras</Text><Calendar firstDay={1} key={month} current={`${month}-01`} markingType="multi-dot" markedDates={marks} onDayPress={value => setDay(value.dateString)} onMonthChange={value => setMonth(value.dateString.slice(0, 7))} theme={calendarTheme} enableSwipeMonths /><View style={styles.wrap}>{statuses.map(item => <View key={item.id} style={[styles.row, { gap: 5 }]}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: item.color }} /><Text style={{ fontSize: 11, color: palette.muted }}>{item.name}</Text></View>)}</View></Panel>}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}><View><Text variant="titleLarge" style={{ color: palette.ink }}>{dateLabel(day)}</Text><Text style={styles.muted}>{selected.length} {selected.length === 1 ? 'compra prevista' : 'compras previstas'}</Text></View><IconButton icon="calendar-today" accessibilityLabel="Ir a hoy" onPress={() => { setDay(dateNow()); setMonth(dateNow().slice(0, 7)); }} /></View>
      {selected.length ? selected.map(purchase => { const state = statuses.find(item => item.id === purchase.status)!; return <Panel key={purchase.id}><View style={[styles.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}><View style={{ flex: 1, gap: 8 }}><Text variant="titleMedium" style={{ color: palette.ink }}>{purchase.supplier || 'Sin proveedor asignado'}</Text><View style={styles.wrap}><Chip compact icon={state.icon} selectedColor={state.color} style={{ backgroundColor: `${state.color}14` }}>{state.name}</Chip><Chip compact icon="storefront-outline">Cocina</Chip></View></View><Text variant="titleMedium" style={{ color: palette.ink, fontWeight: '700' }}>{currency(purchase.total)}</Text></View>{purchase.lines.map((line, index) => <View key={`${line.ingredient_id}-${index}`} style={[styles.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}><View style={{ flex: 1 }}><Text style={{ color: palette.ink }}>{line.quantity} {line.unit} · {ingredients.find(item => item.id === line.ingredient_id)?.name ?? 'Ingrediente no disponible'}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 4 }}>{currency(line.unit_price)} / {line.unit}</Text></View><Text style={styles.muted}>{currency(new Decimal(line.quantity).mul(line.unit_price))}</Text></View>)}{purchase.notes ? <Text style={styles.muted}>{purchase.notes}</Text> : null}{purchase.received_at ? <Text style={{ color: palette.accent, fontSize: 12 }}>Recibida el {dateLabel(purchase.received_at.slice(0, 10))}</Text> : null}{purchase.status === 'planificada' ? <><View style={styles.divider} /><View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap' }]}><Button compact textColor={palette.danger} disabled={disabled} onPress={() => setConfirm({ purchase, operation: 'cancel_purchase' })}>Cancelar</Button><Button compact icon="pencil-outline" disabled={disabled} onPress={() => editPurchase(purchase)}>Editar</Button><Button mode="contained-tonal" icon="package-variant-closed-check" disabled={disabled} onPress={() => { setReceipt(purchase); setManufacturedOn(''); setBatchCode(''); setReceiptError(''); }}>Recibir</Button></View></> : null}</Panel>; }) : <Empty icon="basket-outline" title="Sin compras para este día" description="Planificá una compra para anticipar los ingredientes que necesitás. El stock se suma únicamente al recibirla." />}
      {!ingredients.some(item => item.active) ? <Notice>Para planificar una compra, abrí Stock → Ingredientes y creá al menos un ingrediente activo con su unidad de medida.</Notice> : null}
    </Columns>
    <Form visible={!!draft} title={draft?.id ? 'Editar compra' : 'Planificar compra'} onDismiss={() => setDraft(null)} onSave={() => void save()} saving={busy || ws.isSaving} disabled={!available} error={formError} submitLabel="Guardar compra">
      {draft ? <><TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} accessibilityLabel="Proveedor (opcional)" label="Proveedor (opcional)" value={draft.supplier} onChangeText={supplier => setDraft({ ...draft, supplier })} /><DatePicker label="Fecha de recepción prevista" value={draft.expected_date} onChange={expected_date => setDraft({ ...draft, expected_date })} /><View><Text style={styles.label}>Agregar ingredientes</Text><View style={styles.wrap}>{ingredients.filter(item => item.active).map(item => <Chip key={item.id} icon={draft.lines.some(line => line.ingredient_id === item.id) ? 'check' : 'plus'} onPress={() => !draft.lines.some(line => line.ingredient_id === item.id) && setDraft({ ...draft, lines: [...draft.lines, { ingredient_id: item.id, quantity: '', unit: item.unit, unit_price: item.price }] })}>{item.name}</Chip>)}</View></View>
      {draft.lines.map((line, index) => { const item = ingredients.find(item => item.id === line.ingredient_id); return <View key={line.ingredient_id} style={styles.lineCard}><View style={styles.row}><Text style={{ flex: 1, fontWeight: '600', color: palette.ink }}>{item?.name ?? 'Ingrediente no disponible'}</Text><IconButton icon="close" size={18} accessibilityLabel={`Quitar ${item?.name ?? 'ingrediente'}`} onPress={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })} /></View><View style={styles.row}><TextInput style={{ flex: 1 }} mode="outlined" accessibilityLabel="Cantidad" label="Cantidad" value={line.quantity} onChangeText={quantity => changeLine(index, { quantity })} keyboardType="decimal-pad" /><View style={styles.wrap}>{unitsFor(item?.unit ?? line.unit).map(unit => <Chip key={unit} selected={line.unit === unit} onPress={() => {
        if (unit === line.unit) return;
        const factors: Record<Unit, string> = { g: '1', kg: '1000', ml: '1', l: '1000', unidad: '1' };
        const factor = new Decimal(factors[unit]).div(factors[line.unit]);
        changeLine(index, { unit, quantity: validNumber(line.quantity, true) ? new Decimal(decimal(line.quantity)).div(factor).toFixed() : line.quantity, unit_price: validNumber(line.unit_price, false) ? new Decimal(decimal(line.unit_price)).mul(factor).toFixed() : line.unit_price });
      }}>{unit}</Chip>)}</View></View><TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} label={`Precio por ${line.unit} ($)`} keyboardType="decimal-pad" value={line.unit_price} onChangeText={unit_price => changeLine(index, { unit_price })} /><View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.muted}>Subtotal</Text><Text style={{ color: palette.ink, fontWeight: '600' }}>{currency(lineTotal(line))}</Text></View></View>; })}
      <Notice>La cantidad y el precio se expresan en la unidad elegida. Al cambiar g/kg o ml/l, ambos valores se convierten sin cambiar el subtotal. La recepción será completa y sumará los insumos al stock central de cocina.</Notice>
      <TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} multiline accessibilityLabel="Notas (opcional)" label="Notas (opcional)" value={draft.notes} onChangeText={notes => setDraft({ ...draft, notes })} /><View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.muted}>Total de la compra</Text><Text style={styles.total}>{currency(draft.lines.reduce((sum, line) => sum.plus(lineTotal(line)), new Decimal(0)))}</Text></View></> : null}
    </Form>
    <Form visible={!!receipt} title="Recibir compra y registrar lotes" onDismiss={() => setReceipt(null)} onSave={() => void receive()} saving={busy || ws.isSaving} disabled={!available} error={receiptError} submitLabel="Confirmar recepción">
      <Notice>La recepción completa agrega las existencias en cocina y registra el lote de cada ingrediente. El pago se registra por separado en Resumen.</Notice>
      <TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} accessibilityLabel="Lote del proveedor (opcional)" label="Lote del proveedor (opcional)" value={batchCode} onChangeText={setBatchCode} maxLength={100} />
      <TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} accessibilityLabel="Fabricación (AAAA-MM-DD, opcional)" label="Fabricación (AAAA-MM-DD, opcional)" value={manufacturedOn} onChangeText={setManufacturedOn} placeholder="2026-10-22" />
      {manufacturedOn && validDate(manufacturedOn) ? <Text style={styles.muted}>Vencimiento a cuatro meses: {dateLabel(expiryFourMonths(manufacturedOn))}</Text> : null}
      <Notice>Dejá la fecha vacía si no conocés la fabricación real: el lote quedará con fecha estimada, identificada como tal. Si los insumos tienen fechas diferentes, registrá recepciones separadas.</Notice>
    </Form>
    <Confirm visible={!!confirm} title={confirm?.operation === 'receive_purchase' ? 'Recibir compra completa' : 'Cancelar compra'} body={confirm?.operation === 'receive_purchase' ? 'Se sumarán todos los ingredientes al stock de cocina una sola vez. La compra recibida ya no se podrá editar ni cancelar.' : 'La compra quedará cancelada y no ingresará ningún ingrediente al stock. Esta acción no se puede deshacer.'} onDismiss={() => setConfirm(null)} onConfirm={() => void transition()} loading={busy || ws.isSaving} disabled={!available} />
  </Page>;
}
