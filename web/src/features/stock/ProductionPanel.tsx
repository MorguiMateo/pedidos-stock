import { useMemo, useState } from 'react';
import { Plus, CalendarDays, CheckCircle2 } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace';
import { productionNeeds } from '@shared/lib/productionPlanning';
import { validSaleQuantity } from '@shared/lib/availability';
import type { ProductionPlan } from '@shared/lib/types';
import { Button, Card, Empty, Input, Modal, Note, Select, Title, d, errorText, formatDate, isValidDate, numberValue, qty, today } from './ui';

type Draft = { mode: 'save' | 'cancel' | 'reconcile'; plan?: ProductionPlan; product_id: string; quantity: string; available_on: string; notes: string; actual: string };
export default function ProductionPanel() {
  const ws = useWorkspace();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState(false);
  const writable = ws.data?.profile?.role === 'admin' && ws.isOnline && ws.isConfigured && !ws.error;
  const products = (ws.data?.items ?? []).filter(p => p.kind === 'product' && p.active);
  const plans = ws.data?.production_plans ?? [];
  const needs = useMemo(() => ws.data ? productionNeeds(ws.data) : [], [ws.data]);
  const product = (id: string) => ws.data?.items.find(p => p.id === id);
  function open(mode: Draft['mode'], plan?: ProductionPlan) {
    setError(''); setDraft({ mode, plan, product_id: plan?.product_id ?? '', quantity: plan?.quantity ?? '', available_on: plan?.available_on ?? today(), notes: plan?.notes ?? '', actual: plan?.fulfilled_quantity ?? '0' });
  }
  async function save() {
    if (!draft || !writable || busy || ws.isSaving) return;
    setBusy(true); setError('');
    try {
      if (draft.mode === 'save') {
        const item = product(draft.product_id);
        if (!item?.active || item.kind !== 'product') throw new Error('Elegí un producto activo.');
        if (!isValidDate(draft.available_on)) throw new Error('Elegí una fecha válida.');
        if (!validSaleQuantity(draft.quantity, item.unit)) throw new Error(`Ingresá una cantidad positiva ${item.unit === 'kg' ? 'con hasta tres decimales' : 'en unidades enteras'}.`);
        await ws.command('save_production_plan', { ...(draft.plan ? { id: draft.plan.id } : {}), product_id: item.id, quantity: numberValue(draft.quantity, 'Cantidad prevista', { positive: true }), available_on: draft.available_on, notes: draft.notes.trim() }, draft.plan?.version);
        setNotice('Producción prevista guardada. No se modificó el inventario físico.');
      } else if (draft.plan && draft.mode === 'cancel') {
        await ws.command('cancel_production_plan', { id: draft.plan.id }, draft.plan.version);
        setNotice('Previsión cancelada. Se recalcularon las reservas y los faltantes.');
      } else if (draft.plan) {
        const actual = numberValue(draft.actual, 'Cantidad real total', { integer: product(draft.product_id)?.unit === 'unidad' });
        if (d(actual).lt(draft.plan.fulfilled_quantity)) throw new Error('El total real no puede ser menor que los ingresos ya vinculados.');
        await ws.command('reconcile_production_plan', { id: draft.plan.id, actual_quantity: actual }, draft.plan.version);
        setNotice('Previsión cerrada. Revisá los faltantes; el cierre no agrega stock físico.');
      }
      setDraft(null);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <div className="space-y-5">
    {notice && <Note>{notice}</Note>}
    <Note>Las previsiones no son stock físico. Registrá los productos elaborados con un ingreso en el punto que los recibe: se descontarán automáticamente de la previsión. Los traslados se registran por separado.</Note>
    <Card><Title caption="Disponibilidad futura de cocina central" action={<Button disabled={!writable || ws.isSaving || busy} onClick={() => open('save')}><Plus size={16} />Prever producción</Button>}>Producción prevista</Title>
      {!plans.some(p => p.status === 'planificado') && <Empty title="Sin producción prevista">Elegí un producto, cantidad y fecha de disponibilidad.</Empty>}
      <div className="grid gap-4 lg:grid-cols-2">{[...plans].filter(p => history || p.status === 'planificado').sort((a, b) => a.available_on.localeCompare(b.available_on) || a.created_at.localeCompare(b.created_at)).map(plan => {
        const item = product(plan.product_id);
        return <article key={plan.id} className="rounded-xl border border-line p-4"><div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{item?.name ?? 'Producto'}</h3><span className={`rounded-lg px-2 py-1 text-xs ${plan.status === 'planificado' ? 'bg-orange-50 text-orange-800' : 'bg-stone-100 text-stone-500'}`}>{plan.status === 'planificado' ? 'Previsto' : plan.status === 'cancelado' ? 'Cancelado' : 'Finalizado'}</span></div><p className="my-3 flex items-center gap-2 text-sm text-stone-500"><CalendarDays size={15} />{formatDate(plan.available_on)}</p><div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-stone-500">Previsto</p><strong>{qty(plan.quantity)} {item?.unit}</strong></div><div><p className="text-xs text-stone-500">Ingresado en puntos</p><strong>{qty(plan.fulfilled_quantity)} {item?.unit}</strong></div>{plan.status === 'planificado' && <><div><p className="text-xs text-stone-500">Reservado para pedidos</p><strong>{qty(plan.allocated_quantity ?? '0')} {item?.unit}</strong></div><div><p className="text-xs text-stone-500">Disponible futuro</p><strong className="text-emerald-700">{qty(plan.available_quantity ?? '0')} {item?.unit}</strong></div></>}</div>{plan.actual_quantity != null && <p className="mt-3 text-sm text-stone-600">Real total: {qty(plan.actual_quantity)} {item?.unit}</p>}{plan.notes && <p className="mt-3 text-sm text-stone-500">{plan.notes}</p>}{writable && plan.status === 'planificado' && <div className="mt-4 flex flex-wrap gap-2"><Button secondary disabled={ws.isSaving || busy} onClick={() => open('save', plan)}>Editar</Button><Button secondary disabled={ws.isSaving || busy} onClick={() => open('reconcile', plan)}>Cerrar con cantidad real</Button><Button danger disabled={ws.isSaving || busy} onClick={() => open('cancel', plan)}>Cancelar previsión</Button></div>}</article>;
      })}</div><div className="mt-5"><Button secondary onClick={() => setHistory(!history)}>{history ? 'Ocultar finalizadas y canceladas' : 'Ver finalizadas y canceladas'}</Button></div>
    </Card>
    <Card><Title caption="Solo pedidos pendientes. Cada unidad física o futura se compromete una sola vez.">Qué llevar a cada punto</Title>{!needs.length ? <Empty title="Sin pedidos por abastecer">Las necesidades se calculan con los pedidos pendientes y su reserva física real.</Empty> : <div className="space-y-4">{needs.map(need => { const item = product(need.product_id); const location = ws.data?.locations.find(p => p.id === need.location_id); return <article key={`${need.product_id}/${need.location_id}/${need.date}`} className="rounded-xl border border-line p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{item?.name} · necesita recibir {qty(need.needs_receive)} {item?.unit}</h3><span className="text-xs font-semibold" style={{ color: location?.color }}>{location?.name} · {formatDate(need.date)}</span></div><div className="my-3 grid grid-cols-2 gap-3 text-sm text-stone-600 sm:grid-cols-4"><div>Pedidos: <strong>{qty(need.committed)}</strong></div><div>Reserva física: <strong>{qty(need.physical_reserved)}</strong></div><div>Stock del punto: <strong>{qty(need.physical)}</strong></div><div>Reserva futura: <strong>{qty(need.future_reserved)}</strong></div></div>{d(need.shortage).gt(0) ? <Note error>Faltan {qty(need.shortage)} {item?.unit} sin cobertura para el {formatDate(need.date)}. Aumentá la previsión o revisá el abastecimiento.</Note> : <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={16} />Pedido cubierto{d(need.needs_receive).gt(0) ? '; pendiente de recibir producción' : ' con stock en el punto'}</p>}</article>; })}</div>}</Card>
    {draft && <Modal title={draft.mode === 'cancel' ? 'Cancelar previsión' : draft.mode === 'reconcile' ? 'Cerrar producción prevista' : draft.plan ? 'Editar previsión' : 'Prever producción'} close={() => setDraft(null)} save={() => void save()} busy={busy || ws.isSaving} disabled={!writable} error={error} submitLabel={draft.mode === 'cancel' ? 'Confirmar cancelación' : 'Guardar'}>
      {draft.mode === 'save' ? <><Select label="Producto" value={draft.product_id} onChange={product_id => setDraft({ ...draft, product_id })} options={products.map(p => ({ value: p.id, label: `${p.name} (${p.unit})` }))} /><Input label={`Cantidad prevista (${product(draft.product_id)?.unit ?? 'unidad comercial'})`} value={draft.quantity} numeric onChange={quantity => setDraft({ ...draft, quantity })} /><Input label="Disponible desde" type="date" value={draft.available_on} onChange={available_on => setDraft({ ...draft, available_on })} /><Input label="Notas (opcional)" value={draft.notes} multiline onChange={notes => setDraft({ ...draft, notes })} /></> : draft.mode === 'reconcile' ? <><Note>Primero registrá los ingresos reales en Stock de cada punto. Este cierre retira el remanente previsto y no agrega inventario.</Note><Input label={`Cantidad real total (${product(draft.product_id)?.unit ?? 'unidad'})`} numeric value={draft.actual} onChange={actual => setDraft({ ...draft, actual })} /><p className="text-sm">Ya ingresado y vinculado: {qty(draft.plan?.fulfilled_quantity ?? '0')} {product(draft.product_id)?.unit}</p></> : <Note error>Se quitará la disponibilidad futura de {product(draft.product_id)?.name}. Los pedidos se conservarán y mostrarán cualquier faltante resultante.</Note>}
    </Modal>}
  </div>;
}
