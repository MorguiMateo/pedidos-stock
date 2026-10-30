import Decimal from './decimal';
import type { Snapshot } from './types';
import { orderSaleAmount } from './orderAmounts';

/** Sales use pickup date and exclude gratis valuations; physical order counts retain samples.
 * Cash uses actual signed movements only, never an implied payment for gratis.
 * Ledger location metadata preserves point scope when a deleted order is omitted.
 */
export function dailySummary(data: Snapshot, date: string, location = 'all') {
  const inLocation = (id: string | undefined) => location === 'all' || id === location;
  const orders = data.orders.filter(order => order.pickup_date === date && inLocation(order.location_id) && order.status !== 'cancelado' && !order.returned_at);
  const cash = (data.financial_movements ?? []).filter(movement => movement.occurred_on === date && (movement.order_id ? inLocation(data.orders.find(order => order.id === movement.order_id)?.location_id ?? movement.location_id ?? undefined) : location === 'all'));
  const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new Decimal(0));
  const collections = sum(cash.filter(movement => movement.order_id !== null).map(movement => movement.amount));
  const expenses = sum(cash.filter(movement => movement.order_id === null).map(movement => movement.amount)).negated();
  return { count: orders.length, sales: sum(orders.map(orderSaleAmount)).toFixed(2), delivered: sum(orders.filter(order => order.status === 'entregado').map(orderSaleAmount)).toFixed(2), collections: collections.toFixed(2), expenses: expenses.toFixed(2), cashNet: collections.minus(expenses).toFixed(2) };
}
