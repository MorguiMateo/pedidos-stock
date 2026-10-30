import { describe, expect, it } from 'vitest';
import { defaultPickupClosed, pendingPickups, pickupClosure } from './pickupScheduling';
import type { Order } from './types';

const order = (patch: Partial<Order> = {}): Order => ({ id: 'order', client_id: 'client', pickup_date: '2026-11-03', location_id: 'point-a', payment_method: 'efectivo', status: 'pendiente_entrega', notes: '', total: '15.00', version: 1, allocation_version: 0, created_at: '2026-10-22T12:00:00Z', delivered_at: null, lines: [], ...patch });

describe('Cierres de retiros', () => {
  it('cierra domingos y sábados salvo Mendieta, independientemente de la zona del dispositivo', () => {
    expect(defaultPickupClosed('salta', '2026-11-01')).toBe(true);
    expect(defaultPickupClosed('mendieta', '2026-11-01')).toBe(true);
    expect(defaultPickupClosed('salta', '2026-10-31')).toBe(true);
    expect(defaultPickupClosed('mendieta', '2026-10-31')).toBe(false);
    expect(defaultPickupClosed('uuid-point', '2026-10-31', { name: 'Mendieta' })).toBe(false);
    expect(defaultPickupClosed('salta', '2026-10-30')).toBe(false);
    expect(pickupClosure([], 'salta', '2026-10-31')?.is_default).toBe(true);
  });
  it('permite habilitar manualmente un fin de semana sin abrir otros puntos o días', () => {
    const opening = { id: 'override', location_id: 'salta', pickup_date: '2026-11-01', reason: '', version: 1, closed: false };
    expect(pickupClosure([opening], 'salta', '2026-11-01')).toBeUndefined();
    expect(pickupClosure([opening], 'mendieta', '2026-11-01')).toBeDefined();
    expect(pickupClosure([opening], 'salta', '2026-11-08')).toBeDefined();
    expect(pickupClosure([{ ...opening, closed: true }], 'salta', '2026-11-01')?.is_default).toBeUndefined();
  });
  it('identifica únicamente el día y el punto cerrado, sin bloquear otros retiros', () => {
    const closure = { id: 'closure', location_id: 'point-a', pickup_date: '2026-11-03', reason: 'Feriado', version: 2 };
    expect(pickupClosure([closure], 'point-a', '2026-11-03')).toBe(closure);
    expect(pickupClosure([closure], 'point-b', '2026-11-03')).toBeUndefined();
    expect(pickupClosure([closure], 'point-a', '2026-11-04')).toBeUndefined();
    expect(pickupClosure(undefined, 'point-a', '2026-11-03')).toBeUndefined();
    expect(pickupClosure([], 'point-a', '2026-11-03')).toBeUndefined();
  });
  it('solo exige mover los pendientes del punto y día; permite cerrar al mover el último', () => {
    const orders = [order(), order({ id: 'delivered', status: 'entregado' }), order({ id: 'cancelled', status: 'cancelado' }), order({ id: 'other-day', pickup_date: '2026-11-04' }), order({ id: 'other-point', location_id: 'point-b' })];
    expect(pendingPickups(orders, 'point-a', '2026-11-03').map(entry => entry.id)).toEqual(['order']);
    expect(pendingPickups(orders.map(entry => entry.id === 'order' ? { ...entry, pickup_date: '2026-11-04' } : entry), 'point-a', '2026-11-03')).toEqual([]);
  });
});
