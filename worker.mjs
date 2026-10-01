import { indexFiles, compareFile } from './diff-core.mjs';
self.onmessage = async ({ data }) => {
  try {
    const golden = indexFiles(data.golden), input = indexFiles(data.input);
    const paths = [...new Set([...golden.keys(), ...input.keys()])].sort();
    const results = [];
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      try { results.push(await compareFile(path, input.get(path), golden.get(path))); }
      catch (error) { results.push({ path, status: 'error', message: error.message, rows: [], additions: 0, deletions: 0 }); }
      if (i % 10 === 0 || i === paths.length - 1) self.postMessage({ type: 'progress', done: i + 1, total: paths.length });
    }
    self.postMessage({ type: 'complete', results });
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
