import { useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Banknote, ChartNoAxesCombined, Download, Plus, RefreshCw } from 'lucide-react';
import Decimal from '@shared/lib/decimal';
import { downloadFile, downloadText } from '@/lib/exportFile';
import { useWorkspace } from '@/lib/workspace';
import { buildXlsx } from '@shared/lib/xlsx';
import { monthlyReport, snapshotCsv, reportWorksheets } from '@shared/lib/reports';
import { dailySummary } from '@shared/lib/daily';
import { formatDate, isValidDate, money, monthLabel, today } from '@shared/lib/format';
import type { FinancialMovement, PaymentMethod } from '@shared/lib/types';
import OperationalReports from './OperationalReports';
import CashCollectionsPanel from './CashCollectionsPanel';
import FinanceAnalytics from './FinanceAnalytics';
import { Badge, Button, Card, Empty, Field, Metric, Modal, Note, Select, Table, Textarea, errorText } from './ui';

type FinanceForm = 'expense' | 'reverse' | null;
const methodNames: Record<PaymentMethod, string> = { transferencia: 'Transferencia', efectivo: 'Efectivo', desconocido: 'Sin especificar', gratis: 'Gratis' };
const kindNames = { payment: 'Cobro', expense: 'Egreso', refund: 'Reintegro', reversal: 'Reversión' };

