import Decimal from './decimal';

export const money = (value: Decimal.Value = 0) => { const amount = new Decimal(value || 0); const [whole = '0', cents = '00'] = amount.abs().toFixed(2).split('.'); return `${amount.isNegative() ? '−' : ''}$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents}`; };
export const quantity = (value: Decimal.Value = 0) => new Decimal(value || 0).toDecimalPlaces(6).toString();
export function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Mendoza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export const monthOf = (date: string) => date.slice(0, 7);
export function formatDate(date: string) { const localDate = date.includes('T') ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Mendoza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date)) : date; return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${localDate}T12:00:00Z`)); }
export const decimalInput = (text: string) => text.trim().replace(',', '.');
export function sumMoney(lines: readonly { quantity: Decimal.Value; unit_price: Decimal.Value }[]) { return lines.reduce((sum, line) => sum.plus(new Decimal(line.quantity || 0).times(line.unit_price || 0)), new Decimal(0)).toFixed(2); }
export function isValidDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value; }
export function monthLabel(value: string) { return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T12:00:00Z`)); }
