import { parseFile, parseGoogleSheet } from './ingestion/readers.js';
import { applyManualMapping } from './normalization/mapper.js';
import { validate } from './validation/validate.js';
import { filterData, merchantsIn, datesIn } from './normalization/filter.js';
import { analyze } from './analysis/engine.js';
import { exportPdf, exportPng } from './export/exporter.js';

const canvas = document.querySelector('#report-canvas');
const state = {
  current: null, previous: null, merchant: '', from: '', to: '', pending: null,
  overrides: JSON.parse(localStorage.getItem('weekly-stitch-overrides') || '{}')
};
const colors = ['#06b6d4','#a855f7','#f97316','#ef4444','#14b8a6'];
const $ = (selector, root = canvas) => root.querySelector(selector);
const $$ = (selector, root = canvas) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const latinDigits = value => String(value ?? '').replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)).replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit));
const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(latinDigits(value)));
const clean = value => String(value ?? '').trim();
const metricText = (metric, percent = false) => {
  if (!metric || metric.value === '::') return '::';
  if (metric.numeric !== undefined && metric.numeric !== null && Number.isFinite(Number(metric.numeric))) return `${number(Number(metric.numeric))}${percent ? '%' : ''}`;
  return `${latinDigits(metric.value)}${percent && !String(metric.value).includes('%') ? '%' : ''}`;
};
function saveOverrides() { localStorage.setItem('weekly-stitch-overrides', JSON.stringify(state.overrides)); }
function setMetric(element, metric, key, percent = false) {
  if (!element) return;
  const editable = metric?.source === 'missing';
  const override = editable && state.current ? state.overrides[key] : null;
  element.textContent = override?.value ?? metricText(metric, percent);
  element.dataset.overrideKey = key;
  element.contentEditable = editable ? 'true' : 'false';
  element.classList.toggle('manual-field', editable);
}
function entry(label, count, total, color) {
  return `<div class="flex items-center justify-between pb-1 border-b border-dashed border-slate-100"><span class="flex items-center gap-2 text-slate-700 font-medium"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${color}"></span>${esc(label)}</span><div class="flex items-center gap-3"><span class="font-bold text-slate-800">${number(count)}</span><span class="text-slate-500 text-[11px] w-7 text-left">${total ? (count / total * 100).toFixed(0) : 0}%</span></div></div>`;
}
function updateDonut(selector, rows, totalMetric, label) {
  const donut = $(selector);
  if (!donut) return;
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  donut.style.background = total ? `conic-gradient(${rows.slice(0,5).map((row, index) => {
    const before = rows.slice(0,index).reduce((sum,x) => sum + x.value,0) / total * 100;
    return `${colors[index]} ${before}% ${before + row.value / total * 100}%`;
  }).join(',')})` : '#e2e8f0';
  const centered = donut.parentElement.querySelector('.absolute span');
  if (centered) centered.textContent = metricText(totalMetric);
  const legend = donut.parentElement.parentElement.lastElementChild;
  if (legend && legend !== donut.parentElement) legend.innerHTML = rows.length ? rows.slice(0,5).map((row,index) => entry(row.label,row.value,total,colors[index])).join('') : '<div class="text-slate-400 text-xs py-4 text-center">لا توجد أسباب مسجلة</div>';
  if (label) donut.parentElement.querySelector('.absolute span + span')?.replaceChildren(document.createTextNode(label));
}
function setNotes(stage, lines) {
  const list = stage.querySelector('ul');
  if (!list) return;
  list.innerHTML = lines.length ? lines.map(line => `<li>${esc(line)}</li>`).join('') : '<li>لا توجد ملاحظة مدعومة كفاية بالبيانات.</li>';
}
function setReasonBars(stage, rows) {
  const box = stage.children[4];
  if (!box) return;
  const content = box.querySelector('.space-y-1\\.5');
  if (!content) return;
  const total = rows.reduce((sum,row) => sum + row.value,0);
  const max = rows[0]?.value || 1;
  content.innerHTML = rows.length ? rows.slice(0,5).map((row,index) => {
    const ratio = row.value / total * 100;
    return `<div><div class="flex justify-between text-slate-600 mb-0.5 font-medium"><span>${esc(row.label)}</span><span class="font-bold text-slate-800">${number(row.value)} <span class="text-slate-400 font-normal">(${ratio.toFixed(0)}%)</span></span></div><div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden"><div class="${index ? 'bg-rose-300' : 'bg-rose-400'} h-1.5 rounded-full" style="width:${row.value/max*100}%"></div></div></div>`;
  }).join('') : '<div class="text-slate-400 text-xs text-center py-4">لا توجد أسباب رفض بعد الوصول</div>';
}
function setMiniTable(table, rows, total) {
  table.innerHTML = rows.map(([label, metric, key, color]) => `<tr><td class="py-1 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full" style="background:${color}"></span>${label}</td><td class="text-center font-bold text-slate-700" data-metric="${key}"></td><td class="text-left text-slate-500" data-rate="${key}">${metric?.numeric !== undefined && total ? `${(metric.numeric/total*100).toFixed(1)}%` : '::'}</td></tr>`).join('');
  rows.forEach(([,metric,key]) => setMetric(table.querySelector(`[data-metric="${key}"]`), metric, key));
}
function renderReport(report) {
  const header = $('header');
  const merchant = header.querySelector('.text-base.font-bold');
  setMetric(merchant, state.merchant ? report.merchant : { value: 'كل التجار', source: 'calculated' }, 'merchant');
  const dates = $$('header > div:last-child span.font-bold');
  dates[0].textContent = state.from || '::'; dates[1].textContent = state.to || '::';

  const kpiCards = $$('[data-purpose="top-kpi-metrics-row"] > div');
  const kpis = [[report.kpis.total,'kpi-total',false,report.confirmations.total],[report.kpis.confirmation,'kpi-confirmation',true,report.confirmations.confirmed],[report.kpis.delivery,'kpi-delivery',true,report.delivered],[report.kpis.rejection,'kpi-rejection',true,report.shipping.rejection],[report.kpis.support,'kpi-support',true,report.support.total]];
  kpiCards.forEach((card,index) => { const [m,key,pct,count] = kpis[index]; setMetric(card.querySelector('.text-2xl'),m,key,pct); const tail = card.querySelector('.border-t span:last-child'); if (tail) setMetric(tail,count || {value:'::',source:'missing'},`${key}-count`); });

  const confirmation = $('[data-purpose="stage-1-confirmations"]');
  const confirmationCards = confirmation.children[1].children;
  [[report.confirmations.total,'confirm-total',false],[report.confirmations.confirmed,'confirm-confirmed',false],[report.confirmations.nonConfirmed,'confirm-unconfirmed',false]].forEach(([m,key],index) => {
    const el = confirmationCards[index].querySelector('.text-lg'); setMetric(el,m,key);
    const rate = confirmationCards[index].querySelector('.text-\\[10px\\]');
    if (rate) rate.textContent = index === 0 ? 'أوردر' : `${metricText(index === 1 ? report.confirmations.rate : (report.confirmations.rate.numeric === undefined ? {value:'::'} : {numeric:100-report.confirmations.rate.numeric}), true)} أوردر`;
  });
  updateDonut('.donut-reasons', report.confirmations.reasons, report.confirmations.nonConfirmed, 'أوردر');
  setNotes(confirmation, report.insights.filter(line => line.includes('عدم التأكيد') || line.includes('التأكيدات')));

  const shipping = $('[data-purpose="stage-2-shipping"]');
  const shippingCards = shipping.children[1].children;
  [[{value:'::',source:'missing'},'shipping-dispatched'],[report.shipping.inShipping,'shipping-in-progress'],[{value:'::',source:'missing'},'shipping-delayed'],[report.shipping.rejection,'shipping-rejection']].forEach(([m,key],index) => {
    setMetric(shippingCards[index].querySelector('.text-base'),m,key); const rate = shippingCards[index].querySelector('.inline-block'); rate.textContent = metricText(index === 1 ? (report.inShipping.numeric !== undefined ? {numeric:report.inShipping.numeric/(report.total.numeric||1)*100} : {value:'::'}) : index === 3 ? report.shipping.rejectionRate : {value:'::'},true);
  });
  const shippingMain = shipping.children[2].querySelector('tbody');
  shippingMain.innerHTML = [['تم التسليم',report.delivered,'ship-delivered','#10b981'],['قيد الشحن',report.inShipping,'ship-in-shipping','#0ea5e9'],['متأخر',{value:'::',source:'missing'},'ship-delayed','#f59e0b'],['مرفوض بعد الوصول',report.shipping.rejection,'ship-rejected','#ef4444']].map(([label,m,key,color]) => `<tr><td class="py-1.5 px-1 flex items-center gap-1.5 text-slate-700"><span class="w-2 h-2 rounded-full" style="background:${color}"></span>${label}</td><td class="py-1.5 px-1 text-center font-bold text-slate-800" data-metric="${key}"></td><td class="py-1.5 px-1 text-left text-slate-600 font-bold">${m.numeric !== undefined && report.total.numeric ? `${(m.numeric/report.total.numeric*100).toFixed(1)}%` : '::'}</td></tr>`).join('');
  [['تم التسليم',report.delivered,'ship-delivered'],['قيد الشحن',report.inShipping,'ship-in-shipping'],['متأخر',{value:'::',source:'missing'},'ship-delayed'],['مرفوض بعد الوصول',report.shipping.rejection,'ship-rejected']].forEach(([,m,key]) => setMetric(shippingMain.querySelector(`[data-metric="${key}"]`),m,key));
  const splitTables = $$('table',shipping.children[3]);
  setMiniTable(splitTables[0].querySelector('tbody'), [['أحداث قبل الوصول',report.shipping.before,'before-events','#0ea5e9'],['قيد الشحن',report.inShipping,'before-in-shipping','#0ea5e9'],['حالة متأخرة',{value:'::',source:'missing'},'before-delayed','#f59e0b'],['مرفوض قبل الوصول',{value:'::',source:'missing'},'before-rejected','#ef4444']], report.total.numeric);
  setMiniTable(splitTables[1].querySelector('tbody'), [['تم التسليم',report.delivered,'after-delivered','#10b981'],['أحداث بعد الوصول',report.shipping.after,'after-events','#0ea5e9'],['مرفوض بعد الوصول',report.shipping.rejection,'after-rejected','#f59e0b'],['قيد الإرجاع للشحن',{value:'::',source:'missing'},'after-returning','#ef4444']], report.total.numeric);
  setReasonBars(shipping,report.shipping.reasons);

  const support = $('[data-purpose="stage-3-customer-support"]');
  const supportCards = support.children[1].querySelectorAll('.grid > div');
  [[report.support.total,'support-total',report.support.rate],[report.support.exchanged,'support-exchanged',null],[report.support.returned,'support-returned',null]].forEach(([m,key,rate],index) => { setMetric(supportCards[index].querySelector('.text-base'),m,key); const small=supportCards[index].querySelector('.text-\\[9px\\]'); if(small) small.textContent=rate ? `${metricText(rate,true)} حالة` : 'حالة'; });
  const supportBody = support.children[2].querySelector('tbody');
  const grouped = new Map();
  (state.filtered?.collections.support || []).forEach(row => { if(!row.reason) return; const key=row.reason; const current=grouped.get(key)||{exchange:0,returned:0}; if(String(row.supportType).includes('استبدال'))current.exchange++; else if(String(row.supportType).includes('استرجاع'))current.returned++; grouped.set(key,current); });
  const supportRows = [...grouped.entries()].map(([label,v])=>({label,...v,total:v.exchange+v.returned})).sort((a,b)=>b.total-a.total);
  supportBody.innerHTML = supportRows.length ? supportRows.slice(0,5).map(row=>`<tr><td class="py-1.5 px-1 font-semibold text-slate-800">${esc(row.label)}</td><td class="py-1.5 px-1 text-center">${number(row.exchange)}</td><td class="py-1.5 px-1 text-center">${number(row.returned)}</td><td class="py-1.5 px-1 text-center font-bold text-slate-900">${number(row.total)}</td><td class="py-1.5 px-1 text-left font-bold text-slate-600">${report.support.total.numeric ? (row.total/report.support.total.numeric*100).toFixed(0) : 0}%</td></tr>`).join('') : '<tr><td class="py-4 text-center text-slate-400" colspan="5">لا توجد أسباب مسجلة</td></tr>';
  updateDonut('.donut-support',[{label:'استبدال',value:report.support.exchanged.numeric||0},{label:'استرجاع',value:report.support.returned.numeric||0}],report.support.total,'حالة');
  setNotes(support, report.insights.filter(line=>line.includes('الدعم')));

  const comparisons = [report.comparisons.confirmation,report.comparisons.delivery,report.comparisons.rejection,report.comparisons.support];
  const comparisonGroup = $('[data-purpose="weekly-comparison-summary"]').firstElementChild.lastElementChild;
  [...comparisonGroup.children].forEach((card,index) => setMetric(card.querySelector('.text-xs'),comparisons[index],`comparison-${index}`,true));
}
function reportForState() {
  if (!state.current) return null;
  const filteredCurrent = filterData(state.current,{merchant:state.merchant,from:state.from,to:state.to});
  const filteredPrevious = state.previous ? filterData(state.previous,{merchant:state.merchant,from:'',to:''}) : null;
  state.filtered = filteredCurrent;
  return analyze({...filteredCurrent,previousCollections:filteredPrevious?.collections || {confirmations:[],shipping:[],support:[],states:[]}});
}
function renderValidation(data) {
  const slot = document.querySelector('#validation-status'); if (!slot) return;
  const messages = data ? [...data.validation.errors,...data.validation.warnings] : [];
  slot.innerHTML = messages.length ? messages.map(x=>`<span>• ${esc(x)}</span>`).join('') : '<span class="text-emerald-700">البيانات مكتملة وجاهزة.</span>';
}
function emptyReport() {
  const collections = { confirmations: [], shipping: [], support: [], states: [] };
  return analyze({ collections, previousCollections: collections, validation: { errors: [], warnings: [], status: 'ready' }, source: { name: '' } });
}
function refresh() { const report=reportForState(); renderReport(report || emptyReport()); renderValidation(state.current); updateControlState(); }
function updateControlState() {
  const fileName = document.querySelector('#current-file-name'); const previous = document.querySelector('#previous-file-name');
  fileName.textContent=state.current?.source.name || 'لم يتم رفع ملف الأسبوع الحالي'; previous.textContent=state.previous?.source.name || 'لا يوجد ملف أسبوع سابق';
  const merchantWrap=document.querySelector('#merchant-control'); const select=document.querySelector('#merchant-select');
  const merchants=state.current ? merchantsIn(state.current) : []; merchantWrap.hidden=merchants.length<2;
  if(merchants.length>1){select.innerHTML=`<option value="" ${!state.merchant?'selected':''}>كل التجار</option>${merchants.map(m=>`<option ${m===state.merchant?'selected':''}>${esc(m)}</option>`).join('')}`;}
  const dataDates=state.current ? datesIn(state.current) : []; const notice=document.querySelector('#date-source-notice'); notice.textContent=state.current && !dataDates.length ? 'لا يحتوي الملف على تواريخ؛ يتم تحديث عنوان الفترة فقط.' : '';
}
function completeLoad(kind, parsed) {
  if(kind==='current') {
    state.current=parsed;
    const names=merchantsIn(parsed); state.merchant=names.length===1?names[0]:'';
    const dates=datesIn(parsed);
    if(dates.length) {
      state.from=dates[0].toISOString().slice(0,10); state.to=dates.at(-1).toISOString().slice(0,10);
      document.querySelector('#period-from').value=state.from; document.querySelector('#period-to').value=state.to;
    }
  } else state.previous=parsed;
  state.pending=null; document.querySelector('#mapping-panel')?.remove(); refresh();
}
function showMapping(kind, parsed) {
  state.pending={kind,parsed}; document.querySelector('#mapping-panel')?.remove();
  const panel=document.createElement('div'); panel.id='mapping-panel'; panel.className='mapping-panel';
  panel.innerHTML=`<b>مراجعة تعيين أقسام الملف</b><span>اختر وظيفة كل كتلة قبل إنشاء التقرير.</span>${parsed.candidates.map((candidate,index)=>`<label>${esc(candidate.sheet)} · ${candidate.headers.map(esc).join(' / ')}<select data-map-index="${index}"><option value="${candidate.section}">${candidate.section}</option><option value="confirmations">confirmations</option><option value="shipping">shipping</option><option value="support">support</option><option value="states">states</option><option value="ignore">تجاهل</option></select></label>`).join('')}<button type="button" id="apply-mapping">تطبيق التعيين</button>`;
  document.querySelector('#app-controls').append(panel);
  $('#apply-mapping',panel).addEventListener('click',()=>{
    const choices=[...panel.querySelectorAll('select')].map(x=>x.value);
    const mapped=applyManualMapping(parsed,choices);
    completeLoad(kind,{...mapped,validation:validate(mapped),source:parsed.source});
  });
}
async function acceptParsed(kind, parsed) { if(parsed.mapping.needsReview) showMapping(kind,parsed); else completeLoad(kind,parsed); }
async function load(kind,file) {
  try { await acceptParsed(kind,await parseFile(file)); }
  catch(error){document.querySelector('#validation-status').innerHTML=`<span class="text-rose-700">تعذرت قراءة الملف: ${esc(error.message)}</span>`;}
}
function controls() {
  const ui=document.createElement('section'); ui.id='app-controls'; ui.dir='rtl'; ui.dataset.exportHidden='true';
  ui.innerHTML=`<div class="control-card"><div class="control-heading"><i class="fa-solid fa-sliders"></i><div><b>إعداد التقرير</b><span>تُحفظ البيانات في المتصفح ولا تظهر هذه العناصر في التصدير.</span></div></div><label class="upload-control">الأسبوع الحالي<input id="current-upload" type="file" accept=".xlsx,.xls,.csv"><span id="current-file-name">لم يتم رفع ملف الأسبوع الحالي</span></label><label class="upload-control">الأسبوع السابق (اختياري)<input id="previous-upload" type="file" accept=".xlsx,.xls,.csv"><span id="previous-file-name">لا يوجد ملف أسبوع سابق</span></label><div class="sheet-control"><label>Google Sheets (رابط منشور عام)<input id="sheets-url" type="url" placeholder="https://docs.google.com/..." dir="ltr"></label><button type="button" id="load-sheets">تحميل الرابط</button></div><div class="date-control"><label>من<input id="period-from" type="date"></label><label>إلى<input id="period-to" type="date"></label><small id="date-source-notice"></small></div><label id="merchant-control" hidden>التاجر<select id="merchant-select"></select></label><div class="export-controls"><button id="export-png"><i class="fa-solid fa-image"></i> تصدير PNG</button><button id="export-pdf"><i class="fa-solid fa-file-pdf"></i> تصدير PDF</button></div></div><div id="validation-status" class="control-validation"></div>`;
  document.body.insertBefore(ui,canvas);
  $('#current-upload',ui).addEventListener('change',event=>event.target.files[0]&&load('current',event.target.files[0]));
  $('#previous-upload',ui).addEventListener('change',event=>event.target.files[0]&&load('previous',event.target.files[0]));
  $('#load-sheets',ui).addEventListener('click',async()=>{try { const url=$('#sheets-url',ui).value.trim(); if(!url) throw new Error('أدخل رابط Google Sheets المنشور.'); await acceptParsed('current',await parseGoogleSheet(url)); } catch(error) { $('#validation-status',document).innerHTML=`<span class="text-rose-700">تعذر تحميل Google Sheets: ${esc(error.message)}</span>`; }});
  $('#period-from',ui).addEventListener('change',event=>{state.from=event.target.value;refresh();}); $('#period-to',ui).addEventListener('change',event=>{state.to=event.target.value;refresh();});
  $('#merchant-select',ui).addEventListener('change',event=>{state.merchant=event.target.value;refresh();});
  $('#export-png',ui).addEventListener('click',exportPng); $('#export-pdf',ui).addEventListener('click',exportPdf);
}
canvas.addEventListener('focusout',event=>{const target=event.target;if(!target.matches('[data-override-key][contenteditable="true"]'))return;const value=latinDigits(clean(target.textContent))||'::';target.textContent=value;if(value==='::')delete state.overrides[target.dataset.overrideKey];else state.overrides[target.dataset.overrideKey]={value,source:'manual_override'};saveOverrides();});
controls(); refresh();
