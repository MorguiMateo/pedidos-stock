import Decimal from './decimal';
import type { Snapshot } from './types';

/** Server allocations are disjoint: never reuse the same physical stock per date. */
export function productionNeeds(data: Pick<Snapshot, 'orders' | 'stock'>) {
  const groups = new Map<string, { product_id: string; location_id: string; date: string; committed: Decimal; physical_reserved: Decimal; future_reserved: Decimal; shortage: Decimal; physical: string }>();
  for (const order of data.orders) {
    if (order.status !== 'pendiente_entrega' || order.returned_at) continue;
    for (const line of order.lines) {
      const key = `${line.product_id}/${order.location_id}/${order.pickup_date}`;
      const group = groups.get(key) ?? { product_id: line.product_id, location_id: order.location_id, date: order.pickup_date, committed: new Decimal(0), physical_reserved: new Decimal(0), future_reserved: new Decimal(0), shortage: new Decimal(0), physical: data.stock.find(balance => balance.item_id === line.product_id && balance.location_id === order.location_id)?.on_hand ?? '0' };
      group.committed = group.committed.plus(line.quantity);
      group.physical_reserved = group.physical_reserved.plus(line.reserved);
      group.future_reserved = group.future_reserved.plus(line.future_reserved ?? 0);
      group.shortage = group.shortage.plus(line.shortage);
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.product_id.localeCompare(b.product_id) || a.location_id.localeCompare(b.location_id)).map(group => ({ ...group, committed: group.committed.toString(), physical_reserved: group.physical_reserved.toString(), future_reserved: group.future_reserved.toString(), shortage: group.shortage.toString(), needs_receive: Decimal.max(0, group.committed.minus(group.physical_reserved)).toString() }));
}
