import { contextRows, rowHTML, escapeHTML as esc } from './diff-core.mjs';
import { buildReport, fileNotice } from './report.mjs';
const $ = id => document.getElementById(id);
const folders = { input: [], golden: [] }, roots = { input: '', golden: '' };
let results = [], selected = null, worker = null, visibleRows = [], shown = 0;
const labels = { modified: 'Modified', added: 'Added', removed: 'Removed', unchanged: 'Unchanged', error: 'Errors' };
const markers = { modified: 'M', added: '+', removed: '−', unchanged: '=', error: '!' };
function setBusy(busy) {
  $('compare').disabled = busy || !folders.input.length || !folders.golden.length;
  $('cancel').hidden = !busy;
  for (const side of ['input', 'golden']) $(side + '-folder').disabled = busy;
}
function clearReport() {
  results = []; selected = null;
  $('report').hidden = true; $('empty').hidden = false; $('error').hidden = true; $('progress').textContent = '';
}
function showError(message) { $('error').textContent = message; $('error').hidden = false; }
for (const side of ['input', 'golden']) {
  $(side + '-folder').addEventListener('change', event => {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    folders[side] = files;
    roots[side] = files[0].webkitRelativePath.split('/')[0] || 'Directory';
    $(side + '-name').textContent = roots[side];
    $(side + '-count').textContent = `${files.length.toLocaleString()} files`;
    clearReport(); setBusy(false);
  });
}
$('compare').addEventListener('click', () => {
  clearReport(); setBusy(true); $('progress').textContent = 'Comparing…';
  try {
    worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') $('progress').textContent = `${data.done.toLocaleString()} / ${data.total.toLocaleString()} files`;
      if (data.type === 'error') { finish(); showError(data.message); }
      if (data.type === 'complete') { results = data.results; finish(); displayReport(); }
    };
    worker.onerror = () => { finish(); showError('Comparison failed. Reload the page and try again.'); };
    worker.postMessage(folders);
  } catch { finish(); showError('Comparison could not start. Open this app through its website URL.'); }
});
function finish() { worker?.terminate(); worker = null; setBusy(false); $('progress').textContent = ''; }
$('cancel').addEventListener('click', () => { finish(); $('progress').textContent = 'Canceled'; });
function displayReport() {
  $('empty').hidden = true; $('report').hidden = false;
  $('report-roots').textContent = `${roots.input} → ${roots.golden}`;
  const counts = Object.fromEntries(Object.keys(labels).map(status => [status, results.filter(f => f.status === status).length]));
  const stats = [{ label: 'Total files', count: results.length }, ...Object.keys(labels).filter(s => s !== 'error' || counts.error).map(s => ({ label: labels[s], count: counts[s] }))];
  $('stats').innerHTML = stats.map(s => `<div class="stat"><strong>${s.count.toLocaleString()}</strong><span>${s.label}</span></div>`).join('');
  $('search').value = ''; $('filter').value = 'changed'; $('all-lines').checked = false;
  renderFileList();
  if (counts.error) showError(`${counts.error} files could not be read. See Errors in the report.`);
}
function renderFileList() {
  const search = $('search').value.toLowerCase(), filter = $('filter').value;
  const files = results.filter(f => f.path.toLowerCase().includes(search) && (filter === 'all' || (filter === 'changed' ? f.status !== 'unchanged' : f.status === filter)));
  if (!files.some(f => f.path === selected?.path)) selected = files[0] || null;
  $('file-list').replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const file of files) {
    const button = document.createElement('button'); button.className = 'file-item';
    button.setAttribute('aria-current', String(selected?.path === file.path));
    button.setAttribute('aria-label', `${labels[file.status]}: ${file.path}`);
    button.innerHTML = `<span class="marker ${file.status}">${markers[file.status]}</span><span class="path">${esc(file.path)}</span>`;
    button.addEventListener('click', () => {
      selected = file;
      for (const item of $('file-list').children) item.setAttribute('aria-current', String(item === button));
      renderDetail();
    });
    fragment.append(button);
  }
  if (!files.length) {
    const empty = document.createElement('p'); empty.className = 'empty-files';
    empty.textContent = results.every(f => f.status === 'unchanged') && filter === 'changed' && !search ? 'Directories are identical' : 'No matching files';
    fragment.append(empty);
  }
  $('file-list').append(fragment); renderDetail();
}
function renderDetail() {
  $('more').hidden = true; $('diff-body').replaceChildren(); $('diff-body').scrollTop = 0;
  if (!selected) {
    $('file-path').textContent = ''; $('file-status').textContent = ''; $('file-status').className = 'badge';
    const notice = document.createElement('p'); notice.className = 'notice'; notice.textContent = 'No file selected'; $('diff-body').append(notice); return;
  }
  $('file-path').textContent = selected.path;
  $('file-status').textContent = labels[selected.status]; $('file-status').className = `badge ${selected.status}`;
  const notice = fileNotice(selected);
  if (notice) {
    const p = document.createElement('p'); p.className = 'notice'; p.textContent = notice; $('diff-body').append(p); return;
  }
  const messages = [];
  if (selected.oldEncoding !== selected.newEncoding) messages.push(`Encoding: ${selected.oldEncoding} → ${selected.newEncoding}`);
  if (selected.replacement) messages.push('Full replacement shown.');
  if (messages.length) { const p = document.createElement('p'); p.className = 'notice'; p.textContent = messages.join(' '); $('diff-body').append(p); }
  visibleRows = contextRows(selected.rows, $('all-lines').checked || selected.status === 'unchanged'); shown = 0;
  const table = document.createElement('table'); table.className = 'diff-table'; table.setAttribute('aria-label', 'Input to Golden diff'); table.append(document.createElement('tbody')); $('diff-body').append(table);
  appendRows();
}
function appendRows() {
  const next = Math.min(shown + 400, visibleRows.length);
  $('diff-body').querySelector('tbody').insertAdjacentHTML('beforeend', visibleRows.slice(shown, next).map(rowHTML).join(''));
  shown = next; $('more').hidden = shown >= visibleRows.length;
  $('more').textContent = `Show more lines (${(visibleRows.length - shown).toLocaleString()} remaining)`;
}
$('more').addEventListener('click', appendRows);
$('search').addEventListener('input', renderFileList); $('filter').addEventListener('change', renderFileList); $('all-lines').addEventListener('change', renderDetail);
$('download').addEventListener('click', async () => {
  const reportFiles = results, reportRoots = { ...roots };
  const button = $('download'); button.disabled = true; button.textContent = 'Preparing…';
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    const url = URL.createObjectURL(new Blob([buildReport(reportFiles, reportRoots)], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'directory-diff-report.html'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch { showError('The report could not be downloaded. Try again.'); }
  finally { button.disabled = false; button.textContent = 'Download report'; }
});
