export function relativePath(file) {
  const path = file.webkitRelativePath || file.name;
  const slash = path.indexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}
export function indexFiles(files) {
  const map = new Map();
  for (const file of files) {
    const path = relativePath(file);
    if (map.has(path)) throw new Error(`Duplicate path: ${path}`);
    map.set(path, file);
  }
  return map;
}
export function lines(text) { return text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) || []; }
export function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
export function decode(bytes) {
  // UTF-16 BOMs are recognized; other text is decoded as strict UTF-8.
  let encoding = 'utf-8';
  if (bytes[0] === 255 && bytes[1] === 254) encoding = 'utf-16le';
  if (bytes[0] === 254 && bytes[1] === 255) encoding = 'utf-16be';
  try {
    const text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes);
    if (/[\x00-\x08\x0e-\x1f]/.test(text)) return null;
    return { text, encoding };
  } catch { return null; }
}
// Myers shortest edit script. The trace is bounded for heavily rewritten files;
// the fallback emits the entire changed middle, preserving every line.
export function diffLines(oldLines, newLines, traceLimit = 2_000_000) {
  let start = 0, end = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  while (end < oldLines.length - start && end < newLines.length - start && oldLines[oldLines.length - end - 1] === newLines[newLines.length - end - 1]) end++;
  const a = oldLines.slice(start, oldLines.length - end), b = newLines.slice(start, newLines.length - end);
  const prefix = oldLines.slice(0, start).map(text => ({ type: 'equal', text }));
  const suffix = end ? oldLines.slice(-end).map(text => ({ type: 'equal', text })) : [];
  let middle = [], replacement = false;
  if (!a.length) middle = b.map(text => ({ type: 'add', text }));
  else if (!b.length) middle = a.map(text => ({ type: 'del', text }));
  else {
    let frontier = new Map([[1, 0]]), trace = [], cells = 0, found = false;
    outer: for (let d = 0; d <= a.length + b.length; d++) {
      cells += frontier.size;
      if (cells > traceLimit) break;
      trace.push(new Map(frontier));
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && (frontier.get(k - 1) ?? -Infinity) < (frontier.get(k + 1) ?? -Infinity))) x = frontier.get(k + 1) ?? 0;
        else x = (frontier.get(k - 1) ?? 0) + 1;
        let y = x - k;
        while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; }
        frontier.set(k, x);
        if (x >= a.length && y >= b.length) {
          let bx = a.length, by = b.length;
          for (let t = d; t >= 0; t--) {
            const previous = trace[t], diagonal = bx - by;
            const prevK = diagonal === -t || (diagonal !== t && (previous.get(diagonal - 1) ?? -Infinity) < (previous.get(diagonal + 1) ?? -Infinity)) ? diagonal + 1 : diagonal - 1;
            const prevX = previous.get(prevK) ?? 0, prevY = prevX - prevK;
            while (bx > prevX && by > prevY) { middle.push({ type: 'equal', text: a[--bx] }); by--; }
            if (t > 0) {
              if (bx === prevX) middle.push({ type: 'add', text: b[--by] });
              else middle.push({ type: 'del', text: a[--bx] });
            }
          }
          middle.reverse(); found = true; break outer;
        }
      }
    }
    if (!found) {
      replacement = true;
      middle = [...a.map(text => ({ type: 'del', text })), ...b.map(text => ({ type: 'add', text }))];
    }
  }
  let oldNumber = 0, newNumber = 0;
  const rows = [...prefix, ...middle, ...suffix].map(row => ({ ...row, old: row.type === 'add' ? null : ++oldNumber, new: row.type === 'del' ? null : ++newNumber }));
  return { rows, replacement };
}
export async function compareFile(path, input, golden) {
  const [oldBytes, newBytes] = await Promise.all([input ? input.arrayBuffer().then(b => new Uint8Array(b)) : new Uint8Array(), golden ? golden.arrayBuffer().then(b => new Uint8Array(b)) : new Uint8Array()]);
  const status = !input ? 'added' : !golden ? 'removed' : equalBytes(oldBytes, newBytes) ? 'unchanged' : 'modified';
  const base = { path, status, oldSize: oldBytes.length, newSize: newBytes.length, rows: [], additions: 0, deletions: 0 };
  const oldDecoded = decode(oldBytes), newDecoded = decode(newBytes);
  if (!oldDecoded || !newDecoded) return { ...base, binary: true };
  const result = diffLines(lines(oldDecoded.text), lines(newDecoded.text));
  return { ...base, ...result, oldEncoding: oldDecoded.encoding, newEncoding: newDecoded.encoding, additions: result.rows.filter(r => r.type === 'add').length, deletions: result.rows.filter(r => r.type === 'del').length };
}
export function contextRows(rows, all = false, radius = 3) {
  if (all) return rows;
  const ranges = [];
  rows.forEach((row, i) => {
    if (row.type === 'equal') return;
    const from = Math.max(0, i - radius), to = Math.min(rows.length, i + radius + 1), last = ranges.at(-1);
    if (last && from <= last[1]) last[1] = to;
    else ranges.push([from, to]);
  });
  const result = []; let cursor = 0;
  for (const [from, to] of ranges) {
    if (from > cursor) result.push({ type: 'gap', count: from - cursor });
    for (let i = from; i < to; i++) result.push(rows[i]); cursor = to;
  }
  if (cursor < rows.length) result.push({ type: 'gap', count: rows.length - cursor });
  return result;
}
export function escapeHTML(value) { return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
export function rowHTML(row) {
  if (row.type === 'gap') return `<tr class="gap"><td colspan="4">${row.count} unchanged lines</td></tr>`;
  let text = row.text.replace(/(?:\r\n|\r|\n)$/, '');
  let ending = row.text.endsWith('\r\n') ? 'CRLF' : row.text.endsWith('\r') ? 'CR' : row.text.endsWith('\n') ? '' : 'No newline';
  text = escapeHTML(text).replace(/\ufeff/g, '<span class="eol">BOM</span>');
  const badge = ending && row.type !== 'equal' ? `<span class="eol">${ending}</span>` : '';
  return `<tr class="${row.type}"><td class="num">${row.old ?? ''}</td><td class="num">${row.new ?? ''}</td><td class="sign">${row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}</td><td class="code">${text}${badge}</td></tr>`;
}
