import { describe, expect, it } from 'vitest';
import { matchingOrderClients, readDeliveryInstructions, savedDeliveryInstructions, validUberArrivalTime } from './orderForm';

const clients = [
  { id: 'ana', name: 'Ana Pérez', phone: '+54 (261) 555-9000', version: 1 },
  { id: 'bruno', name: 'Bruno', version: 1 },
];

describe('order client search', () => {
  it('does not suggest clients for empty, whitespace, punctuation-only or unmatched queries', () => {
    for (const query of ['', '   ', '+()-', 'No existe', 'Ana1']) expect(matchingOrderClients(clients, query)).toEqual([]);
  });
  it('matches trimmed case/accent-insensitive names and formatted phone numbers', () => {
    for (const query of [' pÉrEz ', '261 555-9', '+54 (261)']) expect(matchingOrderClients(clients, query)).toEqual([clients[0]]);
    expect(matchingOrderClients(clients, 'bruno')).toEqual([clients[1]]);
  });
});

describe('Uber arrival delivery instructions', () => {
  it('round-trips ETA independently of ordinary multiline instructions and removes only its own line', () => {
    const notes = 'Conservar frío\nAvisar al llegar\nUber: consultar patente';
    const saved = savedDeliveryInstructions(notes, true, '00:05');
    expect(readDeliveryInstructions(saved)).toEqual({ delivery_notes: notes, uber_arrival_time: '00:05' });
    expect(savedDeliveryInstructions(saved, false, '00:05')).toBe(notes);
    expect(savedDeliveryInstructions(saved, true, '23:59')).toBe(`${notes}\nLlegada aproximada de Uber: 23:59`);
    expect(savedDeliveryInstructions(notes, true, '')).toBe(notes);
    expect(readDeliveryInstructions()).toEqual({ delivery_notes: '', uber_arrival_time: '' });
  });
  it('preserves legacy freeform or malformed ETA notes rather than silently deleting instructions', () => {
    const notes = 'Llegada aproximada de Uber: consultar\nLlegada aproximada de Uber: 25:99';
    expect(readDeliveryInstructions(notes)).toEqual({ delivery_notes: notes, uber_arrival_time: '' });
  });
  it('allows an optional ETA and validates the same 24-hour format on native and web', () => {
    for (const time of ['', '00:00', '17:30', '23:59']) expect(validUberArrivalTime(time)).toBe(true);
    for (const time of ['24:00', '12:60', '8:30', 'soon', ' 17:30 ']) expect(validUberArrivalTime(time)).toBe(false);
  });
});
