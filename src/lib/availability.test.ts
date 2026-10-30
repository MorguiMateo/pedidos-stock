import { describe, expect, it } from 'vitest';
import { operationalAvailability, orderShortages, physicalContainers, validSaleQuantity } from './availability';
import type { Item, Location, Order, StockBalance } from './types';

const items: Item[] = [{ id: 'food', kind: 'product', name: 'Alimento', unit: 'kg', price: '10', package_size: '0.5', minimum: '2', active: true, version: 1 }];
const locations: Location[] = [{ id: 'a', name: 'Punto A', color: '#000', is_pickup: true }, { id: 'b', name: 'Punto B', color: '#fff', is_pickup: true }];
const stock: [StockBalance] = [{ item_id: 'food', location_id: 'a', on_hand: '10', reserved: '7.5', shortage: '0' }];
const order = (patch: Partial<Order> = {}): Order => ({ id: 'today', client_id: 'client', pickup_date: '2026-10-23', location_id: 'a', payment_method: 'desconocido', status: 'pendiente_entrega', total: '25', notes: '', version: 1, allocation_version: 1, created_at: '2026-10-23T10:00:00Z', delivered_at: null, lines: [{ id: 'line', product_id: 'food', quantity: 2.5, unit_price: '10', reserved: 2.5, shortage: 0 }], ...patch });
const future = order({ id: 'future', pickup_date: '2026-10-30', lines: [{ ...order().lines[0]!, quantity: 5, reserved: 5 }] });

describe('disponibilidad real por punto', () => {
  it('separa pendientes seleccionados del compromiso global y no inventa stock futuro', () => {
    const [today, otherPoint] = operationalAvailability(items, stock, [order(), future], locations, '2026-10-23');
    expect(today!.products[0]).toMatchObject({ pending: '2.5', physical: '10', reserved: '7.5', committed: '7.5', available: '2.5', shortage: '0', belowMinimum: false });
    const nextWeek = operationalAvailability(items, stock, [order(), future], locations, '2026-10-30')[0]!.products[0]!;
    expect(nextWeek).toMatchObject({ pending: '5', physical: '10', available: '2.5', committed: '7.5' });
    expect(otherPoint!.products[0]).toMatchObject({ physical: '0', pending: '0', available: '0', belowMinimum: true });
  });
  it('al entregar baja el pendiente y físico, sin liberar stock ya consumido para otros pedidos', () => {
    const delivered = order({ status: 'entregado' });
    const afterStock = [{ ...stock[0], on_hand: '7.5', reserved: '5' }];
    expect(operationalAvailability(items, afterStock, [delivered, future], locations, '2026-10-23')[0]!.products[0]!).toMatchObject({ pending: '0', physical: '7.5', reserved: '5', available: '2.5' });
  });
  it('al agregar un pedido suben pendientes y faltante, cancelados no comprometen stock', () => {
    const extra = order({ id: 'extra', lines: [{ ...order().lines[0]!, quantity: 4, reserved: 2.5, shortage: 1.5 }] });
    const cancelled = order({ id: 'cancel', status: 'cancelado' });
    expect(operationalAvailability(items, [{ ...stock[0], reserved: '10', shortage: '1.5' }], [order(), future, extra, cancelled], locations, '2026-10-23')[0]!.products[0]!).toMatchObject({ pending: '6.5', selectedShortage: '1.5', committed: '11.5', available: '0', shortage: '1.5', belowMinimum: true });
  });
  it('compara nuevos pedidos contra todos los compromisos y descuenta el propio al editar', () => {
    expect(orderShortages([{ product_id: 'food', quantity: '3' }], 'a', stock, [order(), future])).toEqual([{ product_id: 'food', available: '2.5', shortage: '0.5' }]);
    expect(orderShortages([{ product_id: 'food', quantity: '5' }], 'a', stock, [order(), future], 'today')).toEqual([]);
    expect(orderShortages([{ product_id: 'food', quantity: '5.001' }], 'a', stock, [order(), future], 'today')).toEqual([{ product_id: 'food', available: '5', shortage: '0.001' }]);
    expect(orderShortages([{ product_id: 'food', quantity: '1' }], 'b', stock, [order(), future])).toEqual([{ product_id: 'food', available: '0', shortage: '1' }]);
  });
  it('muestra físico pero excluye stock vencido del disponible y la validación', () => {
    const expiredStock = [{ ...stock[0], on_hand: '10', usable: '6', reserved: '6', shortage: '1.5' }];
    expect(operationalAvailability(items, expiredStock, [order(), future], locations, '2026-10-23')[0]!.products[0]).toMatchObject({ physical: '10', usable: '6', available: '0', shortage: '1.5' });
    expect(orderShortages([{ product_id: 'food', quantity: '1' }], 'a', expiredStock, [future])).toEqual([]);
    expect(orderShortages([{ product_id: 'food', quantity: '2' }], 'a', expiredStock, [future])).toEqual([{ product_id: 'food', available: '1', shortage: '1' }]);
  });
  it('suma líneas repetidas antes de validar y respeta decimales comerciales', () => {
    expect(orderShortages([{ product_id: 'food', quantity: '1,25' }, { product_id: 'food', quantity: '1.5' }], 'a', stock, [order(), future])).toEqual([{ product_id: 'food', available: '2.5', shortage: '0.25' }]);
    expect(validSaleQuantity('1,125', 'kg')).toBe(true);
    expect(validSaleQuantity('0.001', 'kg')).toBe(true);
    for (const quantity of ['0', '-1', '1.2345', 'NaN', '1e3']) expect(validSaleQuantity(quantity, 'kg')).toBe(false);
    expect(validSaleQuantity('1.5', 'unidad')).toBe(false);
    expect(validSaleQuantity('2', 'unidad')).toBe(true);
    expect(physicalContainers('1.5', '0.5')).toBe('3');
    expect(physicalContainers('1.125', '0.5')).toBe('3');
    expect(physicalContainers('1.5')).toBeNull();
  });
});
