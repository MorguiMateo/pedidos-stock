import { describe, expect, it } from 'vitest';
import { activePickupLocations, calendarCounts, calendarWeek, dailyProductSummary, groupOrdersByPickup, linePrice, newlyCreatedToday, orderPreparationState, shiftCalendarDate, monthlyClientReport, pickupLocations, preparationSummary } from './calendar';
import type { Item, Location, Order } from './types';

const order = (patch: Partial<Order> = {}): Order => ({ id: 'order', client_id: 'client', pickup_date: '2026-11-03', pickup_time: '17:30', location_id: 'point-a', payment_method: 'efectivo', status: 'pendiente_entrega', notes: '', total: '0.30', version: 1, allocation_version: 0, created_at: '2026-10-22T12:00:00Z', delivered_at: null, packages: 2, prepared_packages: 1, uber: true, lines: [{ id: 'line', product_id: 'food', product_name: 'Alimento original', product_unit: 'kg', quantity: 3, unit_price: '0.10', reserved: 2, shortage: 1 }], ...patch });
const products: Item[] = [{ id: 'food', kind: 'product', name: 'Alimento renombrado', unit: 'unidad', price: '9900', minimum: '0', active: true, version: 2 }, { id: 'supplement', kind: 'product', name: 'Suplemento', unit: 'unidad', price: '0.20', minimum: '0', active: true, version: 1 }];

describe('Total diario de productos válidos', () => {
  const data = (orders: Order[]) => ({ orders, items: products, locations: [{ id: 'point-a', name: 'Centro', color: '#112233', is_pickup: true }] });
  const withQuantity = (id: string, quantity: string, patch: Partial<Order> = {}) => order({ id, lines: [{ ...order().lines[0]!, quantity }], ...patch });
  it('incluye pendientes y entregados, pagados o no y gratis, sin alterar el resumen pendiente', () => {
    const snapshot = data([
      withQuantity('pending', '.10'),
      withQuantity('paid-pending', '.20', { payment_confirmed_at: '2026-11-03T12:00:00Z', prepared_packages: 2 }),
      withQuantity('delivered', '.30', { status: 'entregado' }),
      withQuantity('free', '.40', { payment_method: 'gratis' }),
      withQuantity('cancelled', '999', { status: 'cancelado' }),
      withQuantity('returned', '999', { status: 'entregado', returned_at: '2026-11-04' }),
      withQuantity('other-day', '999', { pickup_date: '2026-11-04' }),
      withQuantity('north', '.50', { location_id: 'archived' }),
    ]);
    const result = dailyProductSummary(snapshot, '2026-11-03', { status: 'cancelado' });
    expect(result.count).toBe(5);
    expect(result.products).toEqual([{ product_id: 'food', name: 'Alimento original', unit: 'kg', quantity: '1.5' }]);
    expect(result.byLocation).toMatchObject([{ location_id: 'point-a', name: 'Centro', count: 4, products: [{ quantity: '1' }] }, { location_id: 'archived', name: 'archived', count: 1, products: [{ quantity: '0.5' }] }]);
    expect(groupOrdersByPickup(snapshot.orders.filter(order => order.pickup_date === '2026-11-03'), snapshot.locations, products)[0]?.pendingProducts[0]?.quantity).toBe('0.7');
    expect(dailyProductSummary(snapshot, '2026-11-03', { location: 'point-a' }).products[0]?.quantity).toBe('1');
  });
  it('filtra cliente y líneas de producto; conserva unidades históricas y precisión arbitraria', () => {
    const mixed = order({ lines: [
      { ...order().lines[0]!, quantity: '.1' },
      { ...order().lines[0]!, id: 'repeat', quantity: '.2' },
      { ...order().lines[0]!, id: 'tiny', quantity: '.00000000000000000001' },
      { ...order().lines[0]!, id: 'units', product_unit: 'unidad', quantity: '2' },
      { id: 'supplement', product_id: 'supplement', product_name: ' ', quantity: 7, unit_price: '1', reserved: 0, shortage: 0 },
      { id: 'archived', product_id: 'missing', quantity: 8, unit_price: '1', reserved: 0, shortage: 0 },
    ] });
    const snapshot = data([mixed, order({ client_id: 'other' })]);
    const result = dailyProductSummary(snapshot, '2026-11-03', { client: 'client', product: 'food' });
    expect(result.count).toBe(1);
    expect(result.products).toEqual([{ product_id: 'food', name: 'Alimento original', unit: 'kg', quantity: '0.30000000000000000001' }, { product_id: 'food', name: 'Alimento original', unit: 'unidad', quantity: '2' }]);
    expect(dailyProductSummary(snapshot, '2026-11-03', { product: 'supplement' }).products).toEqual([{ product_id: 'supplement', name: 'Suplemento', unit: 'unidad', quantity: '7' }]);
    expect(dailyProductSummary(snapshot, '2026-11-03', { product: 'missing' }).products).toEqual([{ product_id: 'missing', name: 'Producto archivado', unit: 'unidad', quantity: '8' }]);
    expect(dailyProductSummary(snapshot, '2026-11-04')).toEqual({ count: 0, products: [], byLocation: [] });
  });
});

