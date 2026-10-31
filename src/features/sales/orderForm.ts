import type { Client } from '../../lib/types';

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const uberArrivalLine = /^Llegada aproximada de Uber: ((?:[01]\d|2[0-3]):[0-5]\d)$/;
const normalizeName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

export function matchingOrderClients(clients: Client[], search: string): Client[] {
  const query = search.trim();
  if (!query) return [];
  const name = normalizeName(query);
  const phone = /^[+\d\s().-]+$/.test(query) ? query.replace(/\D/g, '') : '';
  return clients.filter(client => normalizeName(client.name).includes(name) || (!!phone && !!client.phone?.replace(/\D/g, '').includes(phone)));
}

export const validUberArrivalTime = (value: string) => value === '' || timePattern.test(value);

// Keep ETA in delivery instructions: compatible with existing servers and readable
// by earlier app versions. Never repurpose the independent pickup appointment.
export function readDeliveryInstructions(value = '') {
  let uber_arrival_time = '';
  const delivery_notes = value.split('\n').filter(line => {
    const match = uberArrivalLine.exec(line);
    if (!match) return true;
    uber_arrival_time = match[1]!;
    return false;
  }).join('\n');
  return { uber_arrival_time, delivery_notes };
}

export function savedDeliveryInstructions(notes: string, uber: boolean, arrival: string): string {
  const ordinary = readDeliveryInstructions(notes).delivery_notes.trim();
  return [ordinary, uber && arrival ? `Llegada aproximada de Uber: ${arrival}` : ''].filter(Boolean).join('\n');
}
