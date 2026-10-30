import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';

export const errorText = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación. Volvé a intentar.';
export function Button({ children, secondary, danger, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean; danger?: boolean }) {
  return <button type="button" {...props} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-40 ${danger ? 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100' : secondary ? 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50' : 'border-orange-500 bg-orange-500 text-stone-950 hover:bg-orange-400'} ${className}`}>{children}</button>;
}
export function Card({ children, className = '', title, caption }: { children: ReactNode; className?: string; title?: string; caption?: string }) {
  return <section className={`min-w-0 rounded-2xl border border-stone-200/90 bg-white p-5 shadow-sm sm:p-6 ${className}`}>{title ? <h2 className="text-lg font-semibold tracking-tight text-stone-900">{title}</h2> : null}{caption ? <p className="mt-1 mb-5 text-sm leading-relaxed text-stone-500">{caption}</p> : title ? <div className="mb-5" /> : null}{children}</section>;
}
export function Note({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-orange-200 bg-orange-50 text-stone-700'}`}>{children}</div>;
}
export function Empty({ title, description }: { title: string; description?: string }) {
  return <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50/70 px-5 py-10 text-center"><p className="font-medium text-stone-700">{title}</p>{description ? <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{description}</p> : null}</div>;
}
export function Field({ label, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return <label htmlFor={id} className={`grid min-w-0 gap-2 text-sm font-medium text-stone-700 ${className}`}>{label}<input id={id} {...props} className="min-h-11 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3 py-2 font-normal text-stone-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-stone-100" /></label>;
}
export function Select({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) {
  const id = useId();
  return <label htmlFor={id} className="grid min-w-0 gap-2 text-sm font-medium text-stone-700">{label}<select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3 py-2 font-normal text-stone-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-stone-100">{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
export function Textarea({ label, value, onChange, required = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean }) {
  const id = useId();
  return <label htmlFor={id} className="grid gap-2 text-sm font-medium text-stone-700">{label}<textarea id={id} rows={3} required={required} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} className="w-full resize-y rounded-xl border border-stone-200 bg-white px-3 py-2 font-normal text-stone-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></label>;
}
export function Badge({ children, warm = false }: { children: ReactNode; warm?: boolean }) {
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${warm ? 'bg-orange-100 text-orange-900' : 'bg-stone-100 text-stone-600'}`}>{children}</span>;
}
export function Metric({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return <div className="min-w-0 rounded-2xl border border-stone-200 bg-white p-5"><p className="text-sm text-stone-500">{label}</p><p className="mt-3 break-words text-2xl font-semibold tracking-tight text-stone-900 xl:text-3xl">{value}</p>{caption ? <p className="mt-2 text-xs leading-relaxed text-stone-500">{caption}</p> : null}</div>;
}
export function Table({ headers, rows, empty = 'Sin registros para esta selección.' }: { headers: string[]; rows: { key: string; cells: ReactNode[] }[]; empty?: string }) {
  if (!rows.length) return <Empty title={empty} />;
  return <div className="max-w-full overflow-x-auto rounded-xl border border-stone-100"><table className="w-full text-left text-sm"><thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr>{headers.map(header => <th key={header} scope="col" className="whitespace-nowrap px-4 py-3 font-medium">{header}</th>)}</tr></thead><tbody className="divide-y divide-stone-100">{rows.map(row => <tr key={row.key} className="align-top hover:bg-orange-50/30">{row.cells.map((cell, index) => <td key={index} className="px-4 py-4 text-stone-700">{cell}</td>)}</tr>)}</tbody></table></div>;
}
export function Modal({ title, children, close, save, submitLabel = 'Guardar cambios', busy = false, disabled = false, error }: { title: string; children: ReactNode; close: () => void; save: () => void; submitLabel?: string; busy?: boolean; disabled?: boolean; error?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => { node?.close(); }; }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) close(); }} className="m-auto max-h-[90dvh] w-[min(640px,calc(100%_-_2rem))] rounded-2xl border-0 bg-[#fffdf9] p-0 text-stone-900 shadow-2xl backdrop:bg-stone-950/45"><form onSubmit={event => { event.preventDefault(); if (!busy && !disabled) save(); }}><div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-stone-200 bg-[#fffdf9] px-6 py-5"><h2 id={titleId} className="text-xl font-semibold">{title}</h2><button type="button" aria-label="Cerrar formulario" disabled={busy} onClick={close} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 disabled:opacity-40"><X size={20} /></button></div><div className="grid gap-5 px-6 py-5">{error ? <Note error>{error}</Note> : null}{children}</div><div className="sticky bottom-0 flex justify-end gap-3 border-t border-stone-200 bg-[#fffdf9] px-6 py-4"><Button secondary disabled={busy} onClick={close}>Cancelar</Button><Button type="submit" disabled={disabled || busy}>{busy ? 'Guardando…' : submitLabel}</Button></div></form></dialog>;
}
