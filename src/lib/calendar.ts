import Decimal from './decimal';
import { billedLineAmounts } from './reports';
import { orderSaleAmount } from './orderAmounts';
import type { Item, Location, Order, Snapshot } from './types';

export interface OrderFilters { location?: string; product?: string; client?: string; status?: string; }
/** Shared scope for the detail list and pending pickup counters. */
export function inOrderScope(order: Order, filters: OrderFilters) {
  return (!filters.location || filters.location === 'all' || order.location_id === filters.location)
    && (!filters.client || filters.client === 'all' || order.client_id === filters.client)
    && (!filters.product || filters.product === 'all' || order.lines.some(line => line.product_id === filters.product));
}
export function calendarCounts(orders: Order[], filters: OrderFilters = {}) {
  const days: Record<string, Record<string, number>> = {};
  for (const order of orders) {
    if (order.status !== 'pendiente_entrega' || order.returned_at || !inOrderScope(order, filters)) continue;
    const counts = days[order.pickup_date] ?? (days[order.pickup_date] = {});
    counts[order.location_id] = (counts[order.location_id] ?? 0) + 1;
  }
  return days;
}
export function pickupLocations(locations: Location[]) {
  return locations.filter(location => location.is_pickup === true);
}
export function activePickupLocations(locations: Location[]) {
  return pickupLocations(locations).filter(location => location.active !== false);
}
export type DailyProduct = { product_id: string; name: string; unit: string; quantity: string };
/** All valid daily quantities, independent of payment/preparation and visual status filters.
 * Gifts count as physical products. Historical product units are never combined with other units.
 */
export function dailyProductSummary(data: Pick<Snapshot, 'orders' | 'items' | 'locations'>, day: string, filters: OrderFilters = {}) {
  const orders = data.orders.filter(order => order.pickup_date === day && order.status !== 'cancelado' && !order.returned_at && inOrderScope(order, filters));
  const catalog = new Map(data.items.map(item => [item.id, item]));
  const summarize = (rows: Order[]) => {
    const products = new Map<string, DailyProduct>();
    for (const order of rows) for (const line of order.lines) {
      if (filters.product && filters.product !== 'all' && line.product_id !== filters.product) continue;
      const product = catalog.get(line.product_id);
      const unit = line.product_unit ?? product?.unit ?? 'unidad';
      const key = JSON.stringify([line.product_id, unit]);
      const entry = products.get(key) ?? { product_id: line.product_id, name: line.product_name?.trim() || product?.name || 'Producto archivado', unit, quantity: '0' };
      entry.quantity = new Decimal(entry.quantity).plus(line.quantity).toString();
      products.set(key, entry);
    }
    return [...products.values()];
  };
  const positions = new Map(data.locations.map((point, index) => [point.id, index]));
  const byLocation = [...new Set(orders.map(order => order.location_id))].map(location_id => {
    const point = data.locations.find(location => location.id === location_id);
    const rows = orders.filter(order => order.location_id === location_id);
    return { location_id, name: point?.name ?? location_id, color: point?.color ?? '#666666', count: rows.length, products: summarize(rows) };
  }).sort((a, b) => (positions.get(a.location_id) ?? data.locations.length) - (positions.get(b.location_id) ?? data.locations.length) || a.name.localeCompare(b.name));
  return { count: orders.length, products: summarize(orders), byLocation };
}
const isOutstanding = (order: Order) => order.status === 'pendiente_entrega' && !order.returned_at;
/** Outstanding orders first; delivered and closed ones follow. Stable inside each block. */
export function pendingFirst<T extends Order>(orders: readonly T[]): T[] {
  return [...orders.filter(isOutstanding), ...orders.filter(order => !isOutstanding(order))];
}
/** Preserve the day's order sort within each pickup (pending first), including archived locations. */
export function groupOrdersByPickup(orders: Order[], locations: Location[], items: Item[] = []) {
  type PendingProduct = { product_id: string; name: string; unit: string; quantity: string };
  type PickupGroup = { location_id: string; name: string; color: string; orders: Order[]; pendingCount: number; total: string; pendingProducts: Map<string, PendingProduct> };
  const products = new Map(items.map(item => [item.id, item]));
  const groups = new Map<string, PickupGroup>();
  for (const order of orders) {
    const point = locations.find(location => location.id === order.location_id);
    const group: PickupGroup = groups.get(order.location_id) ?? { location_id: order.location_id, name: point?.name ?? order.location_id, color: point?.color ?? '#666666', orders: [], pendingCount: 0, total: '0.00', pendingProducts: new Map() };
    group.orders.push(order);
    // Delivered orders remain visible, but only outstanding pickups enter this summary.
    if (order.status === 'pendiente_entrega' && !order.returned_at) {
      group.pendingCount += 1;
      group.total = new Decimal(group.total).plus(orderSaleAmount(order)).toFixed(2);
      for (const line of order.lines) {
        const product = products.get(line.product_id);
        const unit = line.product_unit ?? product?.unit ?? 'unidad';
        const key = JSON.stringify([line.product_id, unit]);
        const current = group.pendingProducts.get(key) ?? { product_id: line.product_id, name: line.product_name?.trim() || product?.name || 'Producto archivado', unit, quantity: '0' };
        current.quantity = new Decimal(current.quantity).plus(line.quantity).toString();
        group.pendingProducts.set(key, current);
      }
    }
    groups.set(order.location_id, group);
  }
  const positions = new Map(locations.map((point, index) => [point.id, index]));
  return [...groups.values()].sort((a, b) => (positions.get(a.location_id) ?? locations.length) - (positions.get(b.location_id) ?? locations.length) || a.name.localeCompare(b.name))
    .map(group => ({ ...group, orders: pendingFirst(group.orders), pendingProducts: [...group.pendingProducts.values()] }));
}
export function linePrice(productId: string, products: Item[], original?: Order) {
  const historical = original?.lines.find(line => line.product_id === productId);
  return historical?.list_unit_price ?? historical?.unit_price
    ?? products.find(item => item.id === productId)?.price ?? '0';
}
export function monthlyClientReport(data: Pick<Snapshot, 'orders' | 'items'>, clientId: string, month: string) {
  const orders = data.orders.filter(order => order.client_id === clientId && order.pickup_date.startsWith(`${month}-`) && order.status !== 'cancelado' && !order.returned_at);
  const delivered = orders.filter(order => order.status === 'entregado' && !order.returned_at);
  const consumption = new Map<string, { product_id: string; name: string; unit: string; quantity: Decimal; amount: Decimal }>();
  for (const order of delivered) {
    const billed = billedLineAmounts(order);
    for (const line of order.lines) {
    const product = data.items.find(item => item.id === line.product_id);
    const unit = line.product_unit ?? product?.unit ?? 'unidad';
    const key = `${line.product_id}:${unit}`;
    const current = consumption.get(key) ?? { product_id: line.product_id, name: line.product_name ?? product?.name ?? 'Producto archivado', unit, quantity: new Decimal(0), amount: new Decimal(0) };
    current.quantity = current.quantity.plus(line.quantity);
    current.amount = current.amount.plus(billed.get(line.id) ?? '0');
    consumption.set(key, current);
    }
  }
  return {
    count: orders.length,
    deliveredCount: delivered.length,
    total: orders.reduce((sum, order) => sum.plus(orderSaleAmount(order)), new Decimal(0)).toFixed(2),
    deliveredAmount: [...consumption.values()].reduce((sum, item) => sum.plus(item.amount), new Decimal(0)).toFixed(2),
    consumption: [...consumption.values()].sort((a, b) => a.name.localeCompare(b.name)).map(item => ({ ...item, quantity: item.quantity.toString(), amount: item.amount.toFixed(2) })),
  };
}

