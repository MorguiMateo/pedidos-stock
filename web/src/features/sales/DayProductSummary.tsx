import { dailyProductSummary } from '@shared/lib/calendar';
import { formatDate } from '@shared/lib/format';
import { formulaFirst, productAbbreviation, saleQuantity } from './orderPresentation';
import { Panel } from './ui';

type Summary = ReturnType<typeof dailyProductSummary>;

function ProductList({ products, label }: { products: Summary['products']; label: string }) {
  return <ul aria-label={label} className="mt-3 grid gap-2 text-sm">{formulaFirst(products).map(item => <li key={`${item.product_id}-${item.unit}`} className="flex justify-between gap-4"><strong>{saleQuantity(item.quantity)}{item.unit !== 'unidad' ? ` ${item.unit}` : ''} X {productAbbreviation(item.name)}</strong></li>)}</ul>;
}

export default function DayProductSummary({ summary, day }: { summary: Summary; day: string }) {
  return <Panel>
    <h2 className="text-lg font-bold">Total del día por producto</h2>
    <p className="mt-1 text-xs leading-relaxed text-stone-500">{formatDate(day)} · {summary.count} pedidos válidos. Incluye pendientes y entregados, pagados o no, y regalos. Excluye cancelados y devueltos. Muestra el día completo del punto seleccionado; no cambia con los filtros de cliente, producto, pago, entrega o preparación.</p>
    {summary.products.length ? <div className="mt-4 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div className="rounded-xl bg-[#fff1de] p-4"><h3 className="text-sm font-bold">Total general · puntos seleccionados</h3><ProductList products={summary.products} label="Unidades totales del día en todos los puntos seleccionados" /></div>
      {summary.byLocation.map(point => <div key={point.location_id} className="rounded-xl border border-stone-100 p-4"><h3 className="text-sm font-bold" style={{ color: point.color }}>{point.name} · {point.count} {point.count === 1 ? 'pedido' : 'pedidos'}</h3><ProductList products={point.products} label={`Unidades totales del día en ${point.name}`} /></div>)}
    </div> : <p className="mt-4 text-sm text-stone-400">Sin productos en pedidos válidos para este día.</p>}
  </Panel>;
}
