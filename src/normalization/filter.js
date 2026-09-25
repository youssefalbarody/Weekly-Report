const string = value => String(value ?? '').trim();
const toDate = value => {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
};
const rowsFor = (rows, merchant, from, to) => rows.filter(row => {
  if (merchant && string(row.merchant) && string(row.merchant) !== merchant) return false;
  const date = toDate(row.date);
  if (!date) return true;
  if (from && date < new Date(`${from}T00:00:00`)) return false;
  if (to && date > new Date(`${to}T23:59:59`)) return false;
  return true;
});
export function filterData(data, { merchant = '', from = '', to = '' } = {}) {
  const filterCollections = collections => Object.fromEntries(Object.entries(collections).map(([key, rows]) => [key, rowsFor(rows, merchant, from, to)]));
  return { ...data, collections: filterCollections(data.collections), previousCollections: filterCollections(data.previousCollections || {}) };
}
export function merchantsIn(data) { return [...new Set(Object.values(data.collections).flat().map(row => string(row.merchant)).filter(Boolean))]; }
export function datesIn(data) { return Object.values(data.collections).flat().map(row => toDate(row.date)).filter(Boolean).sort((a,b) => a-b); }