/** Operational totals use pending orders regardless of the visual status filter. */
export function preparationSummary(orders: Order[], date: string, filters: OrderFilters = {}) {
  const groups = new Map<string, { location_id: string; count: number; packages: number; prepared: number; uber: number; products: Map<string, { product_id: string; name: string; unit: string; quantity: number; reserved: number; shortage: number }> }>();
  for (const order of orders) {
    if (order.pickup_date !== date || order.status !== 'pendiente_entrega' || !inOrderScope(order, filters)) continue;
    const group = groups.get(order.location_id) ?? { location_id: order.location_id, count: 0, packages: 0, prepared: 0, uber: 0, products: new Map() };
    group.count += 1; group.packages += order.packages ?? 1; group.prepared += order.prepared_packages ?? 0; group.uber += order.uber ? 1 : 0;
    for (const line of order.lines) {
      if (filters.product && filters.product !== 'all' && line.product_id !== filters.product) continue;
      const unit = line.product_unit ?? 'unidad';
      const key = `${line.product_id}:${unit}`;
      const product = group.products.get(key) ?? { product_id: line.product_id, name: line.product_name ?? '', unit, quantity: 0, reserved: 0, shortage: 0 };
      product.quantity = new Decimal(product.quantity).plus(line.quantity).toNumber(); product.reserved = new Decimal(product.reserved).plus(line.reserved).toNumber(); product.shortage = new Decimal(product.shortage).plus(line.shortage).toNumber();
      group.products.set(key, product);
    }
    groups.set(order.location_id, group);
  }
  return [...groups.values()].map(group => ({ ...group, products: [...group.products.values()] }));
}

export type CalendarView = 'day' | 'week' | 'month';
export function shiftCalendarDate(date: string, amount: number, view: CalendarView) {
  const value = new Date(`${date}T12:00:00Z`);
  if (view === 'month') {
    const originalDay = value.getUTCDate();
    value.setUTCDate(1);
    value.setUTCMonth(value.getUTCMonth() + amount);
    const last = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
    value.setUTCDate(Math.min(originalDay, last));
  } else value.setUTCDate(value.getUTCDate() + amount * (view === 'week' ? 7 : 1));
  return value.toISOString().slice(0, 10);
}
export function calendarWeek(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const weekday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - weekday);
  return Array.from({ length: 7 }, (_, index) => shiftCalendarDate(value.toISOString().slice(0, 10), index, 'day'));
}
/** Baseline IDs include every date: a future order moving to today isn't a new order. */
export function newlyCreatedToday(orders: Order[], baseline: ReadonlySet<string>, today: string) {
  return orders.filter(order => {
    const created = new Date(order.created_at);
    const createdOn = Number.isNaN(created.getTime()) ? '' : new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Mendoza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(created);
    return !baseline.has(order.id) && createdOn === today && order.pickup_date === today && order.status !== 'cancelado';
  });
}

/** Preparation is a pending-order substate, not a second persisted delivery status. */
export function orderPreparationState(order: Pick<Order, 'status' | 'packages' | 'prepared_packages'>): 'pend_preparar' | 'preparado' | null {
  if (order.status !== 'pendiente_entrega') return null;
  return (order.prepared_packages ?? 0) >= (order.packages ?? 1) ? 'preparado' : 'pend_preparar';
}
