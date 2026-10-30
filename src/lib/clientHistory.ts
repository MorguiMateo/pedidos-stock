import Decimal from './decimal';
import type { Snapshot } from './types';
import { orderSaleAmount } from './orderAmounts';

/** Pickup month determines the cohort; gratis valuations never become debt.
 * Genuine collections, refunds and reversals remain visible rather than being fabricated or hidden.
 */
export function clientHistory(data: Pick<Snapshot, 'orders' | 'financial_movements'>, clientId: string, month: string) {
  const netByOrder = new Map<string, Decimal>();
  for (const movement of data.financial_movements ?? []) {
    if (!movement.order_id) continue;
    netByOrder.set(movement.order_id, (netByOrder.get(movement.order_id) ?? new Decimal(0)).plus(movement.amount));
  }
  const orders = data.orders.filter(order => order.client_id === clientId)
    .sort((a, b) => b.pickup_date.localeCompare(a.pickup_date) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
    .map(order => {
      const paid = netByOrder.get(order.id) ?? new Decimal(0);
      const charge = order.status === 'cancelado' || order.returned_at ? new Decimal(0) : new Decimal(orderSaleAmount(order));
      return { order, paid: paid.toFixed(2), due: Decimal.max(0, charge.minus(paid)).toFixed(2), credit: Decimal.max(0, paid.minus(charge)).toFixed(2) };
    });
  const monthly = orders.filter(entry => entry.order.pickup_date.startsWith(`${month}-`));
  const sum = (key: 'paid' | 'due' | 'credit') => monthly.reduce((total, entry) => total.plus(entry[key]), new Decimal(0)).toFixed(2);
  return { orders, count: orders.filter(entry => entry.order.status !== 'cancelado' && !entry.order.returned_at).length, paid: sum('paid'), due: sum('due'), credit: sum('credit') };
}

/** Formatting characters are ignored; country prefixes are deliberately not guessed. */
export function normalizedPhone(phone?: string) { return (phone ?? '').replace(/\D/g, ''); }
export function duplicatePhoneClients(clients: Snapshot['clients'], phone: string, exceptId?: string) {
  const normalized = normalizedPhone(phone);
  return normalized ? clients.filter(client => client.id !== exceptId && normalizedPhone(client.phone) === normalized) : [];
}

/** Purchases use charged, delivered, non-returned orders and their historical total.
 * Gratis remains in operational orderCount but is not a purchase or a new purchase date.
 */
export function customerActivity(data: Pick<Snapshot, 'clients' | 'orders'>, month: string, asOf: string) {
  return data.clients.map(client => {
    const orders = data.orders.filter(order => order.client_id === client.id && order.status !== 'cancelado' && !order.returned_at);
    const purchases = orders.filter(order => order.status === 'entregado' && new Decimal(orderSaleAmount(order)).gt(0) && order.pickup_date <= asOf).sort((a, b) => a.pickup_date.localeCompare(b.pickup_date));
    const firstPurchase = purchases[0]?.pickup_date ?? null;
    const lastPurchase = purchases[purchases.length - 1]?.pickup_date ?? null;
    const daysSincePurchase = lastPurchase ? Math.floor((Date.parse(`${asOf}T12:00:00Z`) - Date.parse(`${lastPurchase}T12:00:00Z`)) / 86_400_000) : null;
    return { client, createdOn: client.created_at ? localClientDate(client.created_at) : null, firstPurchase, lastPurchase, daysSincePurchase, orderCount: orders.length, purchaseCount: purchases.length,
      monthlyPurchases: purchases.filter(order => order.pickup_date.startsWith(`${month}-`)).length,
      totalSales: purchases.reduce((total, order) => total.plus(orderSaleAmount(order)), new Decimal(0)).toFixed(2) };
  });
}
function localClientDate(value: string) { return value.length === 10 ? value : new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Mendoza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
