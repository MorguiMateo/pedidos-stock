import { describe, expect, it } from 'vitest';
import { validSaleQuantity } from '../../lib/availability';
import type { Client, Item, Order } from '../../lib/types';
import { appendableOrders, canSelectFirstPurchaseGift, combinedSaleLines, combinedSaleTotal, draftSaleTotal, editableOrder, orderProducts, formulaFirst, productAbbreviation, latestClientOrder, pickupDateLabel, uncollectedOrders, saleLinePayload, saleQuantity, stockCheckLines } from './orderPresentation';

const order = { id: 'order', client_id: 'client', location_id: 'point', status: 'pendiente_entrega', pickup_date: '2026-10-28', created_at: '2026-10-28T12:00:00Z', lines: [{ product_id: 'food', product_name: 'Alimento original', product_unit: 'kg', quantity: '2.500000', unit_price: '100.00' }] } as Order;

describe('editable and summarized sales quantities', () => {
  it('removes database scale without rounding valid commercial quantities', () => {
    expect(saleQuantity('2.000000')).toBe('2');
    expect(saleQuantity('0.125000')).toBe('0.125');
    expect(validSaleQuantity(saleQuantity('2.000000'), 'unidad')).toBe(true);
    expect(validSaleQuantity(saleQuantity('0.125000'), 'kg')).toBe(true);
    expect(validSaleQuantity(saleQuantity('0.125001'), 'kg')).toBe(false);
  });
  it('summarizes products with historical names and readable quantities', () => {
    expect(orderProducts(order)).toBe('2.5 kg X Alimento original');
  });
});

describe('spontaneous sale combined with an existing order', () => {
  it('offers only pending orders for the selected client and pickup point', () => {
    const candidates = [order, { ...order, id: 'other-client', client_id: 'other' }, { ...order, id: 'other-location', location_id: 'other' }, { ...order, id: 'delivered', status: 'entregado' as const }, { ...order, id: 'cancelled', status: 'cancelado' as const }, { ...order, id: 'returned', returned_at: '2026-10-28' }];
    expect(appendableOrders(candidates, 'client', 'point').map(item => item.id)).toEqual(['order']);
    expect(appendableOrders(candidates, '', 'point')).toEqual([]);
  });
  it('rounds combined historic and added fractions once, avoiding a phantom cent', () => {
    const original = { ...order, total: '0.01', lines: [{ ...order.lines[0]!, quantity: '0.5', unit_price: '0.01' }] };
    expect(combinedSaleTotal('0.005', original).toFixed(2)).toBe('0.01');
  });
  it('checks stock for the whole combined order, summing duplicate products exactly', () => {
    const extra = [{ product_id: 'food', quantity: '0,125' }, { product_id: 'supplement', quantity: '2' }];
    expect(combinedSaleLines(extra, order)).toEqual([{ product_id: 'food', quantity: '2.625' }, { product_id: 'supplement', quantity: '2' }]);
    expect(order.lines[0]?.quantity).toBe('2.500000');
    expect(combinedSaleLines(extra)).toBe(extra);
  });
});


describe('first-purchase gift inside a real order', () => {
  const client = (patch: Partial<NonNullable<Client['first_purchase_gift']>> = {}) => ({ id: 'client', name: 'Ana', version: 1, first_purchase_gift: { eligible: true, order_id: null, state: 'available', ...patch } }) as Client;
  const products = [{ id: 'food', unit: 'kg', price: '100' }, { id: 'bag', unit: 'unidad', price: '50', first_purchase_gift_eligible: true }] as Item[];
  const gifted = { ...order, lines: [...order.lines, { id: 'gift', product_id: 'bag', product_name: 'Bolsa', product_unit: 'unidad', quantity: '2', unit_price: '0', list_unit_price: '40', is_gift: true, reserved: 2, shortage: 0 }] } as Order;

  it('uses only globally supplied eligibility and respects a first order at a hidden point', () => {
    expect(canSelectFirstPurchaseGift(undefined)).toBe(false);
    expect(canSelectFirstPurchaseGift({ id: 'client' } as Client)).toBe(false);
    expect(canSelectFirstPurchaseGift(client())).toBe(true);
    expect(canSelectFirstPurchaseGift(client({ order_id: 'hidden-order', state: 'first_purchase' }))).toBe(false);
    expect(canSelectFirstPurchaseGift(client({ order_id: 'hidden-order', state: 'first_purchase' }), 'hidden-order')).toBe(true);
    expect(canSelectFirstPurchaseGift(client({ eligible: false, state: 'unavailable' }), 'hidden-order')).toBe(false);
  });
  it('excludes gifted bags from the charge without making food free, restoring historical bag price when unticked', () => {
    const lines = [{ product_id: 'food', quantity: '2,5' }, { product_id: 'bag', quantity: '2', is_gift: true }];
    expect(draftSaleTotal(lines, products, gifted).toFixed(2)).toBe('250.00');
    expect(draftSaleTotal(lines.map(line => ({ ...line, is_gift: false })), products, gifted).toFixed(2)).toBe('330.00');
    expect(combinedSaleTotal('100', gifted).toFixed(2)).toBe('350.00');
    expect(orderProducts(gifted)).toContain('2 X BOL · Regalo');
  });
  it('preserves gift flags and normal bag quantities when saving metadata or quantity edits', () => {
    const lines = [{ product_id: 'food', quantity: ' 2,500 ' }, { product_id: 'bag', quantity: '3', is_gift: true }];
    expect(saleLinePayload(lines)).toEqual([{ product_id: 'food', quantity: '2.5', is_gift: false }, { product_id: 'bag', quantity: '3', is_gift: true }]);
    expect(saleLinePayload([{ ...lines[1]!, is_gift: false }])).toEqual([{ product_id: 'bag', quantity: '3', is_gift: false }]);
    expect(combinedSaleLines(lines)[1]).toMatchObject({ product_id: 'bag', quantity: '3' });
  });
  it('allows editing delivered orders without accepting cancelled or returned ones', () => {
    expect(editableOrder(order)).toBe(true);
    expect(editableOrder({ ...order, status: 'entregado' })).toBe(true);
    expect(editableOrder({ ...order, status: 'cancelado' })).toBe(false);
    expect(editableOrder({ ...order, status: 'entregado', returned_at: '2026-10-28' })).toBe(false);
  });
  it('checks stock only for delivered quantity increases at the same point, including free bags', () => {
    const delivered = { ...gifted, status: 'entregado' } as Order;
    const lines = [{ product_id: 'food', quantity: '2.5' }, { product_id: 'bag', quantity: '3', is_gift: true }];
    expect(stockCheckLines(lines, 'point', delivered)).toEqual([{ product_id: 'bag', quantity: '1', is_gift: true }]);
    expect(stockCheckLines(lines, 'new-point', delivered)).toBe(lines);
    expect(stockCheckLines(lines, 'point', gifted)).toBe(lines);
    expect(stockCheckLines([{ product_id: 'bag', quantity: '1', is_gift: true }], 'point', delivered)).toEqual([]);
  });
});


