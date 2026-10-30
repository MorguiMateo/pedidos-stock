/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildXlsx, excelNumber } from './xlsx';
import { reportWorksheets } from './reports';
import type { Snapshot } from './types';

describe('Excel OOXML portátil', () => {
  it('produce ZIP con CRC y relaciones válidas y celdas de usuario inertes, sin fórmulas', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kalak-xlsx-')); const path = join(directory, 'informe.xlsx');
    try {
      writeFileSync(path, buildXlsx([{ name: 'Clientes & ventas', rows: [['=HYPERLINK("https://bad")', '+cmd', '-cmd', '@SUM(A1)', 'José <familia>', '00123'], [0.3, excelNumber('1200.50'), null]] }]));
      const result = execFileSync('python3', ['-c', 'import zipfile,sys,json,xml.etree.ElementTree as E\nz=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None\nfor n in z.namelist(): E.fromstring(z.read(n))\ns=E.fromstring(z.read("xl/worksheets/sheet1.xml")); ns={"m":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}\nassert not s.findall(".//m:f",ns)\nassert s.find("m:sheetData/m:row/m:c",ns).attrib["t"]=="inlineStr"\nprint(json.dumps([t.text for t in s.findall(".//m:t",ns)],ensure_ascii=False))', path], { encoding: 'utf8' });
      expect(JSON.parse(result)).toEqual(['=HYPERLINK("https://bad")', '+cmd', '-cmd', '@SUM(A1)', 'José <familia>', '00123']);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('exporta todos los cortes, filtros y totales históricos aun con datos vacíos', () => {
    const data: Snapshot = { clients: [], orders: [], locations: [], items: [], recipes: [], purchases: [], productions: [], movements: [], stock: [], updated_at: '' };
    const sheets = reportWorksheets(data, '2026-11', { from: '2026-11-01', to: '2026-11-30', product: 'all', client: 'all', status: 'all', location: 'all' }, 30);
    expect(sheets.map(sheet => sheet.name)).toEqual(expect.arrayContaining(['Productos mes', 'Preparación', 'Puntos', 'Clientes', 'Entregados sin cobrar', 'Caja', 'Medios de cobro', 'Stock y mínimos', 'Movimientos stock', 'Pedidos filtrados']));
    expect(buildXlsx(sheets).slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]));
  });
  it('rechaza nombres ambiguos y números no válidos', () => {
    expect(() => buildXlsx([{ name: 'A', rows: [] }, { name: 'a', rows: [] }])).toThrow();
    expect(() => buildXlsx([{ name: 'A', rows: [[excelNumber('=1+2')]] }])).toThrow();
  });
});
