import React, { useState } from 'react';
import { View } from 'react-native';
import { ActivityIndicator, Button, Text, TextInput } from 'react-native-paper';
import { useAuth, backendConfigured } from '../../lib/auth';
import { Notice, Screen, Panel } from '../../components/ui';
import { KalakLogo } from '../../components/brand';

export function AuthGate({ children }: React.PropsWithChildren) {
  const auth = useAuth();
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  if (auth.initializing) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator accessibilityLabel="Verificando sesión" /></View>;
  if (auth.session) return <>{children}</>;
  const submit = async () => {
    if (busy) return;
    setError(''); setMessage('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !password) return setError('Ingresá tu correo y contraseña.');
    if (registering && (!name.trim() || password.length < 8)) return setError('Ingresá tu nombre y una contraseña de al menos 8 caracteres.');
    setBusy(true);
    try {
      if (registering) {
        await auth.register(email, password, name);
        setMessage('Solicitud registrada. Si recibís un correo de confirmación, abrilo. Una administradora debe habilitar tu cuenta antes de que puedas ver los datos.');
        setRegistering(false);
      } else await auth.signIn(email, password);
      setPassword('');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo ingresar.'); } finally { setBusy(false); }
  };
  return <Screen title="KALAK" subtitle="Gestión de pedidos y puntos de retiro"><View style={{ maxWidth: 460, width: '100%', alignSelf: 'center' }}><Panel>
    <KalakLogo /><Text variant="headlineSmall">{registering ? 'Solicitar acceso' : 'Ingresar con tu cuenta'}</Text>
    {!backendConfigured ? <Notice tone="warning" text="Falta configurar la conexión a Supabase. No se pueden guardar datos ni ingresar todavía." /> : null}
    {error ? <Notice tone="error" text={error} /> : null}{message ? <Notice text={message} /> : null}
    {registering ? <TextInput mode="outlined" label="Tu nombre" accessibilityLabel="Tu nombre" value={name} onChangeText={setName} disabled={busy} /> : null}
    <TextInput mode="outlined" label="Correo" accessibilityLabel="Correo" keyboardType="email-address" autoCapitalize="none" autoComplete="email" value={email} onChangeText={setEmail} disabled={busy} />
    <TextInput mode="outlined" label="Contraseña" accessibilityLabel="Contraseña" secureTextEntry autoCapitalize="none" autoComplete={registering ? 'new-password' : 'current-password'} value={password} onChangeText={setPassword} disabled={busy} onSubmitEditing={() => void submit()} />
    <Button mode="contained" onPress={() => void submit()} loading={busy} disabled={busy || !backendConfigured}>{registering ? 'Solicitar acceso' : 'Ingresar'}</Button>
    <Button onPress={() => { setRegistering(!registering); setError(''); }} disabled={busy}>{registering ? 'Ya tengo cuenta' : 'Solicitar una cuenta personal'}</Button>
    <Text variant="bodySmall">Cada operación queda asociada a tu usuario. No compartas tu contraseña.</Text>
  </Panel></View></Screen>;
}
