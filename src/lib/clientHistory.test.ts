import { describe, expect, it } from 'vitest';
import { clientHistory } from './clientHistory';
import type { FinancialMovement, Order } from './types';

const order = (patch: Partial<Order> = {}): Order => ({ id: 'order', client_id: 'client', pickup_date: '2026-11-03', location_id: 'point-a', payment_method: 'efectivo', status: 'pendiente_entrega', notes: '', total: '0.30', version: 1, allocation_version: 0, created_at: '2026-10-22T12:00:00Z', delivered_at: null, lines: [], ...patch });
const movement = (amount: string, patch: Partial<FinancialMovement> = {}): FinancialMovement => ({ id: 'payment', order_id: 'order', purchase_id: null, kind: 'payment', amount, method: 'efectivo', category: '', occurred_on: '2026-12-01', notes: '', reconciled: false, version: 1, created_at: '2026-12-01T12:00:00Z', reverses_id: null, ...patch });

describe('Historial y cuenta del cliente', () => {
  it('trata comida y bolsa de regalo como una sola compra con deuda solo por la comida', async () => {
    const { customerActivity } = await import('./clientHistory');
    const mixed = order({ total: '3000.00', status: 'entregado', lines: [
      { id: 'food', product_id: 'food', quantity: '1.5', unit_price: '2000.00', reserved: 0, shortage: 0 },
      { id: 'bag', product_id: 'bag', quantity: 1, unit_price: '0.00', list_unit_price: '1500.00', is_gift: true, reserved: 0, shortage: 0 },
    ] });
    expect(clientHistory({ orders: [mixed], financial_movements: [movement('1000.00')] }, 'client', '2026-11')).toMatchObject({ count: 1, paid: '1000.00', due: '2000.00', credit: '0.00' });
    expect(customerActivity({ clients: [{ id: 'client', name: 'Cliente', version: 1 }], orders: [mixed] }, '2026-11', '2026-11-30')[0]).toMatchObject({ orderCount: 1, purchaseCount: 1, monthlyPurchases: 1, totalSales: '3000.00', firstPurchase: '2026-11-03', lastPurchase: '2026-11-03' });
  });
  it('enlaza solo sus pedidos, conserva cancelados en el historial y ordena por retiro', () => {
    const result = clientHistory({ orders: [order(), order({ id: 'cancelled', status: 'cancelado', pickup_date: '2026-11-04' }), order({ id: 'another', client_id: 'another-client' }), order({ id: 'old', pickup_date: '2026-10-31' })] }, 'client', '2026-11');
    expect(result.count).toBe(2);
    expect(result.orders.map(entry => entry.order.id)).toEqual(['cancelled', 'order', 'old']);
    expect(result.due).toBe('0.30');
    expect(result.orders.find(entry => entry.order.id === 'cancelled')?.due).toBe('0.00');
  });
  it('usa el mes del retiro y cobros netos exactos incluyendo reintegros y reversiones posteriores', () => {
    const result = clientHistory({ orders: [order()], financial_movements: [movement('0.30'), movement('-0.10', { id: 'refund', kind: 'refund' }), movement('-0.05', { id: 'reversal', kind: 'reversal' }), movement('99', { id: 'other', order_id: 'another' }), movement('-500', { id: 'expense', kind: 'expense', order_id: null })] }, 'client', '2026-11');
    expect(result.paid).toBe('0.15');
    expect(result.due).toBe('0.15');
    expect(result.credit).toBe('0.00');
    expect(clientHistory({ orders: [order()], financial_movements: [movement('0.30')] }, 'client', '2026-12').paid).toBe('0.00');
  });
  it('no oculta deudas compensándolas con pagos excedentes o devoluciones de otros pedidos', () => {
    const result = clientHistory({ orders: [order(), order({ id: 'unpaid' }), order({ id: 'returned', status: 'entregado', returned_at: '2026-11-05T12:00:00Z' })], financial_movements: [movement('0.50'), movement('0.30', { id: 'returned-payment', order_id: 'returned' })] }, 'client', '2026-11');
    expect(result.due).toBe('0.30');
    expect(result.credit).toBe('0.50');
    expect(result.orders.find(entry => entry.order.id === 'returned')).toMatchObject({ due: '0.00', credit: '0.30' });
  });
  it('mantiene gratis saldado sin contaminar la deuda de pedidos con cargo', () => {
    const result = clientHistory({ orders: [order({ id: 'free', payment_method: 'gratis', total: '999.99', status: 'entregado' }), order()], financial_movements: [movement('0.10')] }, 'client', '2026-11');
    expect(result.count).toBe(2); expect(result.paid).toBe('0.10'); expect(result.due).toBe('0.20'); expect(result.credit).toBe('0.00');
    expect(result.orders.find(entry => entry.order.id === 'free')).toMatchObject({ paid: '0.00', due: '0.00', credit: '0.00' });
  });
  it('mantiene lectura útil cuando el snapshot no incluye movimientos', () => {
    const result = clientHistory({ orders: [order()] }, 'client', '2026-11');
    expect(result.paid).toBe('0.00');
    expect(result.due).toBe('0.30');
    expect(clientHistory({ orders: [] }, 'client', '2026-11')).toEqual({ orders: [], count: 0, paid: '0.00', due: '0.00', credit: '0.00' });
  });
});

