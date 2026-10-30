import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';

export const errorText = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación. Volvé a intentar.';
export function Button({ children, secondary, danger, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean; danger?: boolean }) {
  return <button type="button" {...props} className={`ui-btn px-4 ${danger ? 'ui-btn-danger' : secondary ? 'ui-btn-secondary' : 'ui-btn-primary'} ${className}`}>{children}</button>;
}
export function Card({ children, className = '', title, caption }: { children: ReactNode; className?: string; title?: string; caption?: string }) {
  return <section className={`ui-card ${className}`}>{title ? <h2 className="ui-card-title">{title}</h2> : null}{caption ? <p className="mt-1 mb-5 text-sm leading-relaxed text-stone-500">{caption}</p> : title ? <div className="mb-5" /> : null}{children}</section>;
}
export function Note({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? 'alert' : 'status'} className={`ui-note ${error ? 'ui-note-error' : 'ui-note-info'}`}>{children}</div>;
}
export function Empty({ title, description }: { title: string; description?: string }) {
  return <div className="rounded-xl border border-dashed border-line bg-paper px-5 py-10 text-center"><p className="font-medium text-stone-700">{title}</p>{description ? <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{description}</p> : null}</div>;
}
export function Field({ label, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return <label htmlFor={id} className={`ui-label ${className}`}>{label}<input id={id} {...props} className="w-full min-w-0" /></label>;
}
export function Select({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) {
  const id = useId();
  return <label htmlFor={id} className="ui-label">{label}<select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="w-full min-w-0">{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
export function Textarea({ label, value, onChange, required = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean }) {
  const id = useId();
  return <label htmlFor={id} className="ui-label">{label}<textarea id={id} rows={3} required={required} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} className="w-full resize-y" /></label>;
}
export function Badge({ children, warm = false }: { children: ReactNode; warm?: boolean }) {
  return <span className={`ui-badge ${warm ? 'bg-orange-100/70 text-orange-900' : 'bg-subtle text-stone-600'}`}>{children}</span>;
}
export function Metric({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return <div className="min-w-0 rounded-2xl border border-line bg-white p-5 shadow-card"><p className="text-sm text-stone-500">{label}</p><p className="mt-2 break-words text-2xl font-semibold tracking-tight text-ink tabular-nums xl:text-[1.75rem]">{value}</p>{caption ? <p className="mt-2 text-xs leading-relaxed text-stone-500">{caption}</p> : null}</div>;
}
export function Table({ headers, rows, empty = 'Sin registros para esta selección.' }: { headers: string[]; rows: { key: string; cells: ReactNode[] }[]; empty?: string }) {
  if (!rows.length) return <Empty title={empty} />;
  return <div className="max-w-full overflow-x-auto rounded-xl border border-line-soft"><table className="w-full text-left text-sm"><thead className="bg-subtle text-[11px] uppercase tracking-wider text-stone-600"><tr>{headers.map(header => <th key={header} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{header}</th>)}</tr></thead><tbody className="divide-y divide-line-soft">{rows.map(row => <tr key={row.key} className="align-top transition-colors hover:bg-paper">{row.cells.map((cell, index) => <td key={index} className="px-4 py-4 text-stone-700">{cell}</td>)}</tr>)}</tbody></table></div>;
}
export function Modal({ title, children, close, save, submitLabel = 'Guardar cambios', busy = false, disabled = false, error }: { title: string; children: ReactNode; close: () => void; save: () => void; submitLabel?: string; busy?: boolean; disabled?: boolean; error?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => { node?.close(); }; }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) close(); }} className="ui-dialog w-[min(640px,calc(100%_-_1.5rem))] overflow-y-auto"><form onSubmit={event => { event.preventDefault(); if (!busy && !disabled) save(); }}><div className="ui-dialog-head sticky top-0 z-10 bg-paper"><h2 id={titleId} className="ui-dialog-title">{title}</h2><button type="button" aria-label="Cerrar formulario" disabled={busy} onClick={close} className="ui-dialog-close"><X size={18} /></button></div><div className="grid gap-5 p-5 sm:p-6">{error ? <Note error>{error}</Note> : null}{children}</div><div className="ui-dialog-foot sticky bottom-0"><Button secondary disabled={busy} onClick={close}>Cancelar</Button><Button type="submit" disabled={disabled || busy}>{busy ? 'Guardando…' : submitLabel}</Button></div></form></dialog>;
}
