import Decimal from './decimal';
import type { Item, Location, Order, StockBalance } from './types';

/** Stock is expressed in the product's commercial unit, never a count of containers. */
export function physicalContainers(quantity: Decimal.Value, packageSize?: string | null): string | null {
  if (!packageSize || !new Decimal(packageSize).gt(0)) return null;
  return new Decimal(quantity).div(packageSize).ceil().toString();
}

export function validSaleQuantity(value: string, unit: string) {
  const normalized = value.trim().replace(',', '.');
  return (unit === 'kg' ? /^\d+(?:\.\d{1,3})?$/ : /^[1-9]\d*$/).test(normalized)
    && new Decimal(normalized).gt(0) && new Decimal(normalized).lte(999999999);
}

export function operationalAvailability(items: Item[], stock: StockBalance[], orders: Order[], locations: Location[], date: string) {
  return locations.map(location => ({ location, products: items.filter(item => item.kind === 'product' && (item.active || orders.some(order => order.location_id === location.id && order.status === 'pendiente_entrega' && order.lines.some(line => line.product_id === item.id)))).map(item => {
    const balance = stock.find(entry => entry.location_id === location.id && entry.item_id === item.id);
    const pending = orders.filter(order => order.location_id === location.id && order.status === 'pendiente_entrega');
    const quantity = (entries: Order[], field: 'quantity' | 'reserved' | 'shortage') => entries.reduce((sum, order) => order.lines.filter(line => line.product_id === item.id).reduce((value, line) => value.plus(line[field]), sum), new Decimal(0));
    const selected = pending.filter(order => order.pickup_date === date);
    const physical = new Decimal(balance?.on_hand ?? 0);
    const usable = new Decimal(balance?.usable ?? physical);
    const committed = quantity(pending, 'quantity');
    const reserved = Decimal.max(balance?.reserved ?? 0, quantity(pending, 'reserved'));
    const available = Decimal.max(0, usable.minus(Decimal.max(committed, reserved)));
    return { item, pending: quantity(selected, 'quantity').toString(), selectedReserved: quantity(selected, 'reserved').toString(), selectedShortage: quantity(selected, 'shortage').toString(), physical: physical.toString(), usable: usable.toString(), reserved: reserved.toString(), committed: committed.toString(), available: available.toString(), shortage: Decimal.max(balance?.shortage ?? 0, committed.minus(usable), 0).toString(), belowMinimum: available.lte(item.minimum) };
  }) }));
}

/** Editing releases that order's previous commitment before comparing the new lines. */
export function orderShortages(lines: { product_id: string; quantity: string }[], locationId: string, stock: StockBalance[], orders: Order[], originalId?: string) {
  const quantities = new Map<string, Decimal>();
  for (const line of lines) {
    const quantity = line.quantity.trim().replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(quantity)) continue;
    quantities.set(line.product_id, (quantities.get(line.product_id) ?? new Decimal(0)).plus(quantity));
  }
  return [...quantities].flatMap(([product_id, requested]) => {
    const balance = stock.find(entry => entry.item_id === product_id && entry.location_id === locationId);
    const usable = new Decimal(balance?.usable ?? balance?.on_hand ?? 0);
    const commitments = orders.filter(order => order.id !== originalId && order.location_id === locationId && order.status === 'pendiente_entrega')
      .reduce((sum, order) => order.lines.filter(line => line.product_id === product_id).reduce((total, line) => total.plus(line.quantity), sum), new Decimal(0));
    const available = Decimal.max(0, usable.minus(commitments));
    return requested.gt(available) ? [{ product_id, available: available.toString(), shortage: requested.minus(available).toString() }] : [];
  });
}
