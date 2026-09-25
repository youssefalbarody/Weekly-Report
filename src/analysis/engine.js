const clean = value => String(value ?? '').trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const sum = values => values.reduce((a, b) => a + b, 0);
const countReasons = rows => Object.entries(rows.reduce((acc, row) => { if (row.reason) acc[row.reason] = (acc[row.reason] || 0) + 1; return acc; }, {})).sort((a,b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
const metric = (value, source = 'calculated', suffix = '') => value === null || value === undefined ? { value: '::', source: 'missing' } : { value: `${suffix}${value}`, numeric: value, source };
const rate = (numerator, denominator) => denominator === null || denominator === undefined || !denominator ? metric(null) : metric((numerator / denominator * 100).toFixed(1), 'calculated', '');
const findState = (states, patterns) => states.find(x => patterns.some(p => clean(x.status).includes(p)));
export function analyze(data, skipPrevious = false) {
  const { confirmations, shipping, support, states } = data.collections;
  const stateValue = patterns => { const found = findState(states, patterns); return found ? Number(found.count) : null; };
  const total = stateValue(['عدد الاوردر', 'total order', 'total']);
  const delivered = stateValue(['تم التوصيل', 'delivered']);
  const inShipping = stateValue(['في الشحن', 'in shipping', 'shipped']);
  const nonConfirmed = confirmations.length || null;
  const confirmed = total !== null && nonConfirmed !== null ? Math.max(total - nonConfirmed, 0) : null;
  const after = shipping.filter(x => clean(x.timing).includes('بعد') || clean(x.timing).includes('after'));
  const before = shipping.filter(x => clean(x.timing).includes('قبل') || clean(x.timing).includes('before'));
  const returned = support.filter(x => clean(x.supportType).includes('استرجاع') || clean(x.supportType).includes('return')).length;
  const exchanged = support.filter(x => clean(x.supportType).includes('استبدال') || clean(x.supportType).includes('exchange')).length;
  const supportTotal = support.length || null;
  const merchant = Object.values(data.collections).flat().find(x => x.merchant)?.merchant || null;
  const report = {
    merchant: metric(merchant), total: metric(total), delivered: metric(delivered), inShipping: metric(inShipping),
    confirmations: { total: metric(total), confirmed: metric(confirmed), nonConfirmed: metric(nonConfirmed), rate: rate(confirmed, total), reasons: countReasons(confirmations) },
    shipping: { delivered: metric(delivered), inShipping: metric(inShipping), before: metric(before.length || (shipping.length ? 0 : null)), after: metric(after.length || (shipping.length ? 0 : null)), rejection: metric(after.length || (shipping.length ? 0 : null)), rejectionRate: rate(after.length, total), reasons: countReasons(after), allReasons: countReasons(shipping) },
    support: { total: metric(supportTotal), returned: metric(returned || (support.length ? 0 : null)), exchanged: metric(exchanged || (support.length ? 0 : null)), rate: rate(support.length, total), reasons: countReasons(support) },
    kpis: { total: metric(total), confirmation: rate(confirmed, total), delivery: rate(delivered, total), rejection: rate(after.length, total), support: rate(support.length, total) },
    validation: data.validation, source: data.source, insights: []
  };
  const hasPrevious = Object.values(data.previousCollections || {}).some(rows => rows.length);
  const previous = !skipPrevious && hasPrevious ? analyze({ ...data, collections: data.previousCollections, previousCollections: {} }, true) : null;
  report.comparisons = {
    confirmation: comparison(report.kpis.confirmation, previous?.kpis.confirmation), delivery: comparison(report.kpis.delivery, previous?.kpis.delivery),
    rejection: comparison(report.kpis.rejection, previous?.kpis.rejection), support: comparison(report.kpis.support, previous?.kpis.support)
  };
  report.insights = insights(report, previous);
  return report;
}
function comparison(current, previous) {
  if (current?.numeric === undefined || previous?.numeric === undefined) return metric(null);
  const delta = Number(current.numeric) - Number(previous.numeric);
  return metric(`${delta > 0 ? '+' : ''}${delta.toFixed(1)}`);
}
function insights(report, previous) {
  const list = [];
  const addDominant = (items, label) => { if (!items.length) return; const total = sum(items.map(x => x.value)); const top = items[0]; if (total) list.push(`${top.label} هو السبب الأكثر تسجيلاً في ${label} بنسبة ${(top.value / total * 100).toFixed(0)}% من الحالات.`); };
  addDominant(report.confirmations.reasons, 'عدم التأكيد');
  addDominant(report.shipping.allReasons, 'ملاحظات الشحن');
  addDominant(report.support.reasons, 'الدعم');
  if (report.shipping.before.numeric > 0) list.push(`تم تسجيل ${report.shipping.before.numeric} حالة مرتبطة بالشحن قبل الوصول، مقابل ${report.shipping.after.numeric} بعد الوصول.`);
  if (previous && report.comparisons.confirmation.numeric !== undefined) list.push(`تغيرت نسبة التأكيدات بمقدار ${report.comparisons.confirmation.value} نقطة مئوية مقارنة بالأسبوع السابق.`);
  return list.slice(0, 4);
}
