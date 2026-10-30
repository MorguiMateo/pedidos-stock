import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { Calendar } from 'react-native-calendars';
import { useWorkspace } from '../../lib/workspace';
import { productionNeeds } from '../../lib/productionPlanning';
import { validSaleQuantity } from '../../lib/availability';
import type { ProductionPlan } from '../../lib/types';
import { COLORS, calendarTheme } from '../../lib/theme';
import { Action, Blank, Card, Form, Heading, Input, Note, Options, Page, Title, d, dateLabel, dateToday, errorText, numberValue, qty, s, validDate } from '../stock/featureUi';

type PlanForm = { mode: 'save' | 'cancel' | 'reconcile'; plan?: ProductionPlan; product_id: string; quantity: string; available_on: string; notes: string; actual: string };

export default function ProductionScreen({ embedded = false }: { embedded?: boolean }) {
  const ws = useWorkspace();
  const [form, setForm] = useState<PlanForm | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const writable = ws.data?.profile?.role === 'admin' && ws.isOnline && ws.isConfigured && !ws.error;
  const products = (ws.data?.items ?? []).filter(item => item.kind === 'product' && item.active);
  const plans = ws.data?.production_plans ?? [];
  const needs = useMemo(() => ws.data ? productionNeeds(ws.data) : [], [ws.data]);
  const product = (id: string) => ws.data?.items.find(item => item.id === id);
  const place = (id: string) => ws.data?.locations.find(location => location.id === id);
  function open(mode: PlanForm['mode'], plan?: ProductionPlan) {
    setError(''); setCalendar(false);
    setForm({ mode, plan, product_id: plan?.product_id ?? '', quantity: plan ? qty(plan.quantity) : '', available_on: plan?.available_on ?? dateToday(), notes: plan?.notes ?? '', actual: plan ? qty(plan.fulfilled_quantity) : '0' });
  }
  async function save() {
    if (!form || !writable || ws.isSaving) return;
    setError('');
    try {
      if (form.mode === 'save') {
        const item = product(form.product_id);
        if (!item?.active || item.kind !== 'product') throw new Error('Elegí un producto activo.');
        if (!validDate(form.available_on)) throw new Error('Elegí una fecha válida.');
        if (!validSaleQuantity(form.quantity, item.unit)) throw new Error(`Ingresá una cantidad positiva ${item.unit === 'kg' ? 'con hasta tres decimales' : 'en unidades enteras'}.`);
        await ws.command('save_production_plan', { ...(form.plan ? { id: form.plan.id } : {}), product_id: item.id, quantity: numberValue(form.quantity, 'Cantidad prevista', { positive: true }), available_on: form.available_on, notes: form.notes.trim() }, form.plan?.version);
        setNotice('Producción prevista guardada. No se modificó el inventario físico.');
      } else if (form.plan && form.mode === 'cancel') {
        await ws.command('cancel_production_plan', { id: form.plan.id }, form.plan.version);
        setNotice('Previsión cancelada. Se recalcularon las reservas y los faltantes.');
      } else if (form.plan) {
        const actual = numberValue(form.actual, 'Cantidad real total', { integer: product(form.plan.product_id)?.unit === 'unidad' });
        if (d(actual).lt(form.plan.fulfilled_quantity)) throw new Error('El total real no puede ser menor que los ingresos ya vinculados.');
        await ws.command('reconcile_production_plan', { id: form.plan.id, actual_quantity: actual }, form.plan.version);
        setNotice('Previsión cerrada. Revisá los faltantes de los pedidos; el cierre no agrega stock físico.');
      }
      setForm(null);
    } catch (caught) { setError(errorText(caught)); }
  }
  const content = <>
    <Heading eyebrow="COCINA CENTRAL" title="Producción prevista" subtitle="Planificá disponibilidad y abastecimiento por punto de retiro." action={writable ? <Action icon="plus" onPress={() => open('save')}>Prever producción</Action> : undefined} />
    {ws.error ? <Note error>{errorText(ws.error)}</Note> : null}
    {notice ? <Note>{notice}</Note> : null}
    <Note>Las previsiones no son stock físico. Cargá los productos elaborados directamente en el punto que los recibe; esos ingresos descuentan la previsión automáticamente. Los traslados siempre se registran por separado.</Note>
    <Card><Title>Disponibilidad futura</Title>
      {!plans.some(plan => plan.status === 'planificado') ? <Blank title="Sin producción prevista" text="Elegí un producto, cantidad y fecha de disponibilidad. La unidad se toma del catálogo." /> : null}
      {[...plans].filter(plan => showHistory || plan.status === 'planificado').sort((a, b) => a.available_on.localeCompare(b.available_on) || a.created_at.localeCompare(b.created_at)).map(plan => {
        const item = product(plan.product_id);
        return <View key={plan.id} style={s.line}>
          <Text style={s.smallTitle}>{item?.name ?? 'Producto'} · {dateLabel(plan.available_on)}</Text>
          <Text>Previsto: {qty(plan.quantity)} {item?.unit} · Ingresado: {qty(plan.fulfilled_quantity)} {item?.unit}</Text>
          {plan.status === 'planificado' ? <><Text>Reservado para pedidos: {qty(plan.allocated_quantity ?? '0')} {item?.unit}</Text><Text style={{ color: COLORS.success }}>Disponible para nuevos pedidos: {qty(plan.available_quantity ?? '0')} {item?.unit}</Text></> : <Text style={s.caption}>{plan.status === 'cancelado' ? 'Cancelado' : 'Finalizado'}</Text>}
          {plan.notes ? <Text style={s.caption}>{plan.notes}</Text> : null}
          {writable && plan.status === 'planificado' ? <View style={s.wrap}><Button onPress={() => open('save', plan)}>Editar</Button><Button onPress={() => open('reconcile', plan)}>Cerrar con cantidad real</Button><Button textColor={COLORS.danger} onPress={() => open('cancel', plan)}>Cancelar previsión</Button></View> : null}
        </View>;
      })}
      <Button onPress={() => setShowHistory(value => !value)}>{showHistory ? 'Ocultar finalizadas y canceladas' : 'Ver finalizadas y canceladas'}</Button>
    </Card>
    <Card><Title caption="Solo pedidos pendientes. Cada unidad física o futura se compromete una sola vez.">Qué llevar a cada punto</Title>
      {!needs.length ? <Blank title="Sin pedidos por abastecer" text="Las necesidades se calculan con los pedidos pendientes y su reserva física real." /> : needs.map(need => {
        const item = product(need.product_id);
        const location = place(need.location_id);
        return <View key={`${need.product_id}/${need.location_id}/${need.date}`} style={s.line}>
          <Text style={[s.smallTitle, { color: location?.color }]}>{location?.name ?? need.location_id} · {dateLabel(need.date)}</Text>
          <Text style={s.smallTitle}>{item?.name ?? 'Producto'}: necesita recibir {qty(need.needs_receive)} {item?.unit}</Text>
          <Text>Pedidos: {qty(need.committed)} {item?.unit} · Reserva física: {qty(need.physical_reserved)} {item?.unit}</Text>
          <Text style={s.caption}>Stock físico actual en el punto: {qty(need.physical)} {item?.unit} · Cubierto con producción futura: {qty(need.future_reserved)} {item?.unit}</Text>
          {d(need.shortage).gt(0) ? <Note error>Faltan {qty(need.shortage)} {item?.unit} sin cobertura para el {dateLabel(need.date)}. Aumentá la previsión o revisá el abastecimiento antes de esa fecha.</Note> : <Text style={{ color: COLORS.success }}>✓ Pedido cubierto{d(need.needs_receive).gt(0) ? '; pendiente de recibir producción' : ' con stock en el punto'}</Text>}
        </View>;
      })}
    </Card>
    <Form visible={form !== null} title={form?.mode === 'cancel' ? 'Cancelar previsión' : form?.mode === 'reconcile' ? 'Cerrar producción prevista' : 'Prever producción'} close={() => setForm(null)} save={() => void save()} saving={ws.isSaving} disabled={!writable} error={error} submitLabel={form?.mode === 'cancel' ? 'Confirmar cancelación' : 'Guardar'}>
      {form?.mode === 'save' ? <>
        <Options label="Producto" values={products.map(item => ({ value: item.id, label: item.name }))} value={form.product_id} onChange={product_id => setForm({ ...form, product_id })} />
        <Input label={`Cantidad prevista (${product(form.product_id)?.unit ?? 'unidad del producto'})`} value={form.quantity} onChange={quantity => setForm({ ...form, quantity })} numeric />
        <Button icon="calendar-outline" onPress={() => setCalendar(value => !value)}>Disponible desde: {dateLabel(form.available_on)}</Button>
        {calendar ? <Calendar current={form.available_on} firstDay={1} onDayPress={day => { setForm({ ...form, available_on: day.dateString }); setCalendar(false); }} markedDates={{ [form.available_on]: { selected: true, selectedColor: COLORS.primary } }} theme={calendarTheme} /> : null}
        <Input label="Notas (opcional)" value={form.notes} onChange={notes => setForm({ ...form, notes })} multiline />
      </> : form?.mode === 'reconcile' ? <>
        <Note>Primero registrá los ingresos reales en Stock de cada punto. Luego cerrá esta previsión con el total elaborado. El remanente previsto deja de estar disponible y se muestran los compromisos sin cubrir. Este cierre no agrega inventario.</Note>
        <Input label={`Cantidad real total (${product(form.product_id)?.unit ?? 'unidad'})`} value={form.actual} onChange={actual => setForm({ ...form, actual })} numeric />
        <Text>Ya ingresado y vinculado: {qty(form.plan?.fulfilled_quantity ?? '0')} {product(form.product_id)?.unit}</Text>
      </> : <Note error>Se quitará la disponibilidad futura de esta previsión. Los pedidos existentes se conservarán y mostrarán cualquier faltante resultante.</Note>}
    </Form>
  </>;
  return embedded ? <View style={{ gap: 20 }}>{content}</View> : <Page refresh={ws.refresh} loading={ws.isLoading}>{content}</Page>;
}
