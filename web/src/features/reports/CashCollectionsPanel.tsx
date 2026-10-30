import { useMemo } from 'react';
import { cashCollectionsReport } from '@shared/lib/reports';
import { formatDate, isValidDate, money } from '@shared/lib/format';
import type { Snapshot } from '@shared/lib/types';
import { Card, Empty, Field, Metric, Note, Select, Table } from './ui';

export default function CashCollectionsPanel({ data, from, to, location, onFrom, onTo, onLocation }: { data: Snapshot; from: string; to: string; location: string; onFrom: (value: string) => void; onTo: (value: string) => void; onLocation: (value: string) => void }) {
  const valid = isValidDate(from) && isValidDate(to) && from <= to;
  const report = useMemo(() => valid ? cashCollectionsReport(data, from, to, location) : null, [data, from, to, location, valid]);
  const restricted = data.profile?.role === 'responsable';
  const locations = data.locations.filter(point => point.is_pickup !== false && (!restricted || point.id === data.profile?.location_id));
  return <Card title="Cobros reales en efectivo" caption="Solo dinero efectivamente recibido en efectivo, menos reintegros y reversiones. No incluye importes previstos, saldos impagos, transferencias ni egresos.">
    <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Efectivo desde" type="date" required value={from} onChange={event => onFrom(event.target.value)} /><Field label="Efectivo hasta" type="date" required value={to} onChange={event => onTo(event.target.value)} /><Select label="Punto de cobros en efectivo" value={location} onChange={onLocation} disabled={restricted} options={[...(!restricted ? [{ value: 'all', label: 'Todos los puntos' }] : []), ...locations.map(point => ({ value: point.id, label: `${point.name}${point.active === false ? ' (histórico)' : ''}` }))]} /></div>
    <p className="mb-5 text-xs text-stone-500">Ambas fechas incluidas, según la fecha real del movimiento; independiente del mes y del retiro del pedido. El punto se comparte con los demás informes de la página.</p>
    {report ? <div className="grid min-w-0 grid-cols-1 gap-5">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3"><Metric label="Efectivo recibido" value={money(report.received)} /><Metric label="Reintegros y reversiones de efectivo" value={money(report.refunds)} /><Metric label="Efectivo neto cobrado" value={money(report.net)} /></div>
      {!report.entries.length ? <Empty title="Sin cobros en efectivo para este período y punto." /> : null}
      <div className="min-w-0"><h3 className="mb-3 text-sm font-semibold">Efectivo por punto</h3><Table headers={['Punto', 'Recibido', 'Reintegrado / revertido', 'Neto']} rows={report.byLocation.map(point => ({ key: point.id ?? 'unassigned', cells: [point.name, money(point.received), money(point.refunds), <strong>{money(point.net)}</strong>] }))} empty="Sin cobros en efectivo para este período y punto." /></div>
      <details className="min-w-0"><summary className="cursor-pointer text-sm font-semibold text-orange-700">Ver detalle de efectivo ({report.entries.length} movimientos)</summary><div className="mt-4 min-w-0"><Table headers={['Fecha real', 'Movimiento', 'Punto', 'Cliente / pedido', 'Importe firmado', 'Nota']} rows={report.entries.map(entry => ({ key: entry.id, cells: [formatDate(entry.occurred_on), entry.kind === 'payment' ? 'Cobro en efectivo' : entry.kind === 'refund' ? 'Reintegro en efectivo' : 'Reversión en efectivo', entry.location_name, <span>{entry.client}{entry.order_id ? <span className="mt-1 block text-xs text-stone-500">#{entry.order_id.slice(0, 8)}</span> : null}</span>, money(entry.amount), entry.notes || 'Sin nota'] }))} /></div></details>
    </div> : <Note error>Elegí fechas válidas de efectivo: desde debe ser anterior o igual a hasta.</Note>}
  </Card>;
}