export default function ReportsScreen() {
  const workspace = useWorkspace();
  const { data } = workspace;
  const writable = workspace.isConfigured && workspace.isOnline && !workspace.error && data?.profile?.role === 'admin';
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [dailyDate, setDailyDate] = useState(today);
  const [selectedLocation, setLocation] = useState('all');
  const location = data?.profile?.role === 'responsable' ? data.profile.location_id ?? 'no-location' : selectedLocation;
  const [from, setFrom] = useState(() => `${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [cashFrom, setCashFrom] = useState(() => `${today().slice(0, 7)}-01`);
  const [cashTo, setCashTo] = useState(today);
  const [product, setProduct] = useState('all');
  const [client, setClient] = useState('all');
  const [status, setStatus] = useState('all');
  const [inactivityDays, setInactivityDays] = useState('30');
  const filters = useMemo(() => ({ from, to, product, client, status, location }), [from, to, product, client, status, location]);
  const [form, setForm] = useState<FinanceForm>(null);
  const [selected, setSelected] = useState<FinancialMovement | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('transferencia');
  const [category, setCategory] = useState('Gastos generales');
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ledgerLimit, setLedgerLimit] = useState(30);
  const commandInFlight = useRef(false);
  const exportInFlight = useRef(false);
  const report = useMemo(() => data ? monthlyReport(data, month, location) : null, [data, month, location]);
  const daily = useMemo(() => data && isValidDate(dailyDate) ? dailySummary(data, dailyDate, location) : null, [data, dailyDate, location]);
  const monthlyGratis = (data?.orders ?? []).filter(order => order.pickup_date.startsWith(`${month}-`) && (location === 'all' || order.location_id === location) && order.payment_method === 'gratis' && order.status !== 'cancelado' && !order.returned_at);
  function changeMonth(delta: number) { const value = new Date(`${month}-15T12:00:00Z`); value.setUTCMonth(value.getUTCMonth() + delta); setMonth(value.toISOString().slice(0, 7)); setLedgerLimit(30); }
  function expense() { setForm('expense'); setSelected(null); setError(''); setAmount(''); setNotes(''); setDate(today()); setMethod('transferencia'); setCategory('Gastos generales'); }
  async function save() {
    if (!writable || workspace.isSaving || commandInFlight.current) return;
    setError('');
    try {
      let payload: Record<string, unknown>;
      if (form === 'reverse') {
        if (!selected || !notes.trim()) throw new Error('Ingresá el motivo de reversión.');
        payload = { id: selected.id, reason: notes.trim() };
      } else {
        const normalized = amount.trim().replace(',', '.');
        if (!/^\d+(?:\.\d+)?$/.test(normalized) || new Decimal(normalized).lte(0)) throw new Error('Ingresá un importe mayor a cero.');
        if (new Decimal(normalized).decimalPlaces() > 2) throw new Error('El importe admite dos decimales.');
        if (!isValidDate(date)) throw new Error('Ingresá una fecha válida.');
        if (!category.trim()) throw new Error('Ingresá una categoría.');
        payload = { amount: new Decimal(normalized).toString(), method, category: category.trim(), occurred_on: date, notes: notes.trim() };
      }
      commandInFlight.current = true; setBusy(true);
      await workspace.command(form === 'reverse' ? 'reverse_financial_movement' : 'record_expense', payload);
      setForm(null); setNotice('Movimiento guardado. El original y sus reversiones conservan trazabilidad.');
    } catch (caught) { setError(errorText(caught)); } finally { commandInFlight.current = false; setBusy(false); }
  }
  async function reconcile(movement: FinancialMovement) {
    if (!writable || workspace.isSaving || commandInFlight.current) return;
    commandInFlight.current = true; setBusy(true); setError('');
    try { await workspace.command('reconcile_movement', { id: movement.id, reconciled: !movement.reconciled }, movement.version); setNotice(movement.reconciled ? 'Conciliación desmarcada.' : 'Movimiento marcado como conciliado.'); }
    catch (caught) { setError(errorText(caught)); }
    finally { commandInFlight.current = false; setBusy(false); }
  }
  async function exportData(kind: 'json' | 'csv' | 'xlsx') {
    if (!data || exportInFlight.current || (kind === 'json' && !writable)) return;
    exportInFlight.current = true; setExporting(true); setError('');
    try {
      if (kind === 'json') {
        const full = await workspace.exportData();
        const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(full)));
        const payload_hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        await downloadText(`pedidos-stock-respaldo-${today()}.json`, JSON.stringify({ ...full, integrity: { algorithm: 'SHA-256', payload_hash } }, null, 2) + '\n', 'application/json;charset=utf-8');
      } else if (kind === 'xlsx') {
        if (!isValidDate(from) || !isValidDate(to) || !isValidDate(dailyDate) || from > to || !/^\d+$/.test(inactivityDays) || !Number.isSafeInteger(Number(inactivityDays))) throw new Error('Revisá las fechas y el umbral de días antes de exportar.');
        if (!isValidDate(cashFrom) || !isValidDate(cashTo) || cashFrom > cashTo) throw new Error('Revisá el período de cobros en efectivo antes de exportar.');
        await downloadFile(`KALAK-informes-${month}.xlsx`, buildXlsx(reportWorksheets(data, month, filters, Number(inactivityDays), dailyDate, { from: cashFrom, to: cashTo, location })), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      } else await downloadText(`pedidos-stock-${today()}.csv`, snapshotCsv(data), 'text/csv;charset=utf-8');
      setNotice(kind === 'json' ? 'Respaldo completo descargado desde el servidor.' : kind === 'xlsx' ? 'Excel descargado con todas las hojas, criterios y filtros del informe.' : 'CSV descargado con los datos del último estado sincronizado.');
    } catch (caught) { setError(errorText(caught)); } finally { exportInFlight.current = false; setExporting(false); }
  }
  const place = (id: string) => data?.locations.find(entry => entry.id === id)?.name ?? id;
  return <div className="mx-auto grid w-full max-w-[1440px] gap-6 text-stone-900">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-700">Una mirada a tu negocio</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Ventas, caja e informes</h1><p className="mt-3 max-w-xl text-sm leading-relaxed text-stone-500">Números claros para seguir creciendo. Cada entrega y cada cobro tienen su propio registro.</p></div><div className="flex flex-wrap gap-2"><Button secondary aria-label="Actualizar informes" disabled={workspace.isRefreshing || !workspace.isOnline} onClick={() => void workspace.refresh()}><RefreshCw size={16} className={workspace.isRefreshing ? 'animate-spin' : ''} />Actualizar</Button><Button disabled={!writable || busy || workspace.isSaving} onClick={expense}><Plus size={17} />Registrar egreso</Button></div></header>
    {!writable ? <Note>Modo consulta. Egresos, reversiones y conciliación requieren administración con conexión. Los informes pueden mostrar el último estado sincronizado.{!workspace.isOnline ? ' Estás sin conexión.' : ''}</Note> : null}
    {workspace.error ? <Note error>{errorText(workspace.error)}</Note> : null}{error && !form ? <Note error>{error}</Note> : null}{notice ? <Note>{notice}</Note> : null}
    <Card><div className="flex flex-wrap items-end justify-between gap-5"><div className="flex items-end gap-2"><Button secondary aria-label="Mes anterior" onClick={() => changeMonth(-1)}><ArrowLeft size={17} /></Button><Field label="Mes del informe" type="month" required value={month} onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value)) { setMonth(event.target.value); setLedgerLimit(30); } }} /><Button secondary aria-label="Mes siguiente" onClick={() => changeMonth(1)}><ArrowRight size={17} /></Button></div><div className="min-w-56 flex-1 sm:max-w-sm"><Select label="Punto de retiro" value={location} onChange={setLocation} disabled={data?.profile?.role === 'responsable'} options={[...(data?.profile?.role !== 'responsable' ? [{ value: 'all', label: 'Todos los puntos' }] : []), ...(data?.locations ?? []).filter(entry => entry.is_pickup !== false && (data?.profile?.role !== 'responsable' || entry.id === data.profile.location_id)).map(entry => ({ value: entry.id, label: `${entry.name}${entry.active === false ? ' (histórico)' : ''}` }))]} /></div><Button secondary disabled={!data || exporting} onClick={() => void exportData('xlsx')}><Download size={16} />{exporting ? 'Preparando…' : 'Exportar Excel'}</Button></div></Card>
    {!report || !data ? <Card>{workspace.isLoading ? <p role="status" className="py-12 text-center text-stone-500">Cargando informes…</p> : <Empty title="Sin datos sincronizados" description="Conectá el servidor para consultar tus números." />}</Card> : <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Importe de pedidos del mes" value={money(report.total)} caption="Por retiro · sin cancelados, devueltos ni importes gratuitos" /><Metric label="Ventas entregadas" value={money(report.delivered)} caption="Por retiro · no equivale a cobrado" /><Metric label="Cobros netos del mes" value={money(report.collections)} caption="Por fecha real del movimiento · reintegros y reversiones incluidos" /><Metric label="Pendiente de cobro" value={money(report.receivableTotal)} caption="Saldo actual de todos los períodos, no solo de este mes" /></div>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-[#faf5ec] px-5 py-4 text-sm"><ChartNoAxesCombined size={20} className="text-orange-700" /><span className="font-semibold">{report.count} pedidos válidos</span><span className="text-stone-300">/</span><span>{report.uniqueClients} clientes únicos</span><span className="text-stone-300">/</span><span>{report.deliveredCount} entregados</span><span className="text-stone-300">/</span><span>{report.pendingCount} pendientes</span><p className="w-full text-xs text-stone-500">Una venta anónima cuenta como operación, no como cliente. Las muestras gratis cuentan en cantidades y pedidos, no en ventas ni deuda.</p></div>
      <div className="grid items-start gap-6 xl:grid-cols-[1.4fr_1fr]"><Card title="Evolución de pedidos" caption={`${monthLabel(month)} · importe histórico por fecha de retiro, sin cancelados ni devueltos`}><SalesChart days={report.days} />{report.days.length ? <details className="mt-4"><summary className="cursor-pointer text-sm text-orange-700">Ver importes por día</summary><div className="mt-4"><Table headers={['Retiro', 'Importe']} rows={report.days.map(day => ({ key: day.date, cells: [formatDate(day.date), money(day.total)] }))} /></div></details> : null}</Card><Card title="Comparación por punto" caption="Incluye puntos históricos del período."><div className="grid gap-5">{report.byLocation.map(entry => {
        const maximum = Math.max(1, ...report.byLocation.map(point => Number(point.total)));
        return <div key={entry.id}><div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2 font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />{entry.name}</span><span className="font-semibold">{money(entry.total)}</span></div><div className="h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full" style={{ width: `${Number(entry.total) / maximum * 100}%`, backgroundColor: entry.color }} /></div><p className="mt-2 text-xs text-stone-500">{entry.count} pedidos · {entry.uniqueClients} clientes · {entry.deliveredCount} entregados · {entry.pendingCount} pendientes</p></div>;
      })}{!report.byLocation.length ? <Empty title="Sin puntos para comparar." /> : null}</div></Card></div>
      <Card title="Resumen diario" caption="Independiente del mes superior. Usa el día elegido y el filtro de punto actual."><div className="mb-5 max-w-xs"><Field label="Día a consultar" type="date" required value={dailyDate} onChange={event => setDailyDate(event.target.value)} /></div>{daily ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Pedidos del día" value={String(daily.count)} caption={`Importe ${money(daily.sales)} · entregado ${money(daily.delivered)}`} /><Metric label="Cobros netos del día" value={money(daily.collections)} caption="Fecha efectiva de cobro / reintegro" /><Metric label="Egresos netos del día" value={money(daily.expenses)} caption="Gastos y pagos efectivamente registrados" /><Metric label="Flujo de caja del día" value={money(daily.cashNet)} caption="Cobros menos egresos; no es utilidad" /></div> : <Note error>Elegí una fecha válida para consultar el resumen diario.</Note>}</Card>
      <div className="grid items-start gap-6 xl:grid-cols-2"><Card title="Ingresos y egresos" caption="Caja por fecha efectiva del movimiento, no por fecha de retiro."><div className="mb-5 grid gap-3 sm:grid-cols-2"><Metric label="Egresos netos" value={money(report.expenses)} caption={location === 'all' ? 'Gastos y pagos registrados' : 'Egresos generales solo en Todos los puntos'} /><Metric label="Flujo neto" value={money(report.cashNet)} caption="Cobros menos egresos, no utilidad" /></div><Table headers={['Medio', 'Cobros netos', 'Flujo neto']} rows={report.byPaymentMethod.map(entry => ({ key: entry.method, cells: [methodNames[entry.method], money(entry.collections), money(entry.net)] }))} /><div className="mt-4"><Note>La caja contiene solo movimientos reales. Los cobros se registran en el pedido. Gratis no es un medio de cobro: este mes hay {monthlyGratis.length} operaciones gratuitas sin venta ni deuda.</Note></div></Card><Card title="Productos del mes" caption="Pedidos válidos por retiro: incluye pendientes, entregados y regalos. Para ventas efectivas, ver Productos vendidos por punto y mes."><Table headers={['Producto', 'Cantidad', 'Importe']} rows={report.products.map(entry => ({ key: entry.id, cells: [entry.name, `${entry.units} ${entry.unit}`, money(entry.total)] }))} /><div className="mt-4 flex items-center justify-between border-t border-stone-200 pt-4 font-semibold"><span>Total general</span><span>{money(report.total)}</span></div><p className="mt-3 text-xs leading-relaxed text-stone-500">Pendientes de entrega {money(report.pending)} · Cancelados {money(report.cancelled)} · Devueltos {money(report.returned)}</p></Card></div>
      <FinanceAnalytics data={data} month={month} location={location} />
      <CashCollectionsPanel data={data} from={cashFrom} to={cashTo} location={location} onFrom={setCashFrom} onTo={setCashTo} onLocation={setLocation} />
      <Card title="Cuentas pendientes y saldos a favor" caption="Saldo actual por pedido, de todos los períodos. No se compensan deudas con anticipos de otros pedidos."><Table headers={['Cliente / pedido', 'Retiro / punto', 'Total', 'Cobrado neto', 'Saldo']} rows={report.receivables.map(entry => ({ key: entry.order.id, cells: [<span className="font-medium">{entry.client}<span className="mt-1 block text-xs font-normal text-stone-400">#{entry.order.id.slice(0, 8)}{entry.order.returned_at ? ' · Devuelto' : entry.order.status === 'cancelado' ? ' · Cancelado' : ''}</span></span>, <span>{formatDate(entry.order.pickup_date)}<span className="mt-1 block text-xs text-stone-500">{place(entry.order.location_id)}</span></span>, money(entry.order.payment_method === 'gratis' ? '0' : entry.order.total), money(entry.paid), new Decimal(entry.credit).gt(0) ? <span className="font-medium text-orange-700">A devolver / a favor {money(entry.credit)}</span> : <span className="font-semibold text-red-700">Debe {money(entry.pending)}</span>] }))} empty="Sin saldos pendientes registrados." /></Card>
      <Card title="Entregados pendientes de cobro" caption="Entrega confirmada no equivale a cobro. Se consultan todos los períodos."><Table headers={['Cliente', 'Pedido', 'Retiro', 'Punto', 'Pendiente']} rows={report.deliveredUnpaid.map(entry => ({ key: entry.order.id, cells: [entry.client, `#${entry.order.id.slice(0, 8)}`, formatDate(entry.order.pickup_date), place(entry.order.location_id), <span className="font-semibold text-red-700">{money(entry.pending)}</span>] }))} empty="Sin deuda en pedidos entregados." /></Card>
      <OperationalReports data={data} month={month} filters={filters} onChange={next => { setFrom(next.from); setTo(next.to); setProduct(next.product); setClient(next.client); setStatus(next.status); }} inactivityDays={inactivityDays} onInactivityDays={setInactivityDays} />
      <Card title="Conciliación de caja" caption="Compará con banco o efectivo y marcá solo lo verificado. Los originales no se borran."><Table headers={['Movimiento', 'Fecha / medio', 'Referencia', 'Importe firmado', 'Conciliación']} rows={[...report.movements].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at)).slice(0, ledgerLimit).map(movement => {
        const reversed = (data.financial_movements ?? []).some(row => row.reverses_id === movement.id);
        return { key: movement.id, cells: [<span className="font-medium">{kindNames[movement.kind]}<span className="mt-1 block text-xs font-normal text-stone-500">{movement.category || 'Sin categoría'}</span></span>, <span className="whitespace-nowrap">{formatDate(movement.occurred_on)}<span className="mt-1 block text-xs text-stone-500">{methodNames[movement.method]}{movement.transfer_name ? ` · ${movement.transfer_name}` : ''}</span></span>, <div className="min-w-40 text-xs text-stone-500"><p className="whitespace-pre-wrap">{movement.notes || 'Sin nota'}</p>{movement.order_id ? <p className="mt-1">Pedido #{movement.order_id.slice(0, 8)}</p> : null}{movement.purchase_id ? <p className="mt-1">Compra #{movement.purchase_id.slice(0, 8)}</p> : null}</div>, <span className={`whitespace-nowrap font-semibold ${new Decimal(movement.amount).lt(0) ? 'text-red-700' : ''}`}>{money(movement.amount)}</span>, <div className="grid min-w-44 gap-2"><Badge warm={movement.reconciled}>{movement.reconciled ? 'Conciliado' : 'Sin conciliar'}</Badge><Button secondary disabled={!writable || workspace.isSaving || busy} onClick={() => void reconcile(movement)}>{movement.reconciled ? 'Desmarcar conciliación' : 'Marcar conciliado'}</Button>{!reversed && !movement.reverses_id ? <Button danger disabled={!writable || workspace.isSaving || busy} onClick={() => { setSelected(movement); setNotes(''); setError(''); setForm('reverse'); }}>Revertir con motivo</Button> : <span className="text-xs text-stone-400">{reversed ? 'Revertido' : 'Contramovimiento'}</span>}</div>] };
      })} empty="Sin movimientos de caja este mes." />{report.movements.length > ledgerLimit ? <Button secondary className="mt-4" onClick={() => setLedgerLimit(limit => limit + 30)}>Ver más movimientos de caja</Button> : null}</Card>
      <Card title="Tu información, siempre tuya" caption="Exportaciones portables con criterios explícitos y valores históricos."><div className="grid gap-4 lg:grid-cols-3"><ExportCard icon="excel" title="Informes en Excel" text="Libro .xlsx real con todas las hojas del informe y sus filtros actuales." label="Descargar Excel (.xlsx)" disabled={exporting} action={() => void exportData('xlsx')} /><ExportCard icon="csv" title="Datos para planillas" text="CSV con separador ;. Catálogo, pedidos, caja, stock, compras y lotes del último estado sincronizado en tu alcance." label="Descargar datos CSV" disabled={exporting} action={() => void exportData('csv')} /><ExportCard icon="json" title="Respaldo completo" text="JSON actualizado desde el servidor, con control SHA-256 para recuperación. Solo administración con conexión." label="Descargar respaldo JSON" disabled={!writable || exporting} action={() => void exportData('json')} /></div><p className="mt-5 text-xs text-stone-500">Última sincronización: {formatDate(data.updated_at)}. {exporting ? 'Preparando descarga…' : 'Los textos se exportan como datos inertes, sin fórmulas ejecutables.'}</p></Card>
    </>}
    {form ? <Modal title={form === 'reverse' ? 'Revertir movimiento de caja' : 'Registrar egreso'} close={() => setForm(null)} save={() => void save()} busy={busy || workspace.isSaving} disabled={!writable} error={error} submitLabel={form === 'reverse' ? 'Crear reversión' : 'Registrar egreso'}>{form === 'expense' ? <><Field label="Importe ($)" required inputMode="decimal" placeholder="0,00" value={amount} onChange={event => setAmount(event.target.value)} /><Select label="Medio de pago" options={[{ value: 'transferencia', label: 'Transferencia' }, { value: 'efectivo', label: 'Efectivo' }]} value={method} onChange={value => setMethod(value as PaymentMethod)} /><Field label="Categoría" required value={category} onChange={event => setCategory(event.target.value)} /><Field label="Fecha del pago" type="date" required value={date} onChange={event => setDate(event.target.value)} /><Textarea label="Notas / comprobante" value={notes} onChange={setNotes} /><Note>Se registra una salida de dinero. No modifica existencias ni el estado de un pedido.</Note></> : <><Note>El original no se borra. Se crea un contramovimiento de igual importe con signo opuesto.</Note><p className="text-sm">{selected ? `${formatDate(selected.occurred_on)} · ${money(selected.amount)} · ${kindNames[selected.kind]}` : ''}</p><Textarea label="Motivo obligatorio" required value={notes} onChange={setNotes} /></>}</Modal> : null}
  </div>;
}

function SalesChart({ days }: { days: { date: string; total: string }[] }) {
  if (!days.length) return <Empty title="Este mes no tiene pedidos" description="La evolución aparece con los pedidos del período." />;
  const max = Math.max(1, ...days.map(day => Number(day.total)));
  return <div className="overflow-x-auto"><div role="img" aria-label="Importes de pedidos por fecha de retiro. Ver la tabla por día para el detalle." className="flex h-52 min-w-72 items-end gap-2 border-b border-stone-200 px-2 pt-3">{days.map(day => <div key={day.date} className="group flex h-full min-w-3 flex-1 flex-col justify-end gap-2 text-center" title={`${formatDate(day.date)}: ${money(day.total)}`}><div className="relative mx-auto w-full max-w-12 rounded-t bg-orange-300 transition group-hover:bg-orange-500" style={{ height: `${Math.max(2, Number(day.total) / max * 85)}%` }} /><span className="pb-2 text-[10px] text-stone-500">{day.date.slice(8)}</span></div>)}</div></div>;
}

function ExportCard({ icon, title, text, label, disabled, action }: { icon: string; title: string; text: string; label: string; disabled: boolean; action: () => void }) {
  return <div className="flex flex-col items-start rounded-xl border border-stone-200 bg-stone-50/50 p-5"><div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-800">{icon === 'json' ? <Banknote size={20} /> : <ArrowDownToLine size={20} />}</div><h3 className="font-semibold">{title}</h3><p className="mt-2 mb-5 flex-1 text-sm leading-relaxed text-stone-500">{text}</p><Button secondary disabled={disabled} onClick={action}>{label}</Button></div>;
}
