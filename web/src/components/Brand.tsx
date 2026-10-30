import logo from '../../../assets/brand/kalak-logo.webp';
import guarda from '../../../assets/brand/guarda.webp';

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-3">
    <img src={logo} width="45" height="55" alt="Kalak, comida real para mascotas" className="h-12 w-10 object-contain" />
    {!compact && <div><span className="font-display text-2xl leading-none tracking-wide">KALAK</span><p className="mt-1 text-[9px] font-bold tracking-[.23em] text-stone-500">LOGÍSTICA</p></div>}
  </div>;
}
export function Guarda() {
  return <div aria-hidden="true" className="h-2.5 w-full shrink-0" style={{ backgroundImage: `url(${guarda})`, backgroundSize: '263px 10px', backgroundRepeat: 'repeat-x' }} />;
}
