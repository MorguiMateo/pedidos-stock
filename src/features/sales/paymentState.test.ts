import { describe, expect, it } from 'vitest';
import type { FinancialMovement, Order } from '../../lib/types';
import { deliveredUnpaidOrders, orderPaymentState } from './paymentState';

const order = { id: 'order', total: '100', payment_method: 'transferencia', status: 'entregado', pickup_date: '2026-01-01', created_at: '2026-01-01', returned_at: null } as Order;
const movement = (amount: string, kind: FinancialMovement['kind'] = 'payment', order_id = 'order') => ({ id: `${kind}-${amount}`, kind, amount, order_id }) as FinancialMovement;

describe('ledger-backed sales payment state', () => {
  it('does not treat a planned method as payment', () => {
    expect(orderPaymentState(order, []).isPaid).toBe(false);
    expect(orderPaymentState(order, []).balance.toString()).toBe('100');
  });
  it('marks complimentary orders paid without manufacturing cash receipts', () => {
    const state = orderPaymentState({ ...order, payment_method: 'gratis' }, []);
    expect(state.isPaid).toBe(true);
    expect(state.balance.toString()).toBe('0');
    expect(state.paid.toString()).toBe('0');
    expect(state.movements).toEqual([]);
    expect(deliveredUnpaidOrders([{ ...order, payment_method: 'gratis' }], [])).toEqual([]);
  });
  it('retains partial balances and includes signed refunds and reversals', () => {
    const state = orderPaymentState(order, [movement('100'), movement('-20', 'refund'), movement('-30', 'reversal'), movement('999', 'payment', 'other')]);
    expect(state.paid.toString()).toBe('50');
    expect(state.balance.toString()).toBe('50');
    expect(state.isPaid).toBe(false);
  });
  it('recognizes full settlement and a reversal of a refund', () => {
    expect(orderPaymentState(order, [movement('100'), movement('-20', 'refund'), movement('20', 'reversal')]).isPaid).toBe(true);
  });
  it('lists unpaid deliveries from every date but excludes returns, cancellations and fully paid orders', () => {
    const old = { ...order, id: 'old', pickup_date: '2025-01-01' };
    const future = { ...order, id: 'future', pickup_date: '2027-01-01' };
    const candidates = [future, { ...order, id: 'returned', returned_at: '2026-01-02' }, { ...order, id: 'pending', status: 'pendiente_entrega' as const }, { ...order, id: 'cancelled', status: 'cancelado' as const }, order, old];
    expect(deliveredUnpaidOrders(candidates, [movement('100')]).map(candidate => candidate.id)).toEqual(['old', 'future']);
  });
});
