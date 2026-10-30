import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react';

const url = import.meta.env.VITE_SUPABASE_URL || '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
export const backendConfigured = Boolean(url && key && /^https?:\/\//.test(url));
export const backendUrl = url;
export const backendClient: SupabaseClient | null = backendConfigured ? createClient(url, key, {
  auth: { storageKey: `kalak-auth:${url}`, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

interface AuthState {
  session: Session | null;
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
}
const Context = createContext<AuthState | null>(null);
function authError(message: string) {
  if (/invalid login credentials/i.test(message)) return new Error('El correo o la contraseña no son correctos.');
  if (/email not confirmed/i.test(message)) return new Error('Confirmá tu correo antes de ingresar.');
  if (/already registered/i.test(message)) return new Error('Este correo ya tiene una cuenta. Ingresá con tu contraseña.');
  if (/rate limit|too many/i.test(message)) return new Error('Hubo demasiados intentos. Esperá unos minutos antes de volver a intentar.');
  if (/network|fetch/i.test(message)) return new Error('No se pudo conectar. Revisá tu conexión a internet.');
  return new Error('No pudimos completar el acceso. Revisá los datos y volvé a intentarlo.');
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(Boolean(backendClient));
  useEffect(() => {
    if (!backendClient) return;
    let active = true;
    let authEventReceived = false;
    const setCurrent = (next: Session | null) => {
      if (!active) return;
      setSession(next);
      setInitializing(false);
    };
    const { data: { subscription } } = backendClient.auth.onAuthStateChange((_event, next) => {
      authEventReceived = true;
      setCurrent(next);
    });
    void backendClient.auth.getSession().then(({ data, error }) => {
      if (!authEventReceived) setCurrent(error ? null : data.session);
    }).catch(() => { if (active) setInitializing(false); });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  const signIn = useCallback(async (email: string, password: string) => {
    if (!backendClient) throw new Error('La conexión todavía no está configurada.');
    const { error } = await backendClient.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw authError(error.message);
  }, []);
  const register = useCallback(async (email: string, password: string, name: string) => {
    if (!backendClient) throw new Error('La conexión todavía no está configurada.');
    const { error } = await backendClient.auth.signUp({
      email: email.trim(), password,
      options: { data: { display_name: name.trim() }, emailRedirectTo: window.location.origin },
    });
    if (error) throw authError(error.message);
  }, []);
  const signOut = useCallback(async () => {
    if (!backendClient) return;
    const { error } = await backendClient.auth.signOut({ scope: 'local' });
    if (error) throw authError(error.message);
    setSession(null);
  }, []);
  return <Context.Provider value={{ session, initializing, signIn, register, signOut }}>{children}</Context.Provider>;
}
export function useAuth() {
  const state = useContext(Context);
  if (!state) throw new Error('AuthProvider requerido');
  return state;
}
