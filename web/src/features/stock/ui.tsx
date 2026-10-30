import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X, AlertCircle, PackageOpen } from 'lucide-react';
import Decimal from '@shared/lib/decimal';

export { today, formatDate, money, isValidDate } from '@shared/lib/format';
export const d = (v: string | number) => new Decimal(typeof v === 'string' ? v.trim().replace(',', '.') : v);
export const qty = (v: string | number) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 6 }).format(d(v).toNumber());
export const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
export function numberValue(value: string, label: string, options: { positive?: boolean; integer?: boolean; nonzero?: boolean } = {}) {
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value.trim())) throw new Error(`${label}: ingresá un número válido.`);
  const n = d(value);
  if (!n.isFinite() || (n.isNegative() && !options.nonzero) || (options.positive && !n.gt(0)) || (options.nonzero && n.isZero())) throw new Error(`${label}: ${options.nonzero ? 'el cambio no puede ser cero' : options.positive ? 'debe ser mayor que cero' : 'no puede ser negativo'}.`);
  if (options.integer && (!n.isInteger() || n.abs().gt(Number.MAX_SAFE_INTEGER))) throw new Error(`${label}: usá unidades enteras válidas.`);
  return n.toString();
}
export function Button({ children, onClick, disabled, secondary, danger, type = 'button' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean; type?: 'button' | 'submit' }) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`ui-btn px-4 ${danger ? 'ui-btn-danger' : secondary ? 'ui-btn-secondary' : 'ui-btn-primary'}`}>{children}</button>;
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`ui-card ${className}`}>{children}</section>; }
export function Heading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) { return <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">{eyebrow}</p><h1 className="page-title">{title}</h1><p className="page-lede">{subtitle}</p></div>{action}</header>; }
export function Title({ children, caption, action }: { children: ReactNode; caption?: string; action?: ReactNode }) { return <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="ui-card-title">{children}</h2>{caption && <p className="mt-1 text-xs leading-relaxed text-stone-500">{caption}</p>}</div>{action}</div>; }
export function Note({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div role={error ? 'alert' : 'status'} className={`ui-note ${error ? 'ui-note-error' : 'ui-note-info'}`}><AlertCircle size={18} className="mt-0.5 shrink-0" /><div className="min-w-0 whitespace-pre-line">{children}</div></div>; }
export function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-stone-500"><PackageOpen size={28} strokeWidth={1.4} className="text-stone-400" /><h3 className="font-semibold text-stone-700">{title}</h3><p className="max-w-md">{children}</p></div>; }
export function Input({ label, value, onChange, numeric, multiline, type = 'text', required, maxLength }: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean; multiline?: boolean; type?: string; required?: boolean; maxLength?: number }) {
  const id = useId(); const cls = 'w-full min-w-0';
  return <div className="grid min-w-0 gap-1.5"><label htmlFor={id} className="text-xs font-semibold text-stone-600">{label}</label>{multiline ? <textarea id={id} rows={3} value={value} onChange={e => onChange(e.target.value)} className={cls} maxLength={maxLength} /> : <input id={id} type={type} inputMode={numeric ? 'decimal' : undefined} value={value} onChange={e => onChange(e.target.value)} className={cls} required={required} maxLength={maxLength} />}</div>;
}
export function Select<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) { const id = useId(); return <div className="grid min-w-0 gap-1.5"><label htmlFor={id} className="text-xs font-semibold text-stone-600">{label}</label><select id={id} value={value} onChange={e => onChange(e.target.value as T)} className="w-full min-w-0"><option value="">Seleccionar…</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>; }
export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) { return <label className="flex cursor-pointer items-center gap-2.5 text-sm text-stone-600"><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} className="size-4 accent-brand" />{label}</label>; }
export function Modal({ title, children, close, save, busy, disabled, error, submitLabel = 'Guardar' }: { title: string; children: ReactNode; close: () => void; save: () => void; busy: boolean; disabled?: boolean; error?: string; submitLabel?: string }) {
  const dialog = useRef<HTMLDialogElement>(null); const id = useId();
  useEffect(() => { const element = dialog.current; const previous = document.activeElement as HTMLElement | null; element?.showModal(); return () => { element?.close(); previous?.focus(); }; }, []);
  return <dialog ref={dialog} aria-labelledby={id} onCancel={e => { e.preventDefault(); if (!busy) close(); }} className="ui-dialog w-[calc(100%_-_1.5rem)] max-w-xl"><form onSubmit={e => { e.preventDefault(); if (!busy && !disabled) save(); }} className="flex max-h-[92dvh] flex-col"><div className="ui-dialog-head"><h2 id={id} className="ui-dialog-title">{title}</h2><button type="button" aria-label="Cerrar formulario" onClick={close} disabled={busy} className="ui-dialog-close"><X size={18} /></button></div><fieldset disabled={busy} className="min-h-0 min-w-0 space-y-4 overflow-y-auto p-5 sm:p-6">{children}{error && <Note error>{error}</Note>}</fieldset><div className="ui-dialog-foot"><Button secondary disabled={busy} onClick={close}>Cancelar</Button><Button type="submit" disabled={busy || disabled}>{busy ? 'Guardando…' : submitLabel}</Button></div></form></dialog>;
}
