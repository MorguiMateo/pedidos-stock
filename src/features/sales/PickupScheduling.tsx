import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { Calendar } from 'react-native-calendars';
import { pickupLocations, shiftCalendarDate } from '../../lib/calendar';
import { pendingPickups, pickupClosure } from '../../lib/pickupScheduling';
import type { Location, Order } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { calendarTheme, Confirm, currency, dateLabel, errorText, Form, Notice, Panel, styles, validDate } from './components';

export function RescheduleOrderButton({ order, onRescheduled }: { order: Order; onRescheduled?: (date: string) => void }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(order.pickup_date);
  const [calendarMonth, setCalendarMonth] = useState(order.pickup_date);
  const [shortageConfirmation, setShortageConfirmation] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const available = ws.isConfigured && ws.isOnline;
  const location = ws.data?.locations.find(entry => entry.id === order.location_id);
  const closure = pickupClosure(ws.data?.pickup_closures, order.location_id, date, location);
  const markedDates: Record<string, { disabled?: boolean; disableTouchEvent?: boolean; selected?: boolean }> = {};
  for (let offset = -7; offset < 42; offset++) {
    const day = shiftCalendarDate(`${calendarMonth.slice(0, 7)}-01`, offset, 'day');
    if (pickupClosure(ws.data?.pickup_closures, order.location_id, day, location)) markedDates[day] = { disabled: true, disableTouchEvent: true };
  }
  markedDates[date] = { ...markedDates[date], selected: true };
  const save = async (allowStockShortage = false) => {
    if (!available || busy || ws.isSaving) return;
    if (!validDate(date)) return setError('Seleccioná una fecha válida.');
    if (date === order.pickup_date) return setError('Elegí un día diferente al retiro actual.');
    if (closure) return setError(`${location?.name ?? 'Este punto'} no tiene retiros el ${dateLabel(date)}. ${closure.reason || 'Día cerrado.'}`);
    setBusy(true); setError('');
    try {
      await ws.command('reschedule_order', { id: order.id, pickup_date: date, ...(allowStockShortage ? { allow_stock_shortage: true } : {}) }, order.version);
      setOpen(false); setShortageConfirmation(false);
      onRescheduled?.(date);
    } catch (e) { if (errorText(e).includes('STOCK_CONFIRMATION_REQUIRED')) { setError('No hay stock suficiente para hoy. Confirmá si querés reprogramar igualmente con faltantes.'); setShortageConfirmation(true); } else setError(errorText(e)); } finally { setBusy(false); }
  };
  if (order.status !== 'pendiente_entrega') return null;
  return <>
    <Button icon="calendar-edit" disabled={!available || ws.isSaving || busy} onPress={() => { setDate(order.pickup_date); setCalendarMonth(order.pickup_date); setError(''); setShortageConfirmation(false); setOpen(true); }}>Cambiar día de retiro</Button>
    <Form visible={open} title="Cambiar día de retiro" onDismiss={() => { setOpen(false); setShortageConfirmation(false); }} onSave={() => void save()} saving={busy || ws.isSaving} disabled={!available} error={error} submitLabel="Cambiar día">
      <Text style={styles.muted}>{ws.data?.clients.find(client => client.id === order.client_id)?.name ?? 'Cliente'} · {location?.name ?? 'Punto de retiro'}</Text>
      <Text style={styles.muted}>Retiro actual: {dateLabel(order.pickup_date)}{order.pickup_time ? ` · ${order.pickup_time}` : ''}</Text>
      <Notice>Solo cambia el día. Se conservan el punto, la hora, los productos, precios, cobros y demás datos del pedido.</Notice>
      <Calendar key={`${order.id}-${open}`} current={date} firstDay={1} theme={calendarTheme} markedDates={markedDates} onMonthChange={month => setCalendarMonth(month.dateString)} onDayPress={day => { setDate(day.dateString); setError(''); setShortageConfirmation(false); }} />
      <Text style={styles.label}>Nuevo retiro: {dateLabel(date)}</Text>
      {closure ? <Notice error>{location?.name ?? 'Punto de retiro'} · {dateLabel(date)} · Sin retiros: {closure.reason || 'Día cerrado.'}</Notice> : null}
      <Text style={styles.muted}>Los días cerrados de este punto no están disponibles.</Text>
    </Form>
    <Confirm visible={open && shortageConfirmation} title="Stock insuficiente para hoy" body="Podés revisar la fecha o reprogramar igualmente con faltantes. Se conservan los productos, los precios históricos y los cobros de este pedido." confirmLabel="Reprogramar con faltantes" dismissLabel="Revisar fecha" onDismiss={() => setShortageConfirmation(false)} onConfirm={() => { setShortageConfirmation(false); void save(true); }} loading={busy || ws.isSaving} disabled={!available} />
  </>;
}