describe('daily sales operations presentation', () => {
  it('abbreviates every product and puts both formulas first on separate lines without unit noise', () => {
    const names = ['Caldo de colágeno', 'Vinagre de sidra de manzana', 'Semillas de zapallo', 'Calcio', 'Bolsas de tela', 'Fórmula gato', 'Fórmula perro'];
    expect(names.map(productAbbreviation)).toEqual(['CC', 'VIN', 'SEM', 'K', 'BOL', 'FG', 'FP']);
    const source = names.map(name => ({ name }));
    expect(formulaFirst(source).map(item => item.name)).toEqual([names[6], names[5], ...names.slice(0, 5)]);
    expect(source[0]?.name).toBe(names[0]);
    const basket: Pick<Order, 'lines'> = { lines: names.map((product_name, i) => ({ ...order.lines[0]!, product_id: `p-${i}`, product_name, product_unit: 'unidad', quantity: '10.000000' })) };
    expect(orderProducts(basket)).toBe('10 X FP\n10 X FG\n10 X CC\n10 X VIN\n10 X SEM\n10 X K\n10 X BOL');
  });
  it('uses latest creation, not latest scheduled date, and never repeats cancelled orders', () => {
    const old = { ...order, id: 'old', created_at: '2026-10-01T12:00:00Z', pickup_date: '2026-12-01' };
    const latest = { ...order, id: 'new', created_at: '2026-10-29T12:00:00Z', pickup_date: '2026-10-30', status: 'entregado' as const };
    expect(latestClientOrder([old, latest, { ...latest, id: 'cancelled', created_at: '2026-10-30T12:00:00Z', status: 'cancelado' }], 'client')?.id).toBe('new');
    expect(latestClientOrder([latest], '')).toBeUndefined();
    expect(latestClientOrder([latest], 'another')).toBeUndefined();
  });
  it('includes overdue pickups all day and adds today only at 20:45 Mendoza time', () => {
    const orders = [{ ...order, id: 'yesterday', pickup_date: '2026-10-29' }, { ...order, id: 'today', pickup_date: '2026-10-30' }, { ...order, id: 'tomorrow', pickup_date: '2026-10-31' }, { ...order, id: 'delivered', status: 'entregado' as const }, { ...order, id: 'cancelled', status: 'cancelado' as const }];
    expect(uncollectedOrders(orders, new Date('2026-10-30T23:44:59Z')).map(item => item.id)).toEqual(['yesterday']);
    expect(uncollectedOrders(orders, new Date('2026-10-30T23:45:00Z')).map(item => item.id)).toEqual(['yesterday', 'today']);
    expect(uncollectedOrders(orders, new Date('2026-10-31T03:00:00Z')).map(item => item.id)).toEqual(['yesterday', 'today']);
  });
  it('labels today and tomorrow with Spanish weekday and full date across month boundaries', () => {
    expect(pickupDateLabel('2026-10-30', '2026-10-30')).toMatch(/^HOY VIERNES.*30 DE OCTUBRE DE 2026$/);
    expect(pickupDateLabel('2026-10-31', '2026-10-30')).toMatch(/^MAÑANA SÁBADO/);
    expect(pickupDateLabel('2026-11-01', '2026-10-31')).toMatch(/^MAÑANA DOMINGO/);
    expect(pickupDateLabel('2026-11-02', '2026-10-30')).toMatch(/^LUNES/);
    expect(pickupDateLabel('', '2026-10-30')).toBe('');
  });
});