describe('Conteos numéricos por día y punto', () => {
  it('cuenta solo pendientes de retiro aunque se filtre el detalle por estado', () => {
    const orders = [order(), order({ id: 'delivered', status: 'entregado' }), order({ id: 'cancelled', status: 'cancelado' }), order({ id: 'other-point', location_id: 'point-b' })];
    expect(calendarCounts(orders, { status: 'pendiente_entrega' })).toEqual({ '2026-11-03': { 'point-a': 1, 'point-b': 1 } });
    expect(calendarCounts(orders, { status: 'cancelado' })).toEqual(calendarCounts(orders));
  });
  it('respeta cliente, producto y punto sin confundir cantidades con número de pedidos', () => {
    const orders = [order(), order({ id: 'other-client', client_id: 'another' }), order({ id: 'other-product', lines: [{ id: 's', product_id: 'supplement', quantity: 80, unit_price: '1', reserved: 80, shortage: 0 }] }), order({ id: 'other-day', pickup_date: '2026-11-04' })];
    expect(calendarCounts(orders, { client: 'client', product: 'food', location: 'point-a' })).toEqual({ '2026-11-03': { 'point-a': 1 }, '2026-11-04': { 'point-a': 1 } });
  });
  it('descubre puntos dinámicos y no utiliza el nombre ni identificadores fijos', () => {
    const locations: Location[] = [{ id: 'uuid-kitchen', name: 'Elaboración', color: '#000', is_pickup: false, active: true }, { id: 'uuid-new', name: 'Nuevo punto', color: '#123', is_pickup: true, active: true }, { id: 'uuid-old', name: 'Anterior', color: '#456', is_pickup: true, active: false }];
    expect(pickupLocations(locations).map(location => location.id)).toEqual(['uuid-new', 'uuid-old']);
    expect(activePickupLocations(locations).map(location => location.id)).toEqual(['uuid-new']);
  });
});

