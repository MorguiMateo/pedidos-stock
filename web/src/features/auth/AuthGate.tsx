import { useState, type FormEvent, type PropsWithChildren } from 'react';
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, PackageCheck, CalendarDays, Users, ShieldCheck } from 'lucide-react';
import { backendConfigured, useAuth } from '@/lib/auth';
import { Brand, Guarda } from '@/components/Brand';

export default function AuthGate({ children }: PropsWithChildren) {
  const auth = useAuth();
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  if (auth.initializing) return <div className="grid min-h-dvh place-items-center"><div role="status" className="flex items-center gap-3"><LoaderCircle className="animate-spin text-orange-700" />Verificando sesión…</div></div>;
  if (auth.session) return children;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo ingresar.'); }
    finally { setBusy(false); }
  };
  return <div className="flex min-h-dvh flex-col">
    <header className="flex items-center justify-between px-6 py-5 sm:px-10"><Brand /><span className="hidden items-center gap-2 text-xs text-stone-500 sm:flex"><ShieldCheck size={15} /> Espacio de trabajo privado</span></header>
    <Guarda />
    <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 py-12 lg:grid-cols-2 lg:gap-24 lg:px-12 lg:py-20">
      <section className="hidden lg:block">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-brand-soft px-3 py-1.5 text-[11px] font-semibold tracking-[.18em] text-orange-800"><span className="h-1.5 w-1.5 rounded-full bg-orange-600" /> GESTIÓN KALAK</div>
        <h1 className="font-display text-6xl leading-[1.08] font-semibold tracking-[.01em]">Todo en orden.<br /><span className="text-orange-700">Todo conectado.</span></h1>
        <p className="mt-6 max-w-sm text-base leading-7 text-stone-600">Pedidos, clientes y stock en un mismo lugar. La información de tus puntos de retiro, siempre al día.</p>
        <div className="mt-10 grid gap-5">
          {[{ Icon: CalendarDays, title: 'Cada pedido, a tiempo', text: 'Organizá retiros, entregas y cobros.' }, { Icon: PackageCheck, title: 'Stock bajo control', text: 'Reservas y producción sin doble conteo.' }, { Icon: Users, title: 'Un equipo conectado', text: 'Las mismas cuentas y datos que en la app.' }].map(({ Icon, title, text }) => <div key={title} className="flex gap-4"><div className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-white shadow-card"><Icon size={19} className="text-orange-700" /></div><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs text-stone-500">{text}</p></div></div>)}
        </div>
      </section>
      <section className="mx-auto w-full max-w-md rounded-2xl border border-line bg-white p-7 shadow-raised sm:p-10" aria-labelledby="access-title">
        <div className="mb-6 grid size-11 place-items-center rounded-xl border border-orange-200/70 bg-brand-soft text-orange-700"><LockKeyhole size={20} /></div>
        <p className="text-[11px] font-semibold tracking-[.18em] text-stone-500">BIENVENIDO A KALAK</p>
        <h2 id="access-title" className="font-display mt-2 text-3xl font-semibold">{registering ? 'Solicitar acceso' : 'Ingresá a tu espacio'}</h2>
        <p className="mb-7 mt-2 text-sm leading-6 text-stone-500">{registering ? 'Creá tu cuenta personal. Una administradora te asignará tu punto de retiro.' : 'Usá la misma cuenta personal que en la aplicación.'}</p>
        {!backendConfigured && <div className="notice warning mb-5" role="status">Falta configurar la conexión a Supabase. No se pueden guardar datos ni ingresar todavía.</div>}
        {error && <div className="notice error mb-5" role="alert">{error}</div>}
        {message && <div className="notice success mb-5" role="status">{message}</div>}
        <form onSubmit={event => void submit(event)} className="grid gap-5">
          {registering && <label className="field">Tu nombre<input name="name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} disabled={busy} required /></label>}
          <label className="field">Correo<input name="email" type="email" autoComplete="email" placeholder="nombre@correo.com" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} required /></label>
          <label className="field">Contraseña<div className="relative"><input name="password" className="w-full pr-12" type={visible ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} minLength={registering ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} required /><button type="button" className="absolute inset-y-0 right-0 grid w-11 place-items-center text-stone-500" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
          <button type="submit" className="btn-primary mt-1 w-full justify-between" disabled={busy || !backendConfigured}>{busy ? <><LoaderCircle size={17} className="animate-spin" /> Procesando…</> : <>{registering ? 'Solicitar acceso' : 'Ingresar'}<ArrowRight size={18} /></>}</button>
        </form>
        <div className="my-6 border-t border-line-soft" />
        <p className="text-center text-xs text-stone-500">{registering ? '¿Ya tenés una cuenta?' : '¿Todavía no tenés acceso?'}</p>
        <button className="mt-2 min-h-10 w-full rounded-lg text-center text-sm font-semibold text-orange-800 underline-offset-4 hover:underline" disabled={busy} onClick={() => { setRegistering(!registering); setError(''); }}>{registering ? 'Volver a ingresar' : 'Solicitar una cuenta personal'}</button>
      </section>
    </main>
    <footer className="px-6 pb-6 text-center text-[11px] text-stone-500">KALAK · Comida real para mascotas · Mendoza, Argentina</footer>
  </div>;
}
