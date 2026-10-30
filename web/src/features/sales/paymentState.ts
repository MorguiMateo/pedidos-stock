import Decimal from '@shared/lib/decimal';
import type { FinancialMovement, Order } from '@shared/lib/types';

/** Planned payment methods never constitute a collection; signed ledger entries do. */
export function orderPaymentState(order: Pick<Order, 'id' | 'total'> & Partial<Pick<Order, 'payment_method'>>, ledger: FinancialMovement[]) {
  const movements = ledger.filter(movement => movement.order_id === order.id && ['payment', 'refund', 'reversal'].includes(movement.kind));
  const paid = movements.reduce((sum, movement) => sum.plus(movement.amount), new Decimal(0));
  const balance = order.payment_method === 'gratis' ? new Decimal(0) : Decimal.max(0, new Decimal(order.total).minus(paid));
  return { movements, paid, balance, isPaid: balance.isZero() };
}

export function deliveredUnpaidOrders(orders: Order[], ledger: FinancialMovement[]) {
  return orders.filter(order => order.status === 'entregado' && !order.returned_at && !orderPaymentState(order, ledger).isPaid)
    .sort((a, b) => a.pickup_date.localeCompare(b.pickup_date) || a.created_at.localeCompare(b.created_at));
}