describe('Consumo mensual por cliente', () => {
  it('cuenta no cancelados por retiro y suma solo entregados con precios y unidades históricos', () => {
    const orders = [order(), order({ id: 'delivered', status: 'entregado', delivered_at: '2026-12-01T10:00:00Z' }), order({ id: 'cancelled', status: 'cancelado' }), order({ id: 'other-client', client_id: 'another', status: 'entregado' }), order({ id: 'other-month', pickup_date: '2026-10-31', status: 'entregado' })];
    const report = monthlyClientReport({ orders, items: products }, 'client', '2026-11');
    expect(report.count).toBe(2);
    expect(report.deliveredCount).toBe(1);
    expect(report.total).toBe('0.60');
    expect(report.deliveredAmount).toBe('0.30');
    expect(report.consumption).toEqual([{ product_id: 'food', name: 'Alimento original', unit: 'kg', quantity: '3', amount: '0.30' }]);
  });
  it('separa productos y unidades y conserva la precisión monetaria', () => {
    const orders = [order({ status: 'entregado', total: '0.50', lines: [...order().lines, { id: 's', product_id: 'supplement', product_name: 'Suplemento', product_unit: 'unidad', quantity: 1, unit_price: '0.20', reserved: 1, shortage: 0 }] }), order({ id: 'unit-change', status: 'entregado', total: '1', lines: [{ id: 'u', product_id: 'food', product_unit: 'unidad', quantity: 2, unit_price: '0.50', reserved: 2, shortage: 0 }] })];
    const report = monthlyClientReport({ orders, items: products }, 'client', '2026-11');
    expect(report.consumption).toHaveLength(3);
    expect(report.deliveredAmount).toBe('1.50');
    expect(report.consumption.find(item => item.product_id === 'supplement')?.amount).toBe('0.20');
  });
  it('reconcilia consumo con centavos facturados por pedido al vender fracciones de kg', () => {
    const halfCent = (id: string) => order({ id, status: 'entregado', total: '0.01', lines: [{ id: `${id}-line`, product_id: 'food', product_name: 'Alimento', product_unit: 'kg', quantity: '0.5', unit_price: '0.01', reserved: '0', shortage: '0' }] });
    const report = monthlyClientReport({ orders: [halfCent('one'), halfCent('two')], items: products }, 'client', '2026-11');
    expect(report.total).toBe('0.02');
    expect(report.deliveredAmount).toBe('0.02');
    expect(report.consumption).toEqual([{ product_id: 'food', name: 'Alimento', unit: 'kg', quantity: '1', amount: '0.02' }]);
  });
  it('conserva cantidades de pedidos gratis sin facturarlos como venta', () => {
    const free = order({ payment_method: 'gratis', status: 'entregado' });
    const report = monthlyClientReport({ orders: [free], items: products }, 'client', '2026-11');
    expect(report.count).toBe(1);
    expect(report.total).toBe('0.00');
    expect(report.deliveredAmount).toBe('0.00');
    expect(report.consumption[0]?.quantity).toBe('3');
  });
  it('no presenta las devoluciones como consumo y recupera datos del catálogo en pedidos antiguos', () => {
    const returned = order({ status: 'entregado', returned_at: '2026-11-05T12:00:00Z' });
    const old = order({ id: 'legacy', status: 'entregado', total: '0.25', lines: [{ id: 'legacy-line', product_id: 'food', quantity: 1, unit_price: '0.25', reserved: 1, shortage: 0 }] });
    const report = monthlyClientReport({ orders: [returned, old], items: products }, 'client', '2026-11');
    expect(report.count).toBe(1);
    expect(report.total).toBe('0.25');
    expect(report.deliveredCount).toBe(1);
    expect(report.deliveredAmount).toBe('0.25');
    expect(report.consumption[0]).toMatchObject({ name: 'Alimento renombrado', unit: 'unidad' });
  });
});

describe('Preparación y edición de pedidos', () => {
  it('agrupa solo pendientes por punto y producto, con bultos, Uber, reservas y faltantes', () => {
    const rows = preparationSummary([order(), order({ id: '2' }), order({ status: 'entregado' }), order({ status: 'cancelado' }), order({ client_id: 'another' })], '2026-11-03', { client: 'client', status: 'entregado' });
    expect(rows).toEqual([{ location_id: 'point-a', count: 2, packages: 4, prepared: 2, uber: 2, products: [{ product_id: 'food', name: 'Alimento original', unit: 'kg', quantity: 6, reserved: 4, shortage: 2 }] }]);
  });
  it('el filtro de producto no agrega otras líneas al resumen de preparación', () => {
    const mixed = order({ lines: [...order().lines, { id: 's', product_id: 'supplement', quantity: 4, unit_price: '2', reserved: 4, shortage: 0 }] });
    const rows = preparationSummary([mixed], '2026-11-03', { product: 'supplement' });
    expect(rows[0]?.products).toHaveLength(1);
    expect(rows[0]?.products[0]).toMatchObject({ product_id: 'supplement', quantity: 4 });
    expect(preparationSummary([mixed], '2026-11-04')).toEqual([]);
  });
  it('suma cantidades fraccionarias sin ruido de coma flotante', () => {
    const fractional = (id: string, quantity: number) => order({ id, lines: [{ id, product_id: 'food', quantity, unit_price: '10', reserved: quantity, shortage: 0 }] });
    expect(preparationSummary([fractional('one', 0.1), fractional('two', 0.2)], '2026-11-03')[0]?.products[0]).toMatchObject({ quantity: 0.3, reserved: 0.3 });
  });
  it('conserva el precio original al editar y usa el actual solo para líneas nuevas', () => {
    expect(linePrice('food', products, order())).toBe('0.10');
    expect(linePrice('supplement', products, order())).toBe('0.20');
    expect(linePrice('food', products)).toBe('9900');
  });
});