describe('Actividad y teléfono del cliente', () => {
  it('distingue fecha de alta, primera compra, última compra y pedidos válidos sin activar/inactivar clientes', async () => {
    const { customerActivity } = await import('./clientHistory');
    const clients = [{ id: 'client', name: 'Cliente', version: 1, created_at: '2026-10-01T01:00:00Z' }, { id: 'never', name: 'Nuevo', version: 1 }];
    const orders = [order({ id: 'a', status: 'entregado', total: '10.10', pickup_date: '2026-10-02' }), order({ id: 'b', status: 'entregado', total: '20.20', pickup_date: '2026-11-03' }), order({ id: 'cancel', status: 'cancelado', pickup_date: '2026-09-01' }), order({ id: 'return', status: 'entregado', returned_at: '2026-12-01', pickup_date: '2026-11-01' }), order({ id: 'pending', pickup_date: '2026-11-05' })];
    const result = customerActivity({ clients, orders }, '2026-11', '2026-12-03');
    expect(result[0]).toMatchObject({ createdOn: '2026-09-30', firstPurchase: '2026-10-02', lastPurchase: '2026-11-03', daysSincePurchase: 30, monthlyPurchases: 1, purchaseCount: 2, orderCount: 3, totalSales: '30.30' });
    expect(result[1]).toMatchObject({ createdOn: null, firstPurchase: null, lastPurchase: null, daysSincePurchase: null, totalSales: '0.00' });
    expect(clients[0]).not.toHaveProperty('active');
  });
  it('no convierte una muestra gratis en compra ni cambia primera o última compra', async () => {
    const { customerActivity } = await import('./clientHistory');
    const clients = [{ id: 'client', name: 'Cliente', version: 1 }, { id: 'only-samples', name: 'Muestras', version: 1 }];
    const orders = [order({ id: 'before', payment_method: 'gratis', status: 'entregado', pickup_date: '2026-09-01', total: '999' }), order({ id: 'charged', status: 'entregado', total: '10.10', pickup_date: '2026-10-02' }), order({ id: 'after', payment_method: 'gratis', status: 'entregado', pickup_date: '2026-11-03', total: '999' }), order({ id: 'sample-only', client_id: 'only-samples', payment_method: 'gratis', status: 'entregado' }), order({ id: 'zero-charge', client_id: 'only-samples', total: '0.00', status: 'entregado' })];
    const result = customerActivity({ clients, orders }, '2026-11', '2026-12-03');
    expect(result[0]).toMatchObject({ orderCount: 3, purchaseCount: 1, monthlyPurchases: 0, totalSales: '10.10', firstPurchase: '2026-10-02', lastPurchase: '2026-10-02' });
    expect(result[1]).toMatchObject({ orderCount: 2, purchaseCount: 0, totalSales: '0.00', firstPurchase: null, lastPurchase: null, daysSincePurchase: null });
  });
  it('detecta duplicados ignorando puntuación sin confundir teléfonos vacíos ni el registro editado', async () => {
    const { duplicatePhoneClients } = await import('./clientHistory');
    const clients = [{ id: 'a', name: 'A', phone: '+54 (261) 123-4567', version: 1 }, { id: 'b', name: 'B', phone: '', version: 1 }];
    expect(duplicatePhoneClients(clients, '54 2611234567').map(client => client.id)).toEqual(['a']);
    expect(duplicatePhoneClients(clients, '+54 2611234567', 'a')).toEqual([]); expect(duplicatePhoneClients(clients, '')).toEqual([]);
  });
});
