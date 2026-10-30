import Decimal from '@shared/lib/decimal';
import { validSaleQuantity } from '@shared/lib/availability';
import { linePrice } from '@shared/lib/calendar';
import type { Client, Item, Order } from '@shared/lib/types';

/** Database numerics arrive at a fixed scale, unlike editable commercial quantities. */
export function saleQuantity(value: Decimal.Value): string {
  return new Decimal(value).toFixed();
}

/** Stable operational abbreviations; unknown products keep their full historical name. */
export function productAbbreviation(name: string) {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/formula.*perr|perr.*formula/.test(normalized)) return 'FP';
  if (/formula.*gat|gat.*formula/.test(normalized)) return 'FG';
  if (/caldo|colageno/.test(normalized)) return 'CC';
  if (/vinagre/.test(normalized)) return 'VIN';
  if (/semilla/.test(normalized)) return 'SEM';
  if (/calcio/.test(normalized)) return 'K';
  if (/bolsa/.test(normalized)) return 'BOL';
  return name;
}

export function formulaFirst<T extends { name: string }>(products: readonly T[]): T[] {
  const rank = (name: string) => { const code = productAbbreviation(name); return code === 'FP' ? 0 : code === 'FG' ? 1 : 2; };
  return [...products].sort((a, b) => rank(a.name) - rank(b.name));
}

export function orderProducts(order: Pick<Order, 'lines'>, products: Item[] = []): string {
  const lines = order.lines.map(line => ({ ...line, name: line.product_name ?? products.find(item => item.id === line.product_id)?.name ?? 'Producto no disponible' }));
  return formulaFirst(lines).map(line => { const unit = line.product_unit ?? products.find(item => item.id === line.product_id)?.unit ?? 'unidad'; return `${saleQuantity(line.quantity)}${unit === 'unidad' ? '' : ` ${unit}`} X ${productAbbreviation(line.name)}${line.is_gift ? ' · Regalo' : ''}`; }).join('\n');
}

export function latestClientOrder(orders: readonly Order[], clientId: string) {
  if (!clientId) return undefined;
  return orders.filter(order => order.client_id === clientId && order.status !== 'cancelado' && !order.returned_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0];
}

/** Business-day cutoff is Mendoza time, independent of the device timezone. */
export function uncollectedOrders(orders: readonly Order[], now = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Mendoza', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const value = (part: string) => parts.find(entry => entry.type === part)?.value ?? '';
  const today = `${value('year')}-${value('month')}-${value('day')}`;
  const afterCutoff = `${value('hour')}:${value('minute')}` >= '20:45';
  return orders.filter(order => order.status === 'pendiente_entrega' && !order.returned_at && (order.pickup_date < today || (order.pickup_date === today && afterCutoff)))
    .sort((a, b) => a.pickup_date.localeCompare(b.pickup_date) || a.created_at.localeCompare(b.created_at));
}

export function pickupDateLabel(date: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return date;
  const tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const prefix = date === today ? 'HOY ' : date === tomorrow.toISOString().slice(0, 10) ? 'MAÑANA ' : '';
  return prefix + new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`)).toLocaleUpperCase('es-AR');
}

export function appendableOrders(orders: Order[], clientId: string, locationId: string) {
  if (!clientId) return [];
  return orders.filter(order => order.client_id === clientId && order.location_id === locationId && order.status === 'pendiente_entrega' && !order.returned_at)
    .sort((a, b) => a.pickup_date.localeCompare(b.pickup_date) || a.created_at.localeCompare(b.created_at));
}

/** Appending releases the old commitment before checking the whole combined basket. */
export function combinedSaleLines(lines: { product_id: string; quantity: string }[], original?: Order) {
  if (!original) return lines;
  const combined = new Map(original.lines.map(line => [line.product_id, saleQuantity(line.quantity)]));
  for (const line of lines) {
    const input = line.quantity.trim().replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(input)) continue;
    combined.set(line.product_id, new Decimal(combined.get(line.product_id) ?? 0).plus(input).toFixed());
  }
  return [...combined].map(([product_id, quantity]) => ({ product_id, quantity }));
}

/** Round the combined basket once, not the rounded original plus rounded additions. */
export function combinedSaleTotal(additions: Decimal.Value, original?: Order) {
  const originalAmount = original?.lines.reduce((sum, line) => sum.plus(new Decimal(line.quantity).mul(line.is_gift ? 0 : line.unit_price)), new Decimal(0)) ?? new Decimal(0);
  return originalAmount.plus(additions).toDecimalPlaces(2);
}

/** Eligibility comes from the global server snapshot, never the visible order subset. */
export function canSelectFirstPurchaseGift(client: Client | undefined, orderId?: string) {
  const gift = client?.first_purchase_gift;
  return !!gift?.eligible && (!gift.order_id || gift.order_id === orderId);
}

export type SaleDraftLine = { product_id: string; quantity: string; is_gift?: boolean };

/** Keep the gift on every edit and send an explicit false when it is removed. */
export function saleLinePayload(lines: SaleDraftLine[]) {
  return lines.map(line => ({ product_id: line.product_id, quantity: saleQuantity(line.quantity.trim().replace(',', '.')), is_gift: line.is_gift === true }));
}

/** Delivered stock was already consumed: only additions need stock at the same point. */
export function stockCheckLines(lines: SaleDraftLine[], locationId: string, original?: Order) {
  if (original?.status !== 'entregado' || original.location_id !== locationId) return lines;
  return lines.flatMap(line => {
    const input = line.quantity.trim().replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(input)) return [];
    const delivered = original.lines.filter(previous => previous.product_id === line.product_id).reduce((sum, previous) => sum.plus(previous.quantity), new Decimal(0));
    const increase = new Decimal(input).minus(delivered);
    return increase.gt(0) ? [{ ...line, quantity: increase.toFixed() }] : [];
  });
}

export function editableOrder(order: Order) {
  return !order.returned_at && (order.status === 'pendiente_entrega' || order.status === 'entregado');
}

/** Gift quantities remain physical lines, while only paid lines contribute to the charge. */
export function draftSaleTotal(lines: SaleDraftLine[], products: Item[], original?: Order) {
  return lines.reduce((sum, line) => {
    const unit = original?.lines.find(previous => previous.product_id === line.product_id)?.product_unit
      ?? products.find(product => product.id === line.product_id)?.unit ?? 'unidad';
    if (!validSaleQuantity(line.quantity, unit)) return sum;
    return sum.plus(new Decimal(line.is_gift ? 0 : linePrice(line.product_id, products, original)).mul(line.quantity.trim().replace(',', '.')));
  }, new Decimal(0));
}
