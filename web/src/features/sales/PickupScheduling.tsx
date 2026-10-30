import React, { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace';
import { pendingPickups, pickupClosure } from '@shared/lib/pickupScheduling';
import { pickupLocations } from '@shared/lib/calendar';
import { formatDate, isValidDate, money } from '@shared/lib/format';
import type { Location, Order } from '@shared/lib/types';
import { Button, Field, Modal, Notice, Panel, errorText } from './ui';

export function RescheduleOrderButton({ order, onRescheduled }: { order: Order; onRescheduled?: (date: string) => void }) {
  const ws = useWorkspace(); const [open, setOpen] = useState(false); const [date, setDate] = useState(order.pickup_date); const [shortage, setShortage] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const disabled = !ws.isConfigured || !ws.isOnline || !ws.data || ws.isSaving || busy;
  const closure = pickupClosure(ws.data?.pickup_closures, order.location_id, date, ws.data?.locations.find(entry => entry.id === order.location_id));
  const save = async (allow = false) => {
    if (disabled) return;
    if (!isValidDate(date) || date === order.pickup_date) return setError('Elegí una fecha válida diferente al retiro actual.');
    if (closure) return setError(`El punto está cerrado el ${formatDate(date)}. ${closure.reason || ''}`);
    setBusy(true); setError('');
    try { await ws.command('reschedule_order', { id: order.id, pickup_date: date, ...(allow ? { allow_stock_shortage: true } : {}) }, order.version); setOpen(false); setShortage(false); onRescheduled?.(date); }
    catch (e) { if (errorText(e).includes('STOCK_CONFIRMATION_REQUIRED')) { setShortage(true); setError('La cobertura de stock y producción no alcanza para esta fecha. Revisá el día o confirmá con faltantes.'); } else setError(errorText(e)); } finally { setBusy(false); }
  };
  if (order.status !== 'pendiente_entrega') return null;
  return <><Button disabled={disabled} onClick={() => { setDate(order.pickup_date); setError(''); setShortage(false); setOpen(true); }}><CalendarDays size={15}/>Cambiar día de retiro</Button>{open && <Modal title="Cambiar día de retiro" onDismiss={() => setOpen(false)} onSave={() => void save(shortage)} saving={busy || ws.isSaving} disabled={!ws.isConfigured || !ws.isOnline} error={error} submitLabel={shortage ? 'Reprogramar con faltantes' : 'Cambiar día'}><p className="text-sm">Retiro actual: {formatDate(order.pickup_date)} {order.pickup_time?.slice(0, 5)}</p><Notice>Solo cambia el día. Se conservan punto, hora, productos, precios históricos, cobros y preparación.</Notice><Field label="Nuevo día de retiro" type="date" value={date} onChange={event => { setDate(event.target.value); setShortage(false); setError(''); }}/>{closure && <Notice error>Sin retiros: {closure.reason || 'Día cerrado.'}</Notice>}{(ws.data?.pickup_closures ?? []).filter(entry => entry.location_id === order.location_id && entry.closed !== false).length > 0 && <p className="text-xs text-stone-500">Días cerrados: {(ws.data?.pickup_closures ?? []).filter(entry => entry.location_id === order.location_id && entry.closed !== false).map(entry => formatDate(entry.pickup_date)).join(' · ')}</p>}</Modal>}</>;
}
function LocationDay({ day, location }: { day: string; location: Location }) {
  const ws = useWorkspace(); const [editing, setEditing] = useState(false); const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [busy, setBusy] = useState(false);
  const closure = pickupClosure(ws.data?.pickup_closures, location.id, day, location); const pending = pendingPickups(ws.data?.orders ?? [], location.id, day); const disabled = !ws.isConfigured || !ws.isOnline || !ws.data || ws.isSaving || busy;
  const save = async (closed: boolean) => {
    if (disabled) return;
    if (closed && pending.length) return setError('Reprogramá todos los pedidos pendientes antes de cerrar este día.');
    setBusy(true); setError(''); setSuccess('');
    try { await ws.command('set_pickup_closure', { location_id: location.id, pickup_date: day, closed, ...(closed ? { reason: reason.trim() } : {}) }, ws.data?.pickup_closures?.find(entry => entry.location_id === location.id && entry.pickup_date === day)?.version ?? 0); setEditing(false); setReason(''); setSuccess(`${location.name}: retiros ${closed ? 'cancelados' : 'habilitados'}.`); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <div className="grid gap-3 rounded-xl border border-stone-100 border-l-4 p-4" style={{ borderLeftColor: location.color }}><div className="flex flex-wrap items-center justify-between gap-2"><strong style={{ color: location.color }}>{location.name}</strong>{closure ? <Button disabled={disabled} onClick={() => void save(false)}>Habilitar retiros</Button> : <Button disabled={disabled} onClick={() => { setEditing(!editing); setError(''); setSuccess(''); }}>{editing ? 'Volver' : 'Cancelar retiros'}</Button>}</div>{closure && <Notice error>Sin retiros el {formatDate(day)}: {closure.reason || 'Día cerrado.'}</Notice>}{editing && !closure && <><p className="text-sm text-stone-500">El cierre no elimina ni cancela pedidos. Reprogramalos primero.</p><Field label={`Motivo del cierre de ${location.name} (opcional)`} value={reason} onChange={event => setReason(event.target.value)} multiline/>{pending.length ? <><Notice error>Hay {pending.length} pedidos pendientes que necesitan otra fecha.</Notice>{pending.map(order => <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{ws.data?.clients.find(client => client.id === order.client_id)?.name ?? 'Sin cliente'} · {money(order.total)}</span><RescheduleOrderButton order={order}/></div>)}</> : <p className="text-sm text-stone-500">No hay pedidos pendientes.</p>}<Button primary disabled={disabled || pending.length > 0} onClick={() => void save(true)}>Confirmar cierre de retiros</Button></>}{error && <Notice error>{error}</Notice>}{success && <Notice>{success}</Notice>}</div>;
}
export function PickupClosuresPanel({ day }: { day: string }) {
  const ws = useWorkspace(); const locations = pickupLocations(ws.data?.locations ?? []).filter(location => ws.data?.profile?.role !== 'responsable' || location.id === ws.data.profile.location_id).filter(location => location.active !== false || pickupClosure(ws.data?.pickup_closures, location.id, day, location));
  return <Panel><h3 className="mb-2 text-lg font-bold">Disponibilidad de retiros</h3><p className="mb-4 text-sm text-stone-500">{formatDate(day)} · Domingos: todos cerrados por defecto. Sábados: solo Mendieta habilitado. Podés habilitar cada punto manualmente; los pedidos existentes se conservan.</p><div className="grid gap-3">{locations.map(location => <LocationDay key={`${location.id}-${day}`} day={day} location={location}/>)}</div></Panel>;
}
