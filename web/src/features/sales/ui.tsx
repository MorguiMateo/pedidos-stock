import React, { useEffect, useId, useRef } from 'react';
import { X, AlertCircle, LoaderCircle } from 'lucide-react';

export const errorText = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación. Intentá nuevamente.';
export function Panel({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) { return <section className={`ui-card ${className}`}>{children}</section>; }
export function Button({ children, primary, danger, selected, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean; selected?: boolean }) { return <button type="button" aria-pressed={selected} {...props} className={`ui-btn ${primary ? 'ui-btn-primary' : danger ? 'ui-btn-danger' : selected ? 'ui-btn-selected' : 'ui-btn-secondary'} ${className}`} >{children}</button>; }
export function Badge({ children, tone = 'neutral' }: React.PropsWithChildren<{ tone?: 'orange' | 'green' | 'red' | 'neutral' }>) { return <span className={`ui-badge ${tone === 'green' ? 'bg-emerald-50 text-emerald-800' : tone === 'orange' ? 'bg-orange-100/70 text-orange-900' : tone === 'red' ? 'bg-red-50 text-red-700' : 'bg-subtle text-stone-600'}`}>{children}</span>; }
export function Notice({ children, error = false }: React.PropsWithChildren<{ error?: boolean }>) { return <div role={error ? 'alert' : 'status'} className={`ui-note ${error ? 'ui-note-error' : 'ui-note-info'}`}><AlertCircle size={17} className="mt-0.5 shrink-0"/><div>{children}</div></div>; }
const inputClass = 'w-full min-w-0';
export function Field({ label, multiline, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; multiline?: boolean }) { const id = useId(); return <label htmlFor={id} className="ui-label">{label}{multiline ? <textarea id={id} className={inputClass} rows={3} disabled={props.disabled} maxLength={props.maxLength} value={props.value as string} onChange={event => props.onChange?.(event as unknown as React.ChangeEvent<HTMLInputElement>)} placeholder={props.placeholder}/> : <input id={id} {...props} className={inputClass}/>}</label>; }
export function Select({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) { const id = useId(); return <label htmlFor={id} className="ui-label">{label}<select id={id} {...props} className={inputClass}>{children}</select></label>; }
export function Modal({ title, children, onDismiss, onSave, saving, disabled, error, submitLabel = 'Guardar', dismissLabel = 'Volver' }: React.PropsWithChildren<{ title: string; onDismiss: () => void; onSave: () => void; saving: boolean; disabled?: boolean; error?: string; submitLabel?: string; dismissLabel?: string }>) {
  const ref = useRef<HTMLDialogElement>(null); const errorRef = useRef<HTMLDivElement>(null); const titleId = useId();
  useEffect(() => { const dialog = ref.current; const previous = document.activeElement as HTMLElement | null; dialog?.showModal(); return () => { dialog?.close(); previous?.focus(); }; }, []);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [error]);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!saving) onDismiss(); }} className="ui-dialog w-[calc(100%_-_1.5rem)] max-w-2xl">
    <form onSubmit={event => { event.preventDefault(); if (!saving && !disabled) onSave(); }} className="flex max-h-[92dvh] flex-col">
      <header className="ui-dialog-head"><h2 id={titleId} className="ui-dialog-title">{title}</h2><button type="button" className="ui-dialog-close" aria-label="Cerrar formulario" disabled={saving} onClick={onDismiss}><X size={18}/></button></header>
      <div className="grid gap-5 overflow-y-auto p-5 sm:p-6">{children}{error && <div ref={errorRef}><Notice error>{error}</Notice></div>}{disabled && <Notice>Necesitás conexión y datos sincronizados para guardar.</Notice>}</div>
      <footer className="ui-dialog-foot"><Button disabled={saving} onClick={onDismiss}>{dismissLabel}</Button><Button type="submit" primary disabled={saving || disabled}>{saving && <LoaderCircle size={16} className="animate-spin"/>}{submitLabel}</Button></footer>
    </form>
  </dialog>;
}
