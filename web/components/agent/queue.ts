// Offline-first submission queue.
//
// Submissions are persisted to IndexedDB the moment the user taps "Submit".
// A background drainer (registered in the service worker in production)
// retries uploads with exponential backoff until each one lands.
//
// The same SHA-256 the worker validates is computed here, so a submission's
// hash is bound to the bytes the agent captured - not whatever bytes the
// upload pipeline happens to receive.

const DB_NAME = 'openballot-queue';
const STORE = 'submissions';
const DB_VERSION = 1;

export interface QueuedSubmission {
  id?: number;
  election_id: string;
  pu_code: string;
  source_type: 'party_agent' | 'observer';
  party_code: string | null;
  image_blob: Blob;
  image_sha256: string;
  image_bytes: number;
  gps: { lat: number; lng: number; acc: number } | null;
  captured_at: string;
  retries?: number;
  next_attempt_at?: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const OfflineQueue = {
  async enqueue(s: QueuedSubmission): Promise<number> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).add({ ...s, retries: 0, next_attempt_at: Date.now() });
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  },

  async depth(): Promise<number> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async drainOnce(send: (s: QueuedSubmission) => Promise<boolean>): Promise<number> {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const all = await new Promise<QueuedSubmission[]>((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result as QueuedSubmission[]);
      r.onerror = () => rej(r.error);
    });
    let sent = 0;
    const now = Date.now();
    for (const s of all) {
      if ((s.next_attempt_at ?? 0) > now) continue;
      try {
        const ok = await send(s);
        if (ok) {
          store.delete(s.id!);
          sent += 1;
        } else {
          const retries = (s.retries ?? 0) + 1;
          const backoff = Math.min(60_000, 2 ** retries * 1000);
          store.put({ ...s, retries, next_attempt_at: now + backoff });
        }
      } catch {
        const retries = (s.retries ?? 0) + 1;
        const backoff = Math.min(60_000, 2 ** retries * 1000);
        store.put({ ...s, retries, next_attempt_at: now + backoff });
      }
    }
    return sent;
  },
};

export async function computeSha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
