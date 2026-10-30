import { useMemo, useState } from 'react';
import { breakEven, consumptionForecast, financeHistory, financeMonth, parseBreakEvenDrafts, type BreakEvenInputs } from '@shared/lib/financeAnalytics';
import { formatDate, money, monthLabel } from '@shared/lib/format';
import type { Snapshot } from '@shared/lib/types';
import { Card, Empty, Field, Metric, Note, Select, Table } from './ui';

type Props = { data: Snapshot; month: string; location: string };
const comparisonOptions = [{ value: 'revenue', label: 'Ventas entregadas ($)' }, { value: 'orders', label: 'Pedidos válidos' }, { value: 'clients', label: 'Clientes únicos con pedido' }, { value: 'averageTicket', label: 'Ticket promedio ($)' }];
export default function FinanceAnalytics({ data, month, location }: Props) {
  const report = useMemo(() => financeMonth(data, month, location), [data, month, location]);
  const history = useMemo(() => financeHistory(data, month, location), [data, month, location]);
  const forecast = useMemo(() => consumptionForecast(data, month, location), [data, month, location]);
  const [selectedDate, setDate] = useState('');
  const [comparison, setComparison] = useState('revenue');
  const [productKey, setProduct] = useState('');
  const day = report.days.find(day => day.date === selectedDate) ?? report.days.find(day => day.count > 0) ?? report.days[0];
  const product = forecast.rows.find(row => row.key === productKey) ?? forecast.rows[0];
  const metric = (row: (typeof history)[number]) => comparison === 'orders' ? row.orders : comparison === 'clients' ? row.clients : comparison === 'averageTicket' ? row.averageTicket : row.revenue;
  const amountMetric = comparison === 'revenue' || comparison === 'averageTicket';
  const maximum = Math.max(1, ...history.map(row => Number(metric(row) ?? 0)));
  const forecastMax = Math.max(1, ...product?.values.map(Number) ?? [], Number(product?.forecast ?? 0));
  const weekdayOffset = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  return <>
    <div className="grid gap-4 sm:grid-cols-2"><Metric label="Ticket promedio mensual" value={report.averageTicket === null ? 'Sin ventas entregadas' : money(report.averageTicket)} caption={`${report.sales} pedidos entregados no gratis · importe facturado / pedidos · no equivale a cobros`} /><Metric label="Clientes únicos del mes" value={String(report.clients)} caption="Por ID de cliente con pedido válido; una persona cuenta una vez en el total aunque retire en dos puntos. Anónimos excluidos." /></div>
    <Card title="Calendario financiero de pedidos" caption="Fecha de retiro · incluye pendientes y entregados, sin cancelados ni devueltos. Los números son pedidos, no cobros.">
      <p className="mb-4 font-semibold first-letter:uppercase">{monthLabel(month)}</p>
      <div className="overflow-x-auto"><div className="grid min-w-[560px] grid-cols-7 gap-1" aria-label={`Pedidos de ${monthLabel(month)}`}>
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(name => <div key={name} className="p-2 text-center text-xs font-medium text-stone-500">{name}</div>)}
        {Array.from({ length: weekdayOffset }, (_, index) => <div key={`empty-${index}`} />)}
        {report.days.map(date => <button type="button" key={date.date} aria-pressed={day?.date === date.date} aria-label={`${formatDate(date.date)}: ${date.count} pedidos`} onClick={() => setDate(date.date)} className={`min-h-24 rounded-xl border p-2 text-left align-top transition-colors ${day?.date === date.date ? 'border-orange-300 bg-orange-50 shadow-[inset_0_0_0_1px_var(--color-orange-300)]' : 'border-line hover:bg-paper'}`}><span className="mb-1 block text-sm font-semibold">{Number(date.date.slice(8))}</span>{date.points.map(point => <span key={point.id} className="mb-1 flex items-center gap-1 text-[11px]"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: point.color }} /><span className="truncate">{point.name}: {point.count}</span></span>)}</button>)}
      </div></div>
      {day ? <div className="mt-5"><h3 className="mb-3 font-semibold">{formatDate(day.date)} · {day.count} pedidos</h3><Table headers={['Punto', 'Pedidos del día']} rows={day.points.map(point => ({ key: point.id, cells: [point.name, point.count] }))} empty="Sin pedidos válidos en este día." /></div> : null}
    </Card>
    <Card title="Productos vendidos por punto y mes" caption="Solo entregados · cantidades e importe histórico facturado por fecha de retiro. Los regalos/muestras se separan y las unidades diferentes no se suman."><Table headers={['Punto', 'Producto', 'Vendidos', 'Regalos / muestras', 'Importe']} rows={report.products.map(row => ({ key: row.key, cells: [row.location, row.name, `${row.sold} ${row.unit}`, `${row.gifts} ${row.unit}`, money(row.revenue)] }))} empty="Sin productos entregados este mes." /></Card>
    <Card title="Clientes y ticket por punto" caption="Clientes con pedido válido del mes (incluye pendientes), deduplicados dentro de cada punto. Ticket: ventas entregadas no gratis / pedidos entregados no gratis."><Table headers={['Punto', 'Clientes únicos', 'Pedidos válidos', 'Ventas entregadas', 'Ticket promedio']} rows={report.points.map(point => ({ key: point.id, cells: [point.name, point.clients, point.orders, money(point.revenue), point.averageTicket === null ? '—' : money(point.averageTicket)] }))} /><p className="mt-3 text-xs text-stone-500">No sumes clientes de distintos puntos: un mismo cliente puede aparecer en más de uno. Total único del mes: {report.clients}.</p></Card>
    <Card title="Comparación mes a mes" caption="Seis meses por fecha de retiro y punto seleccionado. El mes en curso puede estar incompleto. Los meses sin pedidos tienen cero; ticket sin ventas se muestra sin datos.">
      <div className="mb-5 max-w-xs"><Select label="Métrica a comparar" options={comparisonOptions} value={comparison} onChange={setComparison} /></div>
      <div className="grid gap-4" role="img" aria-label={`Comparación mensual de ${comparisonOptions.find(option => option.value === comparison)?.label}`}>
        {history.map(row => { const value = metric(row); return <div key={row.month}><div className="mb-1 flex justify-between gap-3 text-sm"><span>{monthLabel(row.month)}</span><strong className="tabular-nums">{value === null ? 'Sin datos' : amountMetric ? money(String(value)) : value}</strong></div><div className="h-3 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full bg-orange-500" style={{ width: `${Number(value ?? 0) / maximum * 100}%` }} /></div></div>; })}
      </div>
    </Card>
    <Card title="Pronóstico de consumo" caption={`Estimación para ${monthLabel(forecast.forecastMonth)}: promedio simple de ${forecast.months.map(monthLabel).join(', ')}. Solo meses completos; incluye meses en cero después de la primera entrega. No predice estacionalidad ni garantiza demanda.`}>
      {!product ? <Empty title="Sin historial de consumo en meses completos." /> : <><div className="mb-5 max-w-md"><Select label="Producto del pronóstico" value={product.key} onChange={setProduct} options={forecast.rows.map(row => ({ value: row.key, label: `${row.name} (${row.unit})` }))} /></div><div className="grid grid-cols-4 gap-3" role="img" aria-label={`Consumo mensual de ${product.name} en ${product.unit}, y promedio proyectado`}>
        {[...product.values, product.forecast].map((value, index) => <div key={index} className="flex min-w-0 flex-col gap-2 text-center"><p className="text-sm font-semibold">{value === null ? 'Sin datos' : `${value} ${product.unit}`}</p><div className="flex h-36 items-end rounded bg-paper px-4"><div className={`w-full rounded-t ${index === 3 ? 'border-2 border-dashed border-orange-500 bg-orange-100' : 'bg-stone-400'}`} style={{ height: `${value === null ? 0 : Number(value) / forecastMax * 100}%` }} /></div><span className="text-xs text-stone-500">{index === 3 ? `Estimado ${forecast.forecastMonth}` : forecast.months[index]}</span></div>)}
      </div><p className="mt-4 text-sm text-stone-600">{product.forecast === null ? 'Historial insuficiente: se necesitan tres meses completos desde la primera entrega observada de este producto y unidad.' : `Consumo estimado: ${product.forecast} ${product.unit}. Demanda física entregada, incluidos regalos; no descuenta stock.`}</p></>}
    </Card>
    <BreakEvenPanel key={data.profile?.id ?? 'local'} data={data} />
  </>;
}

