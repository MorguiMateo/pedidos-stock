export interface RpcFailure { message: string; details?: string; code?: string; }
interface StoredCommand { id: string; createdAt: number; }
interface Storage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void>; }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export async function reliableCommand<T>({ storage, namespace, operation, payload, version, uuid, invoke, classify }: { storage: Storage; namespace: string; operation: string; payload: Record<string, unknown>; version?: number; uuid: () => string; invoke: (id: string) => Promise<{ data: T | null; error: RpcFailure | null; status: number }>; classify: (failure: RpcFailure) => Error }): Promise<T> {
  const storageKey = `command-pending-v1:${namespace}`;
  const fingerprint = canonical([operation, payload, version ?? null]);
  const pending = JSON.parse(await storage.getItem(storageKey) || '{}') as Record<string, StoredCommand>;
  const previous = pending[fingerprint];
  const id = previous?.id || uuid();
  pending[fingerprint] = { id, createdAt: previous?.createdAt || Date.now() };
  await storage.setItem(storageKey, JSON.stringify(pending));
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Awaited<ReturnType<typeof invoke>>;
    try { response = await invoke(id); } catch { response = { data: null, error: { message: 'No se pudo confirmar la operación por un problema de conexión.' }, status: 0 }; }
    if (!response.error && response.data !== null && response.data !== undefined) { delete pending[fingerprint]; await storage.setItem(storageKey, JSON.stringify(pending)); return response.data as T; }
    if (!response.error) response = { data: null, error: { message: 'No se recibió confirmación del guardado.' }, status: 502 };
    const failure = response.error!;
    const domainError = /VALIDATION_ERROR|INSUFFICIENT_STOCK|INSUFFICIENT_RESERVED_STOCK|VERSION_CONFLICT|IDEMPOTENCY_CONFLICT|INVALID_TRANSITION|STOCK_CONFIRMATION_REQUIRED|FIRST_PURCHASE_GIFT_NOT_ELIGIBLE|AUTH_REQUIRED|ACCESS_DENIED|FORBIDDEN|DUPLICATE_PHONE|PICKUP_CLOSED|PICKUP_HAS_ORDERS/.test(failure.message);
    const uncertain = !domainError && (response.status === 0 || response.status >= 500);
    if (uncertain && attempt === 0) continue;
    if (!uncertain) { delete pending[fingerprint]; await storage.setItem(storageKey, JSON.stringify(pending)); }
    if (uncertain) throw new Error('No pudimos confirmar el resultado. Actualizá para revisar los datos; si reintentás con los mismos datos, se verificará la misma operación sin duplicarla.');
    throw classify(failure);
  }
  throw new Error('No se pudo confirmar la operación.');
}
