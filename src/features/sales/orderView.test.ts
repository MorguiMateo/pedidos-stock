import { describe, expect, it } from 'vitest';
import { pendingFirst } from '../../lib/calendar';
import type { FinancialMovement, Order } from '../../lib/types';
import { clientOrderDays, clientOrdersNewestFirst, orderTone, statusChangeQuestion } from './orderView';

const order = (id: string, extra: Partial<Order> = {}) => ({ id, client_id: 'ana', total: '100', payment_method: 'transferencia', status: 'pendiente_entrega', pickup_date: '2026-10-01', created_at: '2026-09-01T10:00:00Z', returned_at: null, ...extra }) as Order;
const payment = { id: 'p', kind: 'payment', amount: '100', order_id: 'd' } as FinancialMovement;

describe('order tone', () => {
  it('maps pending, delivered and delivered-with-balance; ignores cancelled and returned', () => {
    expect(orderTone(order('a'), [])).toBe('pending');
    expect(orderTone(order('d', { status: 'entregado' }), [payment])).toBe('delivered');
    expect(orderTone(order('d', { status: 'entregado' }), [])).toBe('delivered_unpaid');
    expect(orderTone(order('c', { status: 'cancelado' }), [])).toBe('neutral');
    expect(orderTone(order('r', { status: 'entregado', returned_at: '2026-10-02' }), [])).toBe('neutral');
  });
});

describe('pending first', () => {
  it('keeps pending orders on top and each block in its original order', () => {
    const rows = [order('d1', { status: 'entregado' }), order('p1'), order('d2', { status: 'entregado' }), order('p2'), order('c', { status: 'cancelado' })];
    expect(pendingFirst(rows).map(row => row.id)).toEqual(['p1', 'p2', 'd1', 'd2', 'c']);
  });
});

describe('client order history', () => {
  const rows = [order('old', { pickup_date: '2026-08-01' }), order('new', { pickup_date: '2026-10-20' }), order('cancelled', { pickup_date: '2026-10-25', status: 'cancelado' }), order('other', { client_id: 'bruno' }), order('mid', { pickup_date: '2026-09-10' }), order('same-day-later', { pickup_date: '2026-10-20', created_at: '2026-10-01T10:00:00Z' })];
  it('lists newest pickup first, skipping cancelled and other clients', () => {
    expect(clientOrdersNewestFirst(rows, 'ana').map(row => row.id)).toEqual(['same-day-later', 'new', 'mid', 'old']);
    expect(clientOrdersNewestFirst(rows, 'all')).toEqual([]);
    expect(clientOrdersNewestFirst(rows, '')).toEqual([]);
  });
  it('exposes the pickup days to highlight', () => {
    expect([...clientOrderDays(rows, 'ana')].sort()).toEqual(['2026-08-01', '2026-09-10', '2026-10-20']);
  });
});

describe('status change question', () => {
  it('names both states in plain Spanish', () => {
    expect(statusChangeQuestion('entregado', 'pendiente_entrega')).toBe('¿Estás seguro de que querés cambiar el estado de entregado a pendiente?');
    expect(statusChangeQuestion('entregado', 'cancelado')).toBe('¿Estás seguro de que querés cambiar el estado de entregado a cancelado?');
  });
});
