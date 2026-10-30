import { Component, lazy, Suspense, useState, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { CalendarDays, Users, Package, ChartNoAxesCombined, Settings, LogOut, RefreshCw, LoaderCircle, Menu, X, WifiOff, ChevronRight, ArrowUpRight, AlertCircle } from 'lucide-react';
import { WorkspaceProvider, useWorkspace } from '@/lib/workspace';
import { useAuth } from '@/lib/auth';
import { Brand, Guarda } from '@/components/Brand';
import { formatDate, today } from '@shared/lib/format';
import AuthGate from '@/features/auth/AuthGate';

const SalesScreen = lazy(() => import('@/features/sales/SalesScreen'));
const ClientsScreen = lazy(() => import('@/features/clients/ClientsScreen'));
const StockScreen = lazy(() => import('@/features/stock/StockScreen'));
const ReportsScreen = lazy(() => import('@/features/reports/ReportsScreen'));
const SettingsScreen = lazy(() => import('@/features/settings/SettingsScreen'));
const navigation = [
  { to: '/', title: 'Ventas', caption: 'Pedidos y calendario', Icon: CalendarDays },
  { to: '/clientes', title: 'Clientes', caption: 'Contactos y seguimiento', Icon: Users },
  { to: '/stock', title: 'Stock', caption: 'Inventario y cocina', Icon: Package },
  { to: '/resumen', title: 'Resumen', caption: 'Informes y caja', Icon: ChartNoAxesCombined, admin: true },
  { to: '/ajustes', title: 'Ajustes', caption: 'Catálogo y equipo', Icon: Settings, admin: true },
];

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Never log business data or credentials. */ }
  render() {
    return this.state.failed ? <div className="mx-auto my-16 max-w-md rounded-2xl border border-line bg-white p-8 text-center shadow-card" role="alert"><AlertCircle className="mx-auto mb-4 text-orange-700" /><h1 className="font-display text-2xl font-semibold">No pudimos mostrar esta vista</h1><p className="mt-3 text-sm text-stone-600">Tus datos guardados no se modificaron. Volvé a cargar para continuar.</p><button className="btn-primary mt-6" onClick={() => window.location.reload()}>Volver a cargar</button></div> : this.props.children;
  }
}

