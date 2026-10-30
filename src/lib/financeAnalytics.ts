import Decimal from './decimal';
import { orderSaleAmount } from './orderAmounts';
import { billedLineAmounts } from './reports';
import { isValidDate, today } from './format';
import type { Snapshot } from './types';

export function shiftMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
export function monthDays(month: string) {
  if (!isValidDate(`${month}-01`)) return [];
  const count = new Date(`${shiftMonth(month, 1)}-01T12:00:00Z`);
  count.setUTCDate(0);
  return Array.from({ length: count.getUTCDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}
const add = (values: string[]) => values.reduce((total, value) => total.plus(value), new Decimal(0));

/** Monthly cohort uses pickup date, not collection/delivery timestamp. Calendar and client
 * counts include scheduled orders; sold quantities/revenue only include delivered sales.
 * Anonymous orders never become a synthetic customer. Samples/gifts are physical consumption,
 * but do not increase sold units or the paid-order average-ticket denominator.
 */
export function financeMonth(data: Snapshot, month: string, location = 'all') {
  const orders = data.orders.filter(order => isValidDate(order.pickup_date) && order.pickup_date.startsWith(`${month}-`) && (location === 'all' || order.location_id === location) && order.status !== 'cancelado' && !order.returned_at);
  const delivered = orders.filter(order => order.status === 'entregado');
  const paidSales = delivered.filter(order => order.payment_method !== 'gratis');
  const revenue = add(delivered.map(orderSaleAmount));
  const clients = (rows: typeof orders) => new Set(rows.map(order => order.client_id).filter((id): id is string => !!id?.trim())).size;
  const points = [...new Set([...data.locations.filter(point => point.is_pickup !== false).map(point => point.id), ...orders.map(order => order.location_id)])].filter(id => location === 'all' || location === id).map(id => {
    const point = data.locations.find(point => point.id === id);
    const rows = orders.filter(order => order.location_id === id);
    const sales = rows.filter(order => order.status === 'entregado' && order.payment_method !== 'gratis');
    const total = add(sales.map(orderSaleAmount));
    return { id, name: point?.name ?? id, color: point?.color ?? '#666666', orders: rows.length, clients: clients(rows), deliveredClients: clients(rows.filter(order => order.status === 'entregado')), sales: sales.length, revenue: total.toFixed(2), averageTicket: sales.length ? total.div(sales.length).toFixed(2) : null };
  });
  const products = new Map<string, { key: string; productId: string; name: string; unit: string; locationId: string; location: string; sold: Decimal; gifts: Decimal; revenue: Decimal }>();
  for (const order of delivered) {
    const billed = billedLineAmounts(order);
    for (const line of order.lines) {
      const item = data.items.find(item => item.id === line.product_id);
      const unit = line.product_unit ?? item?.unit ?? 'unidad';
      const key = JSON.stringify([order.location_id, line.product_id, unit]);
      const row = products.get(key) ?? { key, productId: line.product_id, name: line.product_name || item?.name || 'Producto archivado', unit, locationId: order.location_id, location: data.locations.find(point => point.id === order.location_id)?.name ?? order.location_id, sold: new Decimal(0), gifts: new Decimal(0), revenue: new Decimal(0) };
      if (line.is_gift || order.payment_method === 'gratis') row.gifts = row.gifts.plus(line.quantity);
      else row.sold = row.sold.plus(line.quantity);
      row.revenue = row.revenue.plus(billed.get(line.id) ?? '0');
      products.set(key, row);
    }
  }
  return {
    month, orders: orders.length, clients: clients(orders), deliveredClients: clients(delivered), sales: paidSales.length, revenue: revenue.toFixed(2), averageTicket: paidSales.length ? revenue.div(paidSales.length).toFixed(2) : null,
    points,
    products: [...products.values()].sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name)).map(row => ({ ...row, sold: row.sold.toString(), gifts: row.gifts.toString(), revenue: row.revenue.toFixed(2) })),
    days: monthDays(month).map(date => ({ date, count: orders.filter(order => order.pickup_date === date).length, points: points.map(point => ({ ...point, count: orders.filter(order => order.pickup_date === date && order.location_id === point.id).length })).filter(point => point.count > 0) })),
  };
}
export function financeHistory(data: Snapshot, month: string, location = 'all') {
  return Array.from({ length: 6 }, (_, index) => financeMonth(data, shiftMonth(month, index - 5), location));
}

