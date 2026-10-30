import type { Location, Order } from './types';

export interface PickupClosureRecord {
  id: string;
  location_id: string;
  pickup_date: string;
  reason: string;
  version: number;
  /** Missing in historical records, which always represent a closure. */
  closed?: boolean;
  is_default?: boolean;
}

/** Weekly rules use the pickup's calendar date, never the device's time zone. */
export function defaultPickupClosed(locationId: string, date: string, location?: Pick<Location, 'name'>) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const isMendieta = [locationId, location?.name ?? ''].some(value => value.trim().toLocaleLowerCase('es-AR') === 'mendieta');
  return weekday === 0 || (weekday === 6 && !isMendieta);
}

/** An explicit opening/closure overrides the recurring weekend rule for this date only. */
export function pickupClosure(closures: readonly PickupClosureRecord[] | undefined, locationId: string, date: string, location?: Pick<Location, 'name'>): PickupClosureRecord | undefined {
  const override = closures?.find(closure => closure.location_id === locationId && closure.pickup_date === date);
  if (override) return override.closed === false ? undefined : override;
  if (!defaultPickupClosed(locationId, date, location)) return undefined;
  return { id: `weekly:${locationId}:${date}`, location_id: locationId, pickup_date: date, closed: true, reason: new Date(`${date}T12:00:00Z`).getUTCDay() === 0 ? 'Domingo: retiros deshabilitados por defecto. Podés habilitar este día manualmente.' : 'Sábado: solo Mendieta está habilitado por defecto. Podés habilitar este punto manualmente.', version: 0, is_default: true };
}

/** Delivered/cancelled orders never prevent closing future pickups. */
export function pendingPickups(orders: readonly Order[], locationId: string, date: string) {
  return orders.filter(order => order.location_id === locationId && order.pickup_date === date && order.status === 'pendiente_entrega');
}
