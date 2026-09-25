import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
async function capture() {
  const target = document.querySelector('#report-canvas');
  await document.fonts?.ready;
  target.classList.add('export-snapshot');
  try { return await html2canvas(target, { scale: 1.5, useCORS: true, backgroundColor: '#f0f4f8', windowWidth: target.scrollWidth }); }
  finally { target.classList.remove('export-snapshot'); }
}
function saveLink(href, name) {
  const link = document.createElement('a');
  link.href = href; link.download = name; link.style.display = 'none';
  document.body.append(link); link.click();
  window.setTimeout(() => link.remove(), 0);
}
export async function exportPng() { const canvas = await capture(); saveLink(canvas.toDataURL('image/png'), 'weekly-order-performance.png'); }
export async function exportPdf() { const canvas = await capture(); const image = canvas.toDataURL('image/jpeg', .96); const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] }); pdf.addImage(image, 'JPEG', 0, 0, canvas.width, canvas.height); saveLink(pdf.output('bloburl'), 'weekly-order-performance.pdf'); }