function BreakEvenPanel({ data }: { data: Snapshot }) {
  const storageKey = `kalak.break-even.v1.${data.profile?.id ?? 'local'}`;
  const [drafts, setDrafts] = useState<Record<string, BreakEvenInputs>>(() => { try { return parseBreakEvenDrafts(localStorage.getItem(storageKey)); } catch { return {}; } });
  const [storageError, setStorageError] = useState(false);
  function update(id: string, value: BreakEvenInputs) {
    const next = { ...drafts, [id]: value }; setDrafts(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); }
  }
  const products = data.items.filter(item => item.kind === 'product');
  return <Card title="Punto de equilibrio por producto" caption="Simulación por mes y unidad comercial. Ingresá el costo fijo asignado a cada producto, su costo variable unitario y precio. No se inventan costos. Los escenarios se guardan solo en este navegador, no se sincronizan.">
    {storageError ? <Note error>No se pudo guardar el escenario en este dispositivo. Los cálculos siguen disponibles durante esta sesión.</Note> : null}
    {!products.length ? <Empty title="Agregá productos para calcular su equilibrio." /> : <div className="grid gap-4">{products.map(item => {
      const inputs = drafts[item.id] ?? { fixed: '', variable: '', price: item.price };
      const result = breakEven(inputs);
      return <details key={item.id} className="rounded-xl border border-line p-4"><summary className="cursor-pointer font-semibold">{item.name} · {item.unit}{!item.active ? ' · Archivado' : ''}</summary><div className="mt-4 grid gap-4 sm:grid-cols-3">{([{ key: 'fixed', label: 'Costo fijo mensual asignado ($)' }, { key: 'variable', label: `Costo variable por ${item.unit} ($)` }, { key: 'price', label: `Precio por ${item.unit} ($)` }] as const).map(field => <Field key={field.key} label={`${field.label} · ${item.name}`} inputMode="decimal" value={inputs[field.key]} onChange={event => update(item.id, { ...inputs, [field.key]: event.target.value })} />)}</div><div className="mt-4 text-sm">{result.error ? <p className="text-stone-600">{result.error}</p> : <p className="font-semibold">Equilibrio: {item.unit === 'unidad' ? result.units : result.exactUnits} {item.unit} / mes</p>}{result.contribution !== null ? <p className="mt-2">Contribución: {money(result.contribution)} / {item.unit} · Margen de contribución: {result.margin}%</p> : null}</div><p className="mt-3 text-xs text-stone-500">Fórmula: costo fijo asignado / (precio − costo variable). Redondeo hacia arriba: unidades enteras o 0,01 para otras unidades. Distribuí los costos fijos entre productos para no contarlos dos veces. No es una utilidad real ni usa la caja como costo.</p></details>;
    })}</div>}
  </Card>;
}
