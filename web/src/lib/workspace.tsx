import { QueryClient, QueryClientProvider, useQuery, useMutation, onlineManager, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, type PropsWithChildren } from 'react';
import type { CommandResult, Operation, Snapshot, WorkspaceExport, WorkspaceMember } from '@shared/lib/types';
import { reliableCommand } from '@shared/lib/commands';
import { AuthProvider, useAuth, backendClient as client, backendConfigured, backendUrl } from './auth';
import { commandStorage } from './storage';

export { backendConfigured } from './auth';
const messages: Record<string, string> = {
  INSUFFICIENT_RESERVED_STOCK: 'Faltan productos reservados en este punto para entregar el pedido.',
  INSUFFICIENT_STOCK: 'No hay stock disponible suficiente para completar esta operación.',
  VERSION_CONFLICT: 'Otra persona modificó este registro. Actualizá los datos y volvé a intentarlo.',
  IDEMPOTENCY_CONFLICT: 'La operación ya fue utilizada con otros datos. Actualizá y volvé a intentarlo.',
  INVALID_TRANSITION: 'El estado actual del registro no permite esta operación.',
  VALIDATION_ERROR: 'Revisá los datos ingresados.',
  PICKUP_CLOSED: 'El punto de retiro se encuentra cancelado para esa fecha.',
  PICKUP_HAS_ORDERS: 'Primero cambiá el día de retiro de los pedidos agendados para este punto.',
  STOCK_CONFIRMATION_REQUIRED: 'STOCK_CONFIRMATION_REQUIRED: El stock y la producción prevista no alcanzan para la fecha del pedido. Revisá la planificación y las cantidades o confirmá el pedido con faltantes.',
  AUTH_REQUIRED: 'Ingresá con tu cuenta personal para continuar.',
  ACCESS_DENIED: 'Tu cuenta no está habilitada para esta operación. Pedile a una administradora que revise tus permisos.',
  FORBIDDEN: 'No tenés permiso para operar en este punto de retiro.',
  DUPLICATE_PHONE: 'Ya hay un cliente con ese teléfono. Buscalo para evitar duplicar su ficha; si no aparece en tu punto, pedile a una administradora que lo vincule.',
  FIRST_PURCHASE_GIFT_NOT_ELIGIBLE: 'La bolsa de regalo solo está disponible en la primera compra del cliente. Revisá si ya compró o si el regalo está reservado en otro pedido.',
};
export function friendlyError(error: { message?: string; details?: string; code?: string }) {
  const raw = error.message || 'No se pudo conectar con Supabase.';
  const code = Object.keys(messages).find(value => raw.includes(value));
  const detail = code && ['VALIDATION_ERROR', 'INVALID_TRANSITION', 'PICKUP_CLOSED', 'PICKUP_HAS_ORDERS'].includes(code) ? raw.split(':').slice(1).join(':').trim() : '';
  const message = code ? `${messages[code]}${detail ? ` ${detail}` : ''}`
    : /JWT|token.*expired/i.test(raw) ? 'Tu sesión venció. Volvé a ingresar para continuar.'
    : /network|fetch|connection/i.test(raw) ? 'No se pudo conectar. Revisá tu conexión e intentá actualizar.'
    : 'No se pudo guardar o actualizar la información. Revisá los datos y volvé a intentarlo.';
  return Object.assign(new Error(message), { code });
}
export interface Workspace {
  data: Snapshot | undefined; isLoading: boolean; isRefreshing: boolean; error: Error | null;
  isOnline: boolean; isConfigured: boolean; isSaving: boolean;
  refresh: () => Promise<unknown>; exportData: () => Promise<WorkspaceExport>;
  setMember: (member: WorkspaceMember) => Promise<void>;
  command: (operation: Operation, payload: Record<string, unknown>, expectedVersion?: number) => Promise<CommandResult>;
}
const Context = createContext<Workspace | null>(null);
function WorkspaceState({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;
  const queryKey = useMemo(() => ['workspace', backendUrl, userId] as const, [userId]);
  const [isOnline, setOnline] = useState(() => navigator.onLine);
  const inFlight = useRef(false);
  useEffect(() => {
    const sync = () => { setOnline(navigator.onLine); onlineManager.setOnline(navigator.onLine); };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);
  const query = useQuery({
    queryKey, enabled: Boolean(client && userId),
    refetchInterval: isOnline && userId ? 60_000 : false, refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await client!.rpc('app_snapshot').abortSignal(signal);
      if (error) throw friendlyError(error);
      if (!data?.profile || !Array.isArray(data.pickup_closures) || !Array.isArray(data.production_plans) || data.features?.first_purchase_gifts !== true || data.features?.editable_delivered_orders !== true) {
        throw new Error('La base necesita la actualización de bolsas de primera compra y edición de pedidos antes de usar esta versión.');
      }
      return data as Snapshot;
    },
  });
  const refresh = useCallback(async () => {
    if (!client || !userId || !onlineManager.isOnline()) return;
    return query.refetch({ cancelRefetch: false });
  }, [userId, query.refetch]);
  useEffect(() => {
    if (!client || !userId) return;
    const channel = client.channel(`workspace-web:${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_events' }, () => {
      void queryClient.invalidateQueries({ queryKey });
    }).subscribe();
    return () => { void client!.removeChannel(channel); };
  }, [userId, queryClient, queryKey]);
  const mutation = useMutation({
    networkMode: 'always',
    mutationFn: async ({ operation, payload, expectedVersion }: { operation: Operation; payload: Record<string, unknown>; expectedVersion?: number }) => {
      if (!client) throw new Error('La conexión a Supabase todavía no está configurada.');
      if (!navigator.onLine) throw new Error('Necesitás conexión a internet para guardar cambios.');
      if (!userId) throw new Error('Ingresá con tu cuenta personal para guardar cambios.');
      return reliableCommand<CommandResult>({
        storage: commandStorage, namespace: `${backendUrl}:${userId}`, operation, payload, version: expectedVersion,
        uuid: () => crypto.randomUUID(), classify: friendlyError,
        invoke: async id => {
          const response = await client!.rpc('app_command', { p_command_id: id, p_operation: operation, p_payload: payload, p_expected_version: expectedVersion ?? null });
          return { data: response.data as CommandResult | null, error: response.error, status: response.status };
        },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: () => { void queryClient.invalidateQueries({ queryKey }); },
  });
  const accessDenied = Boolean(query.error && /AUTH_REQUIRED|ACCESS_DENIED|FORBIDDEN/.test(String((query.error as Error & { code?: string }).code)));
  const command = useCallback<Workspace['command']>(async (operation, payload, expectedVersion) => {
    if (!query.data || accessDenied) throw new Error(query.error?.message || 'Esperá a que termine la sincronización inicial.');
    if (inFlight.current) throw new Error('Esperá a que termine la operación anterior.');
    inFlight.current = true;
    try { return await mutation.mutateAsync({ operation, payload, expectedVersion }); }
    finally { inFlight.current = false; }
  }, [mutation.mutateAsync, query.data, query.error, accessDenied]);
  const exportData = useCallback(async () => {
    if (!client || !navigator.onLine) throw new Error('Necesitás conexión para exportar una copia completa actualizada.');
    const { data, error } = await client.rpc('app_export');
    if (error) throw friendlyError(error);
    if (!data || data.format !== 'pedidos-stock' || data.schema_version !== 2 || !data.exported_at || !data.data?.profile || !data.raw_tables || typeof data.raw_tables !== 'object' || Array.isArray(data.raw_tables) || !Array.isArray(data.idempotency_commands)) {
      throw new Error('No se recibió un respaldo completo válido. No se descargó ningún archivo; volvé a intentarlo.');
    }
    return data as WorkspaceExport;
  }, []);
  const setMember = useCallback(async (member: WorkspaceMember) => {
    if (!client || !navigator.onLine) throw new Error('Necesitás conexión para guardar permisos.');
    const { error } = await client.rpc('app_set_member', {
      p_user_id: member.id, p_role: member.role, p_location_id: member.location_id,
      p_display_name: member.display_name.trim(), p_active: member.active,
    });
    if (error) throw friendlyError(error);
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);
  return <Context.Provider value={{ data: accessDenied ? undefined : query.data, isLoading: query.isLoading && backendConfigured, isRefreshing: query.isFetching, error: query.error, isOnline, isConfigured: backendConfigured, isSaving: mutation.isPending, refresh, exportData, setMember, command }}>{children}</Context.Provider>;
}
function AccountQueries({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: {
    queries: { staleTime: 20_000, gcTime: 86_400_000, retry: 1, refetchOnReconnect: 'always', refetchOnWindowFocus: 'always' },
    mutations: { retry: false },
  } }));
  // On logout/user change discard and cancel the old account's business cache.
  useEffect(() => () => { queryClient.clear(); }, [queryClient]);
  return <QueryClientProvider client={queryClient}><WorkspaceState>{children}</WorkspaceState></QueryClientProvider>;
}
function AccountWorkspace({ children }: PropsWithChildren) {
  const { session } = useAuth();
  return <AccountQueries key={session?.user.id ?? 'signed-out'}>{children}</AccountQueries>;
}
export function WorkspaceProvider({ children }: PropsWithChildren) {
  return <AuthProvider><AccountWorkspace>{children}</AccountWorkspace></AuthProvider>;
}
export function useWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error('WorkspaceProvider requerido');
  return context;
}
