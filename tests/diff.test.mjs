import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, lines, compareFile, relativePath, indexFiles, contextRows, rowHTML, decode } from '../diff-core.mjs';
import { buildReport } from '../report.mjs';
const blob = (content, path = 'root/file.txt') => Object.assign(new Blob([content]), { name: path.split('/').at(-1), webkitRelativePath: path });
function verify(a, b, limit) {
  const result = diffLines(a, b, limit);
  assert.deepEqual(result.rows.filter(r => r.type !== 'add').map(r => r.text), a);
  assert.deepEqual(result.rows.filter(r => r.type !== 'del').map(r => r.text), b);
  let old = 0, next = 0;
  for (const row of result.rows) {
    assert.equal(row.old, row.type === 'add' ? null : ++old);
    assert.equal(row.new, row.type === 'del' ? null : ++next);
  }
  return result;
}
test('matches relative paths, regardless of root', () => {
  const a = blob('x', 'input/backend/accounts/models.py'), b = blob('x', 'golden_output/backend/accounts/models.py');
  assert.equal(relativePath(a), relativePath(b));
  assert.throws(() => indexFiles([a, a]), /Duplicate/);
});
test('added, removed, empty, identical, modified and binary files', async () => {
  assert.equal((await compareFile('a', null, blob(''))).status, 'added');
  assert.equal((await compareFile('a', blob(''), null)).status, 'removed');
  assert.equal((await compareFile('a', blob(''), blob(''))).status, 'unchanged');
  const file = await compareFile('a', blob('a\nb\n'), blob('a\nc\n'));
  assert.equal(file.status, 'modified'); assert.equal(file.additions, 1); assert.equal(file.deletions, 1);
  const binary = await compareFile('x', blob(new Uint8Array([0, 1])), blob(new Uint8Array([0, 2])));
  assert.equal(binary.status, 'modified'); assert.equal(binary.binary, true);
  assert.equal((await compareFile('x', blob(new Uint8Array([0])), blob(new Uint8Array([0])))).status, 'unchanged');
  assert.equal((await compareFile('x', null, blob(new Uint8Array([255])))).binary, true);
});
test('preserves CRLF, CR, LF, trailing newline and BOM changes', async () => {
  assert.deepEqual(lines('a\r\nb\rc\nlast'), ['a\r\n', 'b\r', 'c\n', 'last']);
  assert.deepEqual(lines('\n\n'), ['\n', '\n']);
  for (const [a, b] of [['x\n', 'x'], ['x\r\n', 'x\n'], ['x', '\ufeffx']]) {
    const f = await compareFile('x', blob(a), blob(b));
    assert.equal(f.status, 'modified'); assert.equal(f.additions, 1); assert.equal(f.deletions, 1);
  }
  assert.match(rowHTML({ type: 'add', text: 'x', old: null, new: 1 }), /No newline/);
  assert.equal(decode(new Uint8Array([255,254,97,0])).encoding, 'utf-16le');
});
test('edit script reconstruction and shortest distance against independent oracle', () => {
  let seed = 12345;
  const random = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let t = 0; t < 500; t++) {
    const a = Array.from({ length: random(18) }, () => String(random(5))), b = Array.from({ length: random(18) }, () => String(random(5)));
    const { rows } = verify(a, b);
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1]);
    assert.equal(rows.filter(r => r.type !== 'equal').length, dp[a.length][b.length]);
  }
});
test('bounded rewrite fallback and large files retain all lines', () => {
  const a = Array.from({length: 10000}, (_, i) => `old ${i}\n`), b = Array.from({length: 10000}, (_, i) => `new ${i}\n`);
  assert.equal(verify(a, b, 100).replacement, true);
  const identical = Array.from({length: 150000}, () => 'unchanged\n');
  const rows = verify(identical, [...identical.slice(0, 75000), 'insert\n', ...identical.slice(75000)]).rows;
  assert.ok(contextRows(rows).some(r => r.type === 'add'));
  assert.equal(contextRows(rows, true).length, 150001);
});
test('HTML report escapes paths and content, includes all statuses and lines', async () => {
  const f = await compareFile('<img src=x onerror=alert(1)>.txt', blob('safe\n<script>bad()</script>\n'), blob('safe\n<img src=x>\n'));
  const report = buildReport([f], { golden: 'golden<script>', input: 'input' });
  assert.ok(report.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.ok(report.includes('&lt;img src=x&gt;'));
  assert.ok(!report.includes('<script>')); assert.ok(report.includes('safe'));
  assert.ok(report.includes('1 modified'));
});
test('hundreds of nested files compare without omissions', async () => {
  const golden = indexFiles(Array.from({length: 350}, (_, i) => blob(`value ${i}\n`, `baseline/backend/${i}.py`)));
  const input = indexFiles(Array.from({length: 350}, (_, i) => blob(`value ${i + (i % 7 === 0 ? 1 : 0)}\n`, `candidate/backend/${i}.py`)));
  const results = await Promise.all([...golden.keys()].map(path => compareFile(path, input.get(path), golden.get(path))));
  assert.equal(results.length, 350); assert.equal(results.filter(f => f.status === 'modified').length, 50);
});


test('worker reports the changes Golden makes to Input', async () => {
  const messages = [];
  globalThis.self = { postMessage: message => messages.push(message) };
  try {
    await import('../worker.mjs');
    await self.onmessage({ data: {
      input: [blob('old\nkeep\n', 'source/backend/models.py'), blob('removed\n', 'source/input-only.txt'), blob(new Uint8Array([0, 1]), 'source/image.bin')],
      golden: [blob('new\nkeep\nextra\n', 'target/backend/models.py'), blob('added\n', 'target/golden-only.txt'), blob(new Uint8Array([0, 2, 3]), 'target/image.bin')]
    } });
    const files = messages.find(m => m.type === 'complete').results;
    const modified = files.find(f => f.path === 'backend/models.py');
    assert.deepEqual(modified.rows.filter(r => r.type === 'del').map(r => r.text), ['old\n']);
    assert.deepEqual(modified.rows.filter(r => r.type === 'add').map(r => r.text), ['new\n', 'extra\n']);
    assert.equal(modified.additions, 2); assert.equal(modified.deletions, 1);
    assert.equal(files.find(f => f.path === 'input-only.txt').status, 'removed');
    assert.equal(files.find(f => f.path === 'golden-only.txt').status, 'added');
    const binary = files.find(f => f.path === 'image.bin');
    assert.equal(binary.oldSize, 2); assert.equal(binary.newSize, 3);
    const html = buildReport(files, { input: 'source', golden: 'target' });
    assert.ok(html.includes('Input: source · Golden: target'));
    assert.ok(html.includes('− Input &nbsp; + Golden'));
    assert.ok(html.includes('Input: 2 bytes · Golden: 3 bytes'));
    assert.ok(html.includes('Input to Golden diff'));
  } finally { delete globalThis.self; }
});