function Shell() {
  const workspace = useWorkspace();
  const auth = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const { data, isOnline, isConfigured, isRefreshing, error } = workspace;
  const admin = data?.profile?.role === 'admin';
  const links = navigation.filter(link => !link.admin || admin);
  const current = links.find(link => link.to === location.pathname) ?? links[0]!;
  const assigned = data?.locations.find(point => point.id === data.profile?.location_id);
  const connectionLabel = !isOnline ? 'Sin conexión' : !isConfigured ? 'Sin configurar' : error ? 'Sin sincronizar' : isRefreshing ? 'Sincronizando' : 'Sincronizado';
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true); setSignOutError('');
    try { await auth.signOut(); } catch (e) { setSignOutError(e instanceof Error ? e.message : 'No se pudo cerrar la sesión.'); }
    finally { setSigningOut(false); }
  };
  return <div className="min-h-dvh bg-canvas">
    <a href="#contenido" className="sr-only z-50 rounded-lg bg-white p-3 text-sm font-semibold shadow-raised focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Saltar al contenido</a>
    {menuOpen && <button className="fixed inset-0 z-30 bg-stone-950/30 lg:hidden" aria-label="Cerrar navegación" onClick={() => setMenuOpen(false)} />}
    <aside id="navegacion" className={`fixed inset-y-0 left-0 z-40 w-64 flex-col overflow-y-auto border-r border-line bg-paper lg:flex ${menuOpen ? 'flex shadow-raised' : 'hidden'}`}>
      <div className="flex h-24 shrink-0 items-center justify-between px-6"><Brand /><button className="btn-icon lg:hidden" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}><X size={20} /></button></div>
      <Guarda />
      <div className="px-6 pb-3 pt-7 text-[10px] font-semibold tracking-[.2em] text-stone-500">ESPACIO DE TRABAJO</div>
      <nav aria-label="Navegación principal" className="grid gap-1 px-3">
        {links.map(({ to, title, caption, Icon }) => <NavLink key={to} to={to} aria-label={title} end={to === '/'} onClick={() => setMenuOpen(false)} className={({ isActive }) => `group flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${isActive ? 'border-orange-200 bg-brand-soft text-orange-900' : 'border-transparent text-stone-600 hover:bg-subtle hover:text-ink'}`}><Icon size={19} strokeWidth={1.75} className="shrink-0" /><div className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{title}</span><span className="mt-0.5 block truncate text-[11px] opacity-75">{caption}</span></div><ChevronRight size={14} className="opacity-0 transition-opacity group-hover:opacity-40 group-aria-[current=page]:opacity-50" /></NavLink>)}
      </nav>
      <div className="mx-4 mt-auto rounded-xl border border-line bg-canvas p-3.5"><p className="flex items-center gap-2 text-xs font-semibold"><span className={`size-2 rounded-full ${isOnline && !error ? 'bg-green-600 shadow-[0_0_0_3px_rgb(22_163_74/0.15)]' : 'bg-amber-600 shadow-[0_0_0_3px_rgb(217_119_6/0.15)]'}`} /> {connectionLabel}</p><p className="mt-1.5 text-[11px] leading-[1.45] text-stone-500">Los datos se actualizan cada minuto y se comparten con la aplicación.</p></div>
      <div className="mt-4 flex items-center gap-3 border-t border-line px-4 py-4"><div className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-subtle text-sm font-semibold text-stone-700">{(data?.profile?.display_name || 'K').slice(0, 1).toLocaleUpperCase('es')}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{data?.profile?.display_name || 'Mi cuenta'}</p><p className="mt-0.5 truncate text-[11px] text-stone-500">{admin ? 'Administradora' : assigned?.name || 'Esperando acceso'}</p></div><button className="btn-icon text-stone-500" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? <LoaderCircle size={17} className="animate-spin" /> : <LogOut size={17} />}</button></div>
    </aside>
    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur-sm sm:px-8">
        <div className="flex items-center gap-3"><button className="btn-icon lg:hidden" aria-label="Abrir menú" aria-controls="navegacion" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={22} /></button><div className="flex items-center gap-2 text-xs"><span className="hidden text-stone-500 sm:inline">Mi espacio</span><ChevronRight size={12} className="hidden text-stone-400 sm:block" /><span className="font-semibold text-ink">{current.title}</span></div></div>
        <div className="flex items-center gap-3"><span className="hidden text-xs text-stone-500 tabular-nums sm:block">{formatDate(today())}</span><span className="hidden h-5 border-l border-line sm:block" /><button className="btn-secondary !min-h-9 !px-3 !py-2 !text-xs" disabled={!isOnline || !isConfigured || isRefreshing} onClick={() => void workspace.refresh()}><RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />{isRefreshing ? 'Actualizando…' : 'Actualizar'}</button></div>
      </header>
      <main id="contenido" className="mx-auto w-full max-w-[1680px] px-4 pb-12 pt-6 sm:px-8 sm:pt-8">
        {signOutError && <div className="notice error mb-4" role="alert">{signOutError}</div>}
        {!isOnline ? <div className="notice warning mb-4 flex items-center gap-3" role="status"><WifiOff size={18} /><span>Estás viendo la última información de esta sesión{data?.updated_at ? ` (${formatDate(data.updated_at)})` : ''}. Conectate para guardar cambios.</span></div> : error ? <div className="notice error mb-4" role="alert">No pudimos actualizar la información. {error.message}</div> : null}
        {!data?.profile ? <section className="mx-auto mt-16 max-w-lg rounded-2xl border border-line bg-white p-8 text-center shadow-card">{workspace.isLoading ? <LoaderCircle className="mx-auto animate-spin text-orange-700" aria-label="Cargando tu espacio" /> : <Users className="mx-auto text-orange-700" />}<h1 className="font-display mt-5 text-3xl font-semibold">{workspace.isLoading ? 'Cargando tu espacio…' : error && !/habilitada|permiso|Ingresá/.test(error.message) ? 'No se pudo cargar tu espacio' : 'Esperando habilitación'}</h1><p className="mt-4 text-sm leading-6 text-stone-500">{error && !/habilitada|permiso|Ingresá/.test(error.message) ? 'Revisá el aviso de sincronización y volvé a actualizar.' : 'Una administradora debe asignar tu cuenta y punto de retiro. Si ya lo hizo, actualizá la información.'}</p><button className="btn-primary mt-6" disabled={!isOnline || isRefreshing} onClick={() => void workspace.refresh()}>Actualizar información <ArrowUpRight size={15} /></button></section> : <ErrorBoundary key={location.pathname}><Suspense fallback={<div role="status" className="flex items-center justify-center gap-3 py-24 text-sm text-stone-500"><LoaderCircle size={19} className="animate-spin" />Cargando vista…</div>}><Routes>
          <Route path="/" element={<SalesScreen />} />
          <Route path="/clientes" element={<ClientsScreen />} />
          <Route path="/stock" element={<StockScreen />} />
          <Route path="/resumen" element={admin ? <ReportsScreen /> : <Navigate to="/" replace />} />
          <Route path="/ajustes" element={admin ? <SettingsScreen /> : <Navigate to="/" replace />} />
          <Route path="/clients" element={<Navigate to="/clientes" replace />} />
          <Route path="/reports" element={<Navigate to="/resumen" replace />} />
          <Route path="/settings" element={<Navigate to="/ajustes" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes></Suspense></ErrorBoundary>}
      </main>
    </div>
  </div>;
}

export default function App() {
  return <ErrorBoundary><BrowserRouter><WorkspaceProvider><AuthGate><Shell /></AuthGate></WorkspaceProvider></BrowserRouter></ErrorBoundary>;
}