function PickupLocationDay({ day, location }: { day: string; location: Location }) {
  const ws = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const closure = pickupClosure(ws.data?.pickup_closures, location.id, day, location);
  const pending = pendingPickups(ws.data?.orders ?? [], location.id, day);
  const disabled = !ws.isConfigured || !ws.isOnline || ws.isSaving || busy;
  const setClosed = async (closed: boolean) => {
    if (disabled) return;
    if (closed && pending.length) return setError('Reprogramá todos los pedidos pendientes antes de cerrar este día.');
    setBusy(true); setError(''); setSuccess('');
    try {
      await ws.command('set_pickup_closure', { location_id: location.id, pickup_date: day, closed, ...(closed ? { reason: reason.trim() } : {}) }, ws.data?.pickup_closures?.find(entry => entry.location_id === location.id && entry.pickup_date === day)?.version ?? 0);
      setEditing(false); setReason('');
      setSuccess(`${location.name} · ${dateLabel(day)}: ${closed ? 'retiros cancelados' : 'retiros habilitados'}.`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <View style={[styles.lineCard, { borderLeftWidth: 5, borderLeftColor: location.color }]}>
    <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
      <Text variant="titleSmall" style={{ flex: 1, color: location.color, fontWeight: '700' }}>{location.name}</Text>
      {closure ? <Button icon="calendar-check-outline" disabled={disabled} loading={busy} onPress={() => void setClosed(false)}>Habilitar retiros</Button> : <Button icon="calendar-remove-outline" disabled={disabled} onPress={() => { setEditing(!editing); setError(''); setSuccess(''); }}>{editing ? 'Volver' : 'Cancelar retiros'}</Button>}
    </View>
    {closure ? <Notice error>{location.name} · {dateLabel(day)} · Sin retiros: {closure.reason || 'Día cerrado.'}</Notice> : null}
    {editing && !closure ? <>
      <Text style={styles.muted}>Cancelar los retiros de {location.name} el {dateLabel(day)} no elimina ni cancela pedidos.</Text>
      <TextInput mode="outlined" label="Motivo del cierre (opcional)" accessibilityLabel={`Motivo del cierre de ${location.name}`} value={reason} onChangeText={setReason} disabled={disabled} multiline />
      {pending.length ? <>
        <Notice error>Hay {pending.length} {pending.length === 1 ? 'pedido pendiente' : 'pedidos pendientes'} en {location.name} el {dateLabel(day)}. Cambiá su día de retiro para poder cerrar.</Notice>
        {pending.map(order => <View key={order.id} style={{ gap: 4 }}>
          <Text style={styles.label}>{ws.data?.clients.find(client => client.id === order.client_id)?.name ?? 'Cliente'} · #{order.id.slice(0, 8)} · {currency(order.total)}</Text>
          <RescheduleOrderButton order={order} />
        </View>)}
      </> : <Text style={styles.muted}>No hay pedidos pendientes. Ya podés cerrar este día.</Text>}
      <Button mode="contained" icon="calendar-remove-outline" disabled={disabled || pending.length > 0} loading={busy} onPress={() => void setClosed(true)}>Confirmar cierre de retiros</Button>
    </> : null}
    {error ? <Notice error>{error}</Notice> : null}
    {success ? <Notice>{success}</Notice> : null}
  </View>;
}

export function PickupClosuresPanel({ day }: { day: string }) {
  const ws = useWorkspace();
  const locations = pickupLocations(ws.data?.locations ?? []).filter(location => ws.data?.profile?.role !== 'responsable' || location.id === ws.data.profile.location_id).filter(location => location.active !== false || pickupClosure(ws.data?.pickup_closures, location.id, day, location));
  if (!locations.length) return null;
  return <Panel>
    <Text variant="titleMedium">Retiros · {dateLabel(day)}</Text>
    <Text style={styles.muted}>Administrá los puntos disponibles para este día. Domingos: todos cerrados por defecto. Sábados: solo Mendieta habilitado. Podés cambiar cada día; los pedidos existentes se conservan. Antes de cerrar manualmente, reprogramá los pendientes.</Text>
    {locations.map(location => <PickupLocationDay key={`${location.id}-${day}`} location={location} day={day} />)}
  </Panel>;
}
