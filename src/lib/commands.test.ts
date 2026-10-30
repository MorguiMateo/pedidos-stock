import { describe, it, expect } from 'vitest';
import { canonical, reliableCommand } from './commands';
function store() { const data = new Map<string, string>(); return { getItem: async (key: string) => data.get(key) ?? null, setItem: async (key: string, value: string) => { data.set(key, value); }, removeItem: async (key: string) => { data.delete(key); } }; }
describe('Confirmación confiable de comandos', () => {
  it('usa el mismo UUID al perder respuesta y recuperarlo tras reiniciar la app', async () => { const storage = store(); const ids: string[] = []; const base = { storage, namespace: 'test', operation: 'save_order', payload: { quantity: 3 }, uuid: () => 'original-command', classify: (error: { message: string }) => new Error(error.message) }; await expect(reliableCommand({ ...base, invoke: async (id) => { ids.push(id); return { data: null, error: { message: 'Failed to fetch' }, status: 0 }; } })).rejects.toThrow('sin duplicarla'); const result = await reliableCommand({ ...base, uuid: () => 'must-not-use', invoke: async (id) => { ids.push(id); return { data: { id: 'order-created-on-first-attempt' }, error: null, status: 200 }; } }); expect(result).toEqual({ id: 'order-created-on-first-attempt' }); expect(ids).toEqual(['original-command','original-command','original-command']); });
  it('una operación confirmada permite repetir intencionalmente la misma carga con otro UUID', async () => { const storage = store(); let counter = 0; const ids: string[] = []; const run = () => reliableCommand({ storage, namespace: 'test', operation: 'save_client', payload: { name: 'Cliente' }, uuid: () => `id-${++counter}`, classify: (error) => new Error(error.message), invoke: async (id) => { ids.push(id); return { data: { id }, error: null, status: 200 }; } }); await run(); await run(); expect(ids).toEqual(['id-1','id-2']); });
  it('rechazos de negocio no reintentan automáticamente ni conservan comandos pendientes', async () => { const storage = store(); let calls = 0; await expect(reliableCommand({ storage, namespace: 'test', operation: 'start_production', payload: { id: 'batch' }, uuid: () => 'command', classify: (error) => new Error(error.message), invoke: async () => { calls++; return { data: null, error: { message: 'INSUFFICIENT_STOCK' }, status: 500 }; } })).rejects.toThrow('INSUFFICIENT_STOCK'); expect(calls).toBe(1); expect(await storage.getItem('command-pending-v1:test')).toBe('{}'); });
  it('reconoce el mismo contenido aunque cambie el orden de campos JSON', () => { expect(canonical({ a: 1, b: { c: 2, d: 3 } })).toBe(canonical({ b: { d: 3, c: 2 }, a: 1 })); });
  it('no confirma un guardado si la respuesta no trae resultado', async () => {
    const storage = store(); const ids: string[] = [];
    await expect(reliableCommand({ storage, namespace: 'empty', operation: 'save_order', payload: {}, uuid: () => 'same-command', classify: error => new Error(error.message), invoke: async id => { ids.push(id); return { data: null, error: null, status: 200 }; } })).rejects.toThrow('No pudimos confirmar');
    expect(ids).toEqual(['same-command', 'same-command']);
    expect(await storage.getItem('command-pending-v1:empty')).toContain('same-command');
  });
  it.each(['STOCK_CONFIRMATION_REQUIRED', 'FIRST_PURCHASE_GIFT_NOT_ELIGIBLE', 'ACCESS_DENIED', 'DUPLICATE_PHONE', 'PICKUP_CLOSED'])('no reintenta el rechazo de negocio %s', async message => {
    const storage = store(); let calls = 0;
    await expect(reliableCommand({ storage, namespace: message, operation: 'save_order', payload: {}, uuid: () => 'rejected-command', classify: error => new Error(error.message), invoke: async () => { calls++; return { data: null, error: { message }, status: 500 }; } })).rejects.toThrow(message);
    expect(calls).toBe(1); expect(await storage.getItem(`command-pending-v1:${message}`)).toBe('{}');
  });
});