describe('navegación y avisos de nuevos pedidos', () => {
  it('navega días y semanas cruzando meses y años y conserva fin de mes sin desbordar', () => {
    expect(shiftCalendarDate('2026-12-31', 1, 'day')).toBe('2027-01-01');
    expect(shiftCalendarDate('2026-12-28', 1, 'week')).toBe('2027-01-04');
    expect(shiftCalendarDate('2026-01-31', 1, 'month')).toBe('2026-02-28');
    expect(shiftCalendarDate('2028-01-31', 1, 'month')).toBe('2028-02-29');
    expect(calendarWeek('2027-01-01')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  });
  it('avisa solo IDs nuevos con retiro hoy, no pedidos futuros ni reprogramaciones de pedidos conocidos', () => {
    const baseline = new Set(['old', 'rescheduled']);
    const orders = [order({ id: 'old', pickup_date: '2026-10-23' }), order({ id: 'rescheduled', pickup_date: '2026-10-23' }), order({ id: 'new-today', pickup_date: '2026-10-23', created_at: '2026-10-23T10:00:00Z' }), order({ id: 'new-future', pickup_date: '2026-10-24', created_at: '2026-10-23T10:00:00Z' }), order({ id: 'historical', pickup_date: '2026-10-23', created_at: '2026-10-22T10:00:00Z' }), order({ id: 'utc-next-day', pickup_date: '2026-10-23', created_at: '2026-10-24T01:30:00Z' }), order({ id: 'utc-today-local-yesterday', pickup_date: '2026-10-23', created_at: '2026-10-23T01:30:00Z' }), order({ id: 'cancelled', pickup_date: '2026-10-23', status: 'cancelado' })];
    expect(newlyCreatedToday(orders, baseline, '2026-10-23').map(order => order.id)).toEqual(['new-today', 'utc-next-day']);
    expect(newlyCreatedToday(orders, new Set(orders.map(order => order.id)), '2026-10-23')).toEqual([]);
  });
});


describe('subestado de preparación', () => {
  it('distingue preparación completa sin reemplazar el estado de entrega', () => {
    expect(orderPreparationState(order({ packages: 3, prepared_packages: 2 }))).toBe('pend_preparar');
    expect(orderPreparationState(order({ packages: 3, prepared_packages: 3 }))).toBe('preparado');
    expect(orderPreparationState(order({ packages: undefined, prepared_packages: undefined }))).toBe('pend_preparar');
    expect(orderPreparationState(order({ status: 'entregado', packages: 3, prepared_packages: 3 }))).toBeNull();
    expect(orderPreparationState(order({ status: 'cancelado' }))).toBeNull();
  });
});


describe('Pedidos desplegables por punto de retiro', () => {
  const points: Location[] = [
    { id: 'point-a', name: 'Centro', color: '#112233', is_pickup: true },
    { id: 'point-b', name: 'Norte', color: '#445566', is_pickup: true, active: false },
  ];
  it('separa puntos, respeta el orden del catálogo y conserva el orden de pedidos dentro de cada uno', () => {
    const orders = [order({ id: 'north', location_id: 'point-b' }), order({ id: 'first' }), order({ id: 'second' })];
    const groups = groupOrdersByPickup(orders, points);
    expect(groups.map(group => [group.name, group.orders.map(order => order.id), group.total])).toEqual([
      ['Centro', ['first', 'second'], '0.60'], ['Norte', ['north'], '0.30'],
    ]);
    expect(groups.map(group => group.pendingProducts[0]?.quantity)).toEqual(['6', '3']);
    expect(orders.map(order => order.id)).toEqual(['north', 'first', 'second']);
  });
  it('cuenta gratis pendientes de retiro sin sumar importes a cobrar', () => {
    const group = groupOrdersByPickup([order({ payment_method: 'gratis', total: '100' })], points)[0];
    expect(group).toMatchObject({ pendingCount: 1, total: '0.00' });
    expect(group?.pendingProducts).toEqual([{ product_id: 'food', name: 'Alimento original', unit: 'kg', quantity: '3' }]);
  });
  it('mantiene cancelados y devueltos visibles sin sumarlos al total, y admite puntos archivados', () => {
    const groups = groupOrdersByPickup([
      order({ total: '0.10' }), order({ id: 'paid', status: 'entregado', total: '0.20' }),
      order({ id: 'cancelled', status: 'cancelado', total: '999.00' }),
      order({ id: 'returned', status: 'entregado', returned_at: '2026-11-04', total: '999.00' }),
      order({ id: 'legacy', location_id: 'archived-point' }),
    ], points);
    expect(groups[0]?.total).toBe('0.10');
    expect(groups[0]?.pendingCount).toBe(1);
    expect(groups[0]?.orders).toHaveLength(4);
    expect(groups[1]).toMatchObject({ location_id: 'archived-point', name: 'archived-point', total: '0.30' });
    expect(groupOrdersByPickup([], points)).toEqual([]);
  });
  it('suma productos pendientes aunque estén pagados o sean gratis, sin entregados, cancelados ni devueltos', () => {
    const withQuantity = (id: string, quantity: number, patch: Partial<Order> = {}) => order({ id, lines: [{ ...order().lines[0]!, quantity }], ...patch });
    const group = groupOrdersByPickup([
      withQuantity('unpaid', 3, { total: '0.10' }),
      withQuantity('paid-pending', 2, { total: '0.20', payment_confirmed_at: '2026-11-03T12:00:00Z' }),
      withQuantity('free-pending', 4, { total: '100.00', payment_method: 'gratis' }),
      withQuantity('delivered', 99, { status: 'entregado' }),
      withQuantity('cancelled', 99, { status: 'cancelado' }),
      withQuantity('returned-delivered', 99, { status: 'entregado', returned_at: '2026-11-04' }),
      withQuantity('returned-pending', 99, { returned_at: '2026-11-04' }),
    ], points, products)[0];
    expect(group).toMatchObject({ pendingCount: 3, total: '0.30' });
    expect(group?.orders).toHaveLength(7);
    expect(group?.pendingProducts).toEqual([{ product_id: 'food', name: 'Alimento original', unit: 'kg', quantity: '9' }]);
  });
  it('agrega líneas repetidas dentro y entre pedidos sin perder precisión decimal', () => {
    const line = (id: string, quantity: number | string) => ({ ...order().lines[0]!, id, quantity });
    const group = groupOrdersByPickup([
      order({ lines: [line('first', 0.1), line('duplicate', '0.2')] }),
      order({ id: 'second', lines: [line('tiny', '0.00000000000000000001')] }),
    ], points)[0];
    expect(group?.pendingProducts).toEqual([{ product_id: 'food', name: 'Alimento original', unit: 'kg', quantity: '0.30000000000000000001' }]);
  });
  it('separa productos por identificador y unidad histórica, aunque compartan nombre', () => {
    const group = groupOrdersByPickup([order({ lines: [
      { ...order().lines[0]!, quantity: 2 },
      { ...order().lines[0]!, id: 'units', product_unit: 'unidad', quantity: 4 },
      { ...order().lines[0]!, id: 'other-product', product_id: 'other', quantity: 7 },
      { ...order().lines[0]!, id: 'more-kg', quantity: 0.5 },
    ] })], points, products)[0];
    expect(group?.pendingProducts).toEqual([
      { product_id: 'food', name: 'Alimento original', unit: 'kg', quantity: '2.5' },
      { product_id: 'food', name: 'Alimento original', unit: 'unidad', quantity: '4' },
      { product_id: 'other', name: 'Alimento original', unit: 'kg', quantity: '7' },
    ]);
  });
  it('recupera nombres y unidades del catálogo para líneas antiguas y soporta productos archivados', () => {
    const legacyLine = { id: 'legacy', product_id: 'food', quantity: 2, unit_price: '1', reserved: 0, shortage: 2 };
    const group = groupOrdersByPickup([order({ lines: [
      legacyLine,
      { ...legacyLine, id: 'blank-name', product_id: 'supplement', product_name: ' ' },
      { ...legacyLine, id: 'archived', product_id: 'missing', product_name: 'Nombre histórico', product_unit: 'g' },
      { ...legacyLine, id: 'unknown', product_id: 'unknown' },
    ] })], points, products)[0];
    expect(group?.pendingProducts).toEqual([
      { product_id: 'food', name: 'Alimento renombrado', unit: 'unidad', quantity: '2' },
      { product_id: 'supplement', name: 'Suplemento', unit: 'unidad', quantity: '2' },
      { product_id: 'missing', name: 'Nombre histórico', unit: 'g', quantity: '2' },
      { product_id: 'unknown', name: 'Producto archivado', unit: 'unidad', quantity: '2' },
    ]);
  });
  it('devuelve una lista vacía si el punto solo contiene pedidos no pendientes', () => {
    const group = groupOrdersByPickup([order({ status: 'entregado' }), order({ status: 'cancelado' }), order({ returned_at: '2026-11-04' })], points, products)[0];
    expect(group).toMatchObject({ pendingCount: 0, total: '0.00', pendingProducts: [] });
    expect(group?.orders).toHaveLength(3);
  });
});
