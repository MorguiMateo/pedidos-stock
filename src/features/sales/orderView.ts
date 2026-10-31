import type { FinancialMovement, Order, OrderStatus } from '../../lib/types';
import { orderPaymentState } from './paymentState';

export type OrderTone = 'pending' | 'delivered' | 'delivered_unpaid' | 'neutral';

/** Card background: pending reads red, delivered green, delivered with a balance yellow. */
export function orderTone(order: Order, ledger: FinancialMovement[]): OrderTone {
  if (order.returned_at || order.status === 'cancelado') return 'neutral';
  if (order.status === 'pendiente_entrega') return 'pending';
  return orderPaymentState(order, ledger).isPaid ? 'delivered' : 'delivered_unpaid';
}

/** Very light tints shared by web and native. */
export const orderToneColors: Record<Exclude<OrderTone, 'neutral'>, string> = { pending: '#FDECEC', delivered: '#E9F7EC', delivered_unpaid: '#FFF7D6' };

const statusNames: Record<OrderStatus, string> = { pendiente_entrega: 'pendiente', entregado: 'entregado', cancelado: 'cancelado' };

export const statusChangeQuestion = (from: OrderStatus, to: OrderStatus) => `¿Estás seguro de que querés cambiar el estado de ${statusNames[from]} a ${statusNames[to]}?`;

/** A client's own orders, newest pickup first; cancelled and returned ones never count as orders made. */
export function clientOrdersNewestFirst(orders: readonly Order[], clientId: string) {
  if (!clientId || clientId === 'all') return [];
  return orders.filter(order => order.client_id === clientId && order.status !== 'cancelado' && !order.returned_at)
    .sort((a, b) => b.pickup_date.localeCompare(a.pickup_date) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

export const clientOrderDays = (orders: readonly Order[], clientId: string) => new Set(clientOrdersNewestFirst(orders, clientId).map(order => order.pickup_date));
