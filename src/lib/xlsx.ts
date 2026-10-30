/** Minimal portable OOXML workbook. No formulas/macros, shared strings, or platform-specific ZIP APIs. */
export type Cell = string | number | boolean | null | undefined | { number: string };
export type Worksheet = { name: string; rows: Cell[][] };
export const excelNumber = (number: string): Cell => ({ number });
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function column(index: number) { let result = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result; }
function sheetXml(rows: Cell[][]) {
  return declaration + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows.map((row, r) => `<row r="${r + 1}">` + row.map((value, c) => {
    const ref = `${column(c)}${r + 1}`;
    if (value === null || value === undefined) return `<c r="${ref}"/>`;
    if (typeof value === 'number' || typeof value === 'object') {
      const number = typeof value === 'number' ? String(value) : value.number;
      if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(number) || !Number.isFinite(Number(number))) throw new Error('Número de Excel inválido.');
      return `<c r="${ref}"><v>${number}</v></c>`;
    }
    if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
    // Explicit inline strings make even =,+,-,@ user input inert, without altering contact data.
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value.slice(0, 32767))}</t></is></c>`;
  }).join('') + '</row>').join('') + '</sheetData></worksheet>';
}
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files: { name: string; body: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const entries = files.map(file => ({ name: encoder.encode(file.name), data: encoder.encode(file.body) }));
  const size = entries.reduce((total, entry) => total + 30 + entry.name.length + entry.data.length + 46 + entry.name.length, 22);
  const bytes = new Uint8Array(size); const view = new DataView(bytes.buffer); let offset = 0;
  const directory: { offset: number; name: Uint8Array; size: number; crc: number }[] = [];
  for (const entry of entries) {
    const crc = crc32(entry.data); directory.push({ offset, name: entry.name, size: entry.data.length, crc });
    view.setUint32(offset, 0x04034b50, true); view.setUint16(offset + 4, 20, true); view.setUint16(offset + 6, 0x0800, true); view.setUint16(offset + 12, 33, true);
    view.setUint32(offset + 14, crc, true); view.setUint32(offset + 18, entry.data.length, true); view.setUint32(offset + 22, entry.data.length, true); view.setUint16(offset + 26, entry.name.length, true);
    bytes.set(entry.name, offset + 30); bytes.set(entry.data, offset + 30 + entry.name.length); offset += 30 + entry.name.length + entry.data.length;
  }
  const centralStart = offset;
  for (const entry of directory) {
    view.setUint32(offset, 0x02014b50, true); view.setUint16(offset + 4, 20, true); view.setUint16(offset + 6, 20, true); view.setUint16(offset + 8, 0x0800, true); view.setUint16(offset + 14, 33, true);
    view.setUint32(offset + 16, entry.crc, true); view.setUint32(offset + 20, entry.size, true); view.setUint32(offset + 24, entry.size, true); view.setUint16(offset + 28, entry.name.length, true); view.setUint32(offset + 42, entry.offset, true); bytes.set(entry.name, offset + 46); offset += 46 + entry.name.length;
  }
  const centralSize = offset - centralStart;
  view.setUint32(offset, 0x06054b50, true); view.setUint16(offset + 8, entries.length, true); view.setUint16(offset + 10, entries.length, true); view.setUint32(offset + 12, centralSize, true); view.setUint32(offset + 16, centralStart, true);
  return bytes;
}
export function buildXlsx(sheets: Worksheet[]): Uint8Array {
  if (!sheets.length || sheets.length > 100) throw new Error('El libro necesita entre 1 y 100 hojas.');
  const names = new Set<string>();
  for (const sheet of sheets) {
    const normalized = sheet.name.toLocaleLowerCase();
    if (!sheet.name || sheet.name.length > 31 || /[\\/?*\[\]:]/.test(sheet.name) || names.has(normalized)) throw new Error('Nombre de hoja de Excel inválido o repetido.');
    if (sheet.rows.length > 1_048_576 || sheet.rows.some(row => row.length > 16_384)) throw new Error('El informe supera el tamaño máximo de una hoja de Excel.');
    names.add(normalized);
  }
  return zip([
    { name: '[Content_Types].xml', body: declaration + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
    { name: '_rels/.rels', body: declaration + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', body: declaration + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', body: declaration + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '</Relationships>' },
    ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, body: sheetXml(sheet.rows) })),
  ]);
}
