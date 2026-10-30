import { describe, expect, it } from 'vitest';
import { dailySummary } from './daily';
import type { FinancialMovement, Order, Snapshot } from './types';

const order = (id: string, location_id: string): Order => ({ id, location_id, client_id: 'c', pickup_date: '2026-10-23', status: 'entregado', total: '100.10', notes: '', payment_method: 'efectivo', created_at: '2026-10-20T00:00:00Z', delivered_at: '2026-10-23T12:00:00Z', version: 1, allocation_version: 1, lines: [] });
const payment = (patch: Partial<FinancialMovement> = {}): FinancialMovement => ({ id: 'p', kind: 'payment', order_id: 'o1', purchase_id: null, amount: '60.10', method: 'efectivo', category: 'venta', occurred_on: '2026-10-24', created_at: '2026-10-24T12:00:00Z', notes: '', reconciled: false, version: 1, reverses_id: null, ...patch });
const data = (): Snapshot => ({ locations: [], clients: [], items: [], recipes: [], purchases: [], productions: [], stock: [], movements: [], updated_at: '', orders: [order('o1', 'punto-nuevo'), order('o2', 'mendieta'), { ...order('cancelled', 'mendieta'), status: 'cancelado' }, { ...order('returned', 'mendieta'), returned_at: '2026-10-23T12:00:00Z' }], financial_movements: [payment(), payment({ id: 'e', kind: 'expense', order_id: null, amount: '-20.01' })] });
describe('Daily sales and actual cash', () => {
  it('cuenta comida y regalo como una sola venta con ingreso únicamente de las líneas cobradas', () => {
    const snapshot = data(); snapshot.orders = [{ ...order('mixed', 'mendieta'), total: '3000.00', lines: [
      { id: 'food', product_id: 'food', quantity: '1.5', unit_price: '2000.00', reserved: 0, shortage: 0 },
      { id: 'bag', product_id: 'bag', quantity: 1, unit_price: '0.00', list_unit_price: '1500.00', is_gift: true, reserved: 0, shortage: 0 },
    ] }]; snapshot.financial_movements = [payment({ order_id: 'mixed', amount: '3000.00', occurred_on: '2026-10-23' })];
    expect(dailySummary(snapshot, '2026-10-23', 'mendieta')).toMatchObject({ count: 1, sales: '3000.00', delivered: '3000.00', collections: '3000.00', cashNet: '3000.00' });
  });
  it('keeps deleted-order cash in its point on each actual movement date across months', () => {
    const snapshot = data(); snapshot.orders = [];
    snapshot.financial_movements = [payment({ id: 'receipt', order_id: 'deleted', location_id: 'mendieta', occurred_on: '2026-10-31' }), payment({ id: 'reversal', kind: 'reversal', order_id: 'deleted', location_id: 'mendieta', amount: '-60.10', occurred_on: '2026-11-01', reverses_id: 'receipt' }), payment({ id: 'other', order_id: 'other-deleted', location_id: 'salta', amount: '999.00', occurred_on: '2026-10-31' })];
    expect(dailySummary(snapshot, '2026-10-31', 'mendieta')).toMatchObject({ count: 0, sales: '0.00', collections: '60.10', cashNet: '60.10' });
    expect(dailySummary(snapshot, '2026-11-01', 'mendieta')).toMatchObject({ count: 0, sales: '0.00', collections: '-60.10', cashNet: '-60.10' });
    expect(dailySummary(snapshot, '2026-10-31', 'salta').collections).toBe('999.00');
  });

  it('never counts delivery as cash and excludes returns/cancellations', () => { expect(dailySummary(data(), '2026-10-23')).toMatchObject({ count: 2, sales: '200.20', delivered: '200.20', collections: '0.00' }); expect(dailySummary(data(), '2026-10-24')).toMatchObject({ count: 0, collections: '60.10', expenses: '20.01', cashNet: '40.09' }); });
  it('counts gratis deliveries without inventing revenue or a collection', () => {
    const snapshot = data(); snapshot.orders = [{ ...order('sample', 'mendieta'), payment_method: 'gratis', total: '999.99' }, order('charged', 'mendieta')]; snapshot.financial_movements = [];
    expect(dailySummary(snapshot, '2026-10-23')).toMatchObject({ count: 2, sales: '100.10', delivered: '100.10', collections: '0.00', cashNet: '0.00' });
    snapshot.orders = snapshot.orders.filter(entry => entry.payment_method === 'gratis');
    expect(dailySummary(snapshot, '2026-10-23')).toMatchObject({ count: 1, sales: '0.00', delivered: '0.00', collections: '0.00', cashNet: '0.00' });
  });
  it('supports new locations and does not allocate general expenses to a point', () => { expect(dailySummary(data(), '2026-10-23', 'punto-nuevo').sales).toBe('100.10'); expect(dailySummary(data(), '2026-10-24', 'punto-nuevo')).toMatchObject({ collections: '60.10', expenses: '0.00', cashNet: '60.10' }); });
});
