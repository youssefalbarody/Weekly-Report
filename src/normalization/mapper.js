const clean = value => String(value ?? '').trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');
const aliases = {
  product: ['المنتج', 'product', 'item'], reason: ['السبب', 'reason', 'سبب'], merchant: ['التاجر', 'merchant', 'store', 'اسم التاجر'],
  timing: ['قبل ام بعد', 'قبل أو بعد', 'before after', 'timing'], supportType: ['استبدال ام اسرجاع', 'استبدال ام استرجاع', 'return exchange', 'type'],
  status: ['الحاله', 'الحالة', 'status', 'order status'], count: ['العدد', 'count', 'quantity', 'عدد'], date: ['التاريخ', 'تاريخ', 'date', 'order date', 'created at']
};
const has = (header, key) => aliases[key].some(a => clean(header) === clean(a));
const sectionFromHeaders = headers => {
  const h = headers.map(clean);
  if (h.some(x => has(x, 'status')) && h.some(x => has(x, 'count'))) return 'states';
  if (h.some(x => has(x, 'supportType'))) return 'support';
  if (h.some(x => has(x, 'timing'))) return 'shipping';
  if (h.some(x => has(x, 'reason')) && h.some(x => has(x, 'product'))) return 'confirmations';
  return null;
};
function headerBlocks(rows) {
  const blocks = [];
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    let start = null;
    for (let c = 0; c <= (rows[r]?.length || 0); c++) {
      const present = c < (rows[r]?.length || 0) && String(rows[r][c] ?? '').trim();
      if (present && start === null) start = c;
      if ((!present || c === rows[r].length) && start !== null) {
        const headers = rows[r].slice(start, c);
        const section = sectionFromHeaders(headers);
        if (section) blocks.push({ row: r, start, end: c, headers, section });
        start = null;
      }
    }
  }
  return blocks;
}
function toRecords(rows, block) {
  const keys = block.headers.map((header, index) => ({ header, index }));
  const values = [];
  for (let r = block.row + 1; r < rows.length; r++) {
    const cells = rows[r].slice(block.start, block.end);
    if (!cells.some(v => String(v ?? '').trim())) continue;
    const obj = {};
    keys.forEach(({ header, index }) => { obj[header] = cells[index] ?? ''; });
    values.push(obj);
  }
  return values;
}
function normalizeRecord(record, section) {
  const pick = key => Object.entries(record).find(([h]) => has(h, key))?.[1] ?? '';
  return { product: pick('product'), reason: pick('reason'), merchant: pick('merchant'), timing: pick('timing'), supportType: pick('supportType'), status: pick('status'), count: pick('count'), date: pick('date'), section, raw: record };
}
export function mapWorkbook(sheets, filename) {
  const collections = { confirmations: [], shipping: [], support: [], states: [] };
  const previousCollections = { confirmations: [], shipping: [], support: [], states: [] };
  const detected = [];
  const candidates = [];
  sheets.forEach(sheet => headerBlocks(sheet.rows).forEach(block => {
    const records = toRecords(sheet.rows, block).map(r => normalizeRecord(r, block.section));
    const period = /previous|prior|last week|السابق|الماضي/i.test(sheet.name) ? 'previous' : 'current';
    (period === 'previous' ? previousCollections : collections)[block.section].push(...records);
    detected.push({ sheet: sheet.name, section: block.section, period, headers: block.headers, rows: records.length });
    candidates.push({ ...block, sheet: sheet.name, period, records });
  }));
  const evidence = Object.values(collections).filter(x => x.length).length;
  const confidence = evidence === 4 ? 1 : evidence >= 2 ? .75 : evidence ? .5 : 0;
  return { filename, rawSheets: sheets, collections, previousCollections, detected, candidates, mapping: { confidence, needsReview: confidence < .8 } };
}
export function applyManualMapping(parsed, choices) {
  const collections = { confirmations: [], shipping: [], support: [], states: [] };
  const previousCollections = { confirmations: [], shipping: [], support: [], states: [] };
  parsed.candidates.forEach((candidate, index) => {
    const section = choices[index];
    if (!section || section === 'ignore') return;
    (candidate.period === 'previous' ? previousCollections : collections)[section].push(...candidate.records.map(record => ({ ...record, section })));
  });
  return { ...parsed, collections, previousCollections, detected: parsed.candidates.map((c, i) => ({ sheet: c.sheet, section: choices[i] || 'ignore', period: c.period, headers: c.headers, rows: c.records.length })) };
}
