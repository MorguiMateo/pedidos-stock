import type { Order } from './types';

/** Gratis preserves the historical catalogue valuation but never creates sales revenue or a charge.
 * Physical quantities and genuine signed ledger movements are accounted for independently.
 */
export function orderSaleAmount(order: Pick<Order, 'total'> & Partial<Pick<Order, 'payment_method'>>): string {
  return order.payment_method === 'gratis' ? '0' : order.total;
}
