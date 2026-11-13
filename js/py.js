// Runs Python in a Web Worker using Pyodide (loaded on first use from a CDN).
// The worker can be killed if user code loops forever.
const PYODIDE = (window.DTL_PYODIDE_URL || 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/');

const workerSrc = `
let ready = null;
async function boot(base) {
  importScripts(base + 'pyodide.js');
  self.pyodide = await loadPyodide({ indexURL: base });
}
onmessage = async (e) => {
  const { id, base, code } = e.data;
  try {
    if (!ready) ready = boot(base);
    await ready;
    postMessage({ id, stage: 'loaded' });
    let out = '';
    const w = { batched: (s) => { out += s + '\\n'; } };
    pyodide.setStdout(w); pyodide.setStderr(w);
    await pyodide.loadPackagesFromImports(code);
    try {
      const ns = pyodide.globals.get('dict')();
      await pyodide.runPythonAsync(code, { globals: ns });
      ns.destroy();
      postMessage({ id, ok: true, out });
    } catch (err) {
      postMessage({ id, ok: false, out, err: String(err.message || err) });
    }
  } catch (err) {
    ready = null;
    postMessage({ id, ok: false, out: '', err: String(err.message || err), boot: true });
  }
};`;

let worker = null, seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
  worker.onmessage = e => {
    const job = pending.get(e.data.id);
    if (!job) return;
    if (e.data.stage) { job.onStage && job.onStage(e.data.stage); return; }
    clearTimeout(job.timer); pending.delete(e.data.id); job.resolve(e.data);
  };
  worker.onerror = e => {
    pending.forEach(job => { clearTimeout(job.timer); job.resolve({ ok: false, out: '', err: e.message || 'Could not start the Python runtime', boot: true }); });
    pending.clear(); worker.terminate(); worker = null;
  };
  return worker;
}

// Keep the last line of a Python traceback plus the line number inside user code.
export function tidyError(err) {
  const lines = String(err).trim().split('\n');
  const last = lines[lines.length - 1] || 'Error';
  const where = [...lines].reverse().find(l => /File "<exec>", line (\d+)/.test(l));
  const ln = where && /line (\d+)/.exec(where)[1];
  return ln ? `${last}  (line ${ln})` : last;
}

export function runPython(code, { timeout = 15000, onStage } = {}) {
  return new Promise(resolve => {
    const id = ++seq, w = getWorker();
    const job = { resolve, onStage };
    job.timer = setTimeout(() => {
      // First load can be slow; only enforce the limit once the runtime is up.
      if (!job.loaded) { job.timer = setTimeout(job.kill, 60000); return; }
      job.kill();
    }, timeout);
    job.kill = () => {
      pending.delete(id); worker.terminate(); worker = null;
      resolve({ ok: false, out: '', err: job.loaded ? 'Stopped: the code ran for too long. Check for a loop that never ends.' : 'The Python runtime did not load. Check your connection and run again.', boot: !job.loaded });
    };
    const stage = onStage;
    job.onStage = s => { job.loaded = true; clearTimeout(job.timer); job.timer = setTimeout(job.kill, timeout); stage && stage(s); };
    pending.set(id, job);
    w.postMessage({ id, base: PYODIDE, code });
  });
}
