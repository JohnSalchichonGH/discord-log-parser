// Web Worker client (off-thread parse + pipeline; graceful main-thread
// fallback). Extracted verbatim from app.js so both the legacy controller and
// the new Preact views share one worker. The worker handles setFiles / process /
// analyze / messages (see ../worker.js).

import DlpWorker from '../worker.js?worker&inline';

let worker = null;
let workerBroken = false;
export function getWorker() {
  if (workerBroken) return null;
  if (!worker && typeof Worker !== 'undefined') {
    try {
      worker = new DlpWorker();
    } catch {
      workerBroken = true;
    }
  }
  return worker;
}

// Force the main-thread fallback for the rest of the session (called by callers
// after a worker request throws), so getWorker() returns null thereafter.
export function markWorkerBroken() {
  workerBroken = true;
}

// One request/response round-trip; progress messages go to onProgress. Each
// request carries a unique id and only reacts to replies with the matching id,
// so concurrent setFiles/process calls can't resolve each other's promises.
let workerReqId = 0;
export function workerRequest(w, message, onProgress) {
  const id = ++workerReqId;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
    };
    const onMsg = (e) => {
      const d = e.data;
      if (d._id !== id) return; // a different request's reply
      if (d.type === 'progress') return onProgress && onProgress(d);
      cleanup();
      if (d.type === 'error') reject(new Error(d.message));
      else resolve(d);
    };
    const onErr = (e) => {
      cleanup();
      reject(new Error(e.message || 'worker error'));
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage({ ...message, _id: id });
  });
}

// lastModified disambiguates a re-export with the same name and byte size but
// edited content, so the worker cache doesn't serve a stale parse.
export const fileKey = (f) => `${f.name}|${f.size}|${f.lastModified}`;
