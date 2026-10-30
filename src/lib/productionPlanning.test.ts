import { describe, expect, it } from 'vitest';
import { productionNeeds } from './productionPlanning';
import type { Order } from './types';
const order = (id: string, date: string, location: string, quantity: string, reserved: string, future: string, shortage = '0'): Order => ({ id, pickup_date: date, location_id: location, status: 'pendiente_entrega', client_id: null, payment_method: 'desconocido', total: '0', notes: '', version: 1, allocation_version: 1, created_at: date, delivered_at: null, lines: [{ id: id + '-line', product_id: 'caldo', quantity, reserved, future_reserved: future, shortage, unit_price: '100' }] });
describe('production replenishment needs', () => {
  it('does not reuse physical stock across dates or pickup points', () => {
    const needs = productionNeeds({ orders: [order('a', '2026-10-29', 'mendieta', '10', '3', '7'), order('b', '2026-10-30', 'mendieta', '5', '0', '4', '1'), order('c', '2026-10-29', 'salta', '4', '2', '2')], stock: [{ item_id: 'caldo', location_id: 'mendieta', on_hand: '3', reserved: '3', shortage: '1' }, { item_id: 'caldo', location_id: 'salta', on_hand: '2', reserved: '2', shortage: '0' }] });
    expect(needs.map(x => [x.location_id, x.date, x.needs_receive, x.future_reserved, x.shortage])).toEqual([['mendieta', '2026-10-29', '7', '7', '0'], ['salta', '2026-10-29', '2', '2', '0'], ['mendieta', '2026-10-30', '5', '4', '1']]);
  });
  it('groups exact quantities and ignores delivered, cancelled and returned orders', () => {
    const a = order('a', '2026-10-29', 'mendieta', '1.25', '.25', '1');
    const b = order('b', '2026-10-29', 'mendieta', '2.5', '.5', '2');
    const excluded = [ { ...a, id: 'delivered', status: 'entregado' as const }, { ...a, id: 'cancelled', status: 'cancelado' as const }, { ...a, id: 'returned', returned_at: '2026-10-29' } ];
    const [need] = productionNeeds({ orders: [a, b, ...excluded], stock: [] });
    expect(need).toMatchObject({ committed: '3.75', physical_reserved: '.75'.replace(/^\./, '0.'), future_reserved: '3', needs_receive: '3', shortage: '0' });
  });
});
