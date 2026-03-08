/**
 * Session persistence — save-on-blur pattern.
 *
 * Heavy data (raw WAV bytes) → IndexedDB  ("making-waves" db, "buffers" store)
 * Light data (slices, name)  → localStorage ("making-waves:session" key)
 *
 * Both are written together on visibilitychange → hidden and cleared on
 * explicit project close so a fresh start screen always appears next launch.
 */

const DB_NAME = 'making-waves';
const STORE_NAME = 'buffers';
const BUFFER_KEY = 'active_buffer';
const LS_KEY = 'making-waves:session';

export interface SessionMeta {
  version: number;
  projectName: string;
  originalFileName: string;
  slices: { start: number; end: number; name?: string }[];
  savedAt: number;
}

// --- IndexedDB helpers ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBufferToIDB(arrayBuffer: ArrayBuffer): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(arrayBuffer, BUFFER_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadBufferFromIDB(): Promise<ArrayBuffer | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(BUFFER_KEY);
    req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function clearIDB(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(BUFFER_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- localStorage helpers ---

export function saveMetaToLS(meta: SessionMeta): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(meta));
  } catch {
    // Quota exceeded or private browsing — silently ignore
  }
}

export function loadMetaFromLS(): SessionMeta | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionMeta;
    // Guard against stale/incompatible shape
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearLS(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch { /* ignore */ }
}

// --- Combined clear ---

export async function clearSession(): Promise<void> {
  clearLS();
  await clearIDB();
}
