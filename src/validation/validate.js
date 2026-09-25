const filled = value => String(value ?? '').trim() !== '';
export function validate(data) {
  const warnings = [], errors = [];
  const c = data.collections;
  ['confirmations', 'shipping', 'support', 'states'].forEach(section => { if (!c[section].length) warnings.push(`قسم ${section} غير موجود؛ المقاييس المرتبطة به ستعرض ::`); });
  c.states.forEach(row => { if (filled(row.count) && Number.isNaN(Number(row.count))) errors.push(`قيمة عدد غير صالحة في حالة: ${row.status || 'غير معروفة'}`); });
  ['confirmations', 'shipping', 'support'].forEach(section => {
    const noReason = c[section].filter(row => !filled(row.reason)).length;
    if (noReason) warnings.push(`${noReason} سجل بلا سبب في ${section}`);
  });
  const merchants = new Set(Object.values(c).flat().map(x => x.merchant).filter(filled));
  if (!merchants.size) warnings.push('اسم التاجر غير متوفر ويمكن إدخاله يدوياً.');
  if (merchants.size > 1) warnings.push('تم العثور على أكثر من تاجر؛ راجع البيانات قبل مشاركة التقرير.');
  if (!Object.values(data.previousCollections || {}).some(rows => rows.length)) warnings.push('لا توجد أدلة عن الأسبوع السابق؛ حقول المقارنة تبقى :: وقابلة للإدخال اليدوي.');
  return { warnings, errors, status: errors.length ? 'error' : warnings.length ? 'review' : 'ready' };
}
