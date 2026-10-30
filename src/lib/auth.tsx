import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
export const backendConfigured = Boolean(url && key && /^https?:\/\//.test(url));
export const backendClient: SupabaseClient | null = backendConfigured ? createClient(url, key, {
  auth: { storage: AsyncStorage, storageKey: `kalak-auth:${url}`, persistSession: true, autoRefreshToken: true, detectSessionInUrl: Platform.OS === 'web' },
}) : null;
export const backendUrl = url;

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
export function AuthProvider({ children }: React.PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(Boolean(backendClient));
  useEffect(() => {
    if (!backendClient) return;
    let active = true;
    const { data: { subscription } } = backendClient.auth.onAuthStateChange((_event, next) => { if (active) { setSession(next); setInitializing(false); } });
    void backendClient.auth.getSession().then(({ data, error }) => { if (active) { setSession(error ? null : data.session); setInitializing(false); } }).catch(() => { if (active) setInitializing(false); });
    const appSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') backendClient.auth.startAutoRefresh(); else backendClient.auth.stopAutoRefresh();
    });
    return () => { active = false; subscription.unsubscribe(); appSubscription.remove(); };
  }, []);
  const signIn = useCallback(async (email: string, password: string) => {
    if (!backendClient) throw new Error('La conexión todavía no está configurada.');
    const { error } = await backendClient.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw authError(error.message);
  }, []);
  const register = useCallback(async (email: string, password: string, name: string) => {
    if (!backendClient) throw new Error('La conexión todavía no está configurada.');
    const { error } = await backendClient.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() } } });
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