/** Forecast = arithmetic mean of three completed calendar months, including zero-demand
 * months after the product's first observed delivery. Never extrapolate an incomplete month.
 * This is observed demand, not inventory consumption or a seasonal/statistical model.
 */
export function consumptionForecast(data: Snapshot, month: string, location = 'all', asOf = today()) {
  const latestComplete = shiftMonth(asOf.slice(0, 7), -1);
  const end = month < latestComplete ? month : latestComplete;
  const months = [-2, -1, 0].map(offset => shiftMonth(end, offset));
  const rows = new Map<string, { key: string; productId: string; name: string; unit: string; firstMonth: string; values: Decimal[] }>();
  for (const order of data.orders) {
    if (order.status !== 'entregado' || order.returned_at || !isValidDate(order.pickup_date) || order.pickup_date.slice(0, 7) > end || (location !== 'all' && order.location_id !== location)) continue;
    for (const line of order.lines) {
      const item = data.items.find(item => item.id === line.product_id);
      const unit = line.product_unit ?? item?.unit ?? 'unidad';
      const key = JSON.stringify([line.product_id, unit]);
      const row = rows.get(key) ?? { key, productId: line.product_id, name: line.product_name || item?.name || 'Producto archivado', unit, firstMonth: order.pickup_date.slice(0, 7), values: [new Decimal(0), new Decimal(0), new Decimal(0)] };
      if (order.pickup_date.slice(0, 7) < row.firstMonth) row.firstMonth = order.pickup_date.slice(0, 7);
      const index = months.indexOf(order.pickup_date.slice(0, 7));
      if (index >= 0) row.values[index] = row.values[index]!.plus(line.quantity);
      rows.set(key, row);
    }
  }
  return { months, forecastMonth: shiftMonth(end, 1), rows: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)).map(row => ({ ...row, values: row.values.map(value => value.toString()), forecast: row.firstMonth <= months[0]! ? add(row.values.map(value => value.toString())).div(3).toDecimalPlaces(2).toString() : null })) };
}

export type BreakEvenInputs = { fixed: string; variable: string; price: string };
export function breakEven(inputs: BreakEvenInputs) {
  const values = [inputs.fixed, inputs.variable, inputs.price].map(value => value.trim().replace(',', '.'));
  if (values.some(value => !/^\d+(?:\.\d+)?$/.test(value))) return { error: 'Completá costos y precio con números no negativos.', contribution: null, margin: null, units: null, exactUnits: null };
  const [fixed, variable, price] = values.map(value => new Decimal(value)) as [Decimal, Decimal, Decimal];
  if (price.lte(0)) return { error: 'El precio debe ser mayor a cero.', contribution: null, margin: null, units: null, exactUnits: null };
  const contribution = price.minus(variable);
  const margin = contribution.div(price).times(100).toFixed(2);
  if (contribution.lte(0)) return { error: 'Sin punto de equilibrio: el precio no cubre el costo variable.', contribution: contribution.toFixed(2), margin, units: null, exactUnits: null };
  return { error: null, contribution: contribution.toFixed(2), margin, units: fixed.div(contribution).ceil().toString(), exactUnits: fixed.div(contribution).toDecimalPlaces(2, Decimal.ROUND_CEIL).toFixed(2) };
}

/** Recover only bounded calculator text; never trust browser/device storage as domain data. */
export function parseBreakEvenDrafts(raw: string | null): Record<string, BreakEvenInputs> {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, value]) => id.length <= 200 && value && typeof value === 'object' && ['fixed', 'variable', 'price'].every(key => typeof value[key] === 'string' && value[key].length <= 40)));
  } catch { return {}; }
}
