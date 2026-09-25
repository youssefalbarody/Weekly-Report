import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { mapWorkbook } from '../normalization/mapper.js';
import { validate } from '../validation/validate.js';

export async function parseFile(file) {
  const isCsv = /\.csv$/i.test(file.name);
  let sheets;
  if (isCsv) {
    const text = await file.text();
    sheets = [{ name: file.name, rows: Papa.parse(text, { skipEmptyLines: false }).data }];
  } else {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    sheets = workbook.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' }) }));
  }
  const mapped = mapWorkbook(sheets, file.name);
  return { ...mapped, validation: validate(mapped), source: { type: isCsv ? 'csv' : 'excel', name: file.name } };
}

export async function parseGoogleSheet(url) {
  const published = url.includes('/pub') ? url : url.replace(/\/edit.*$/, '/export?format=csv');
  const response = await fetch(published);
  if (!response.ok) throw new Error('تحقق من رابط النشر أو صلاحية الوصول');
  const rows = Papa.parse(await response.text(), { skipEmptyLines: false }).data;
  const mapped = mapWorkbook([{ name: 'Google Sheets', rows }], 'Google Sheets');
  return { ...mapped, validation: validate(mapped), source: { type: 'google_sheets', name: url } };
}
