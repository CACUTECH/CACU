// Offline selling (Doc 10 E17, Doc 13): sales made without a connection wait on this device, under their request key,
// until they are sent. Kept in IndexedDB per business and per person, so a sale is only ever sent by the person who
// made it. Nothing here is final: the server checks each sale when it arrives.

export type OfflinePayload = {
  request_key: string; sold_at: string; method: 'Cash' | 'Transfer'; bank_account_id: string | null; cash_received: string | null;
  location_id: string | null; quoted_total: string;
  items: { item_id: string; quantity: number; unit_price: string; discount_percent: string }[];
};
export type OutboxStatus = 'pending' | 'posted' | 'review' | 'failed';
export type OutboxEntry = {
  key: string; business_id: string; user_id: string; payload: OfflinePayload; names: Record<string, string>;
  status: OutboxStatus; detail: string | null; attempts: number; created_at: string; updated_at: string;
};
export type CatalogueSnapshot = {
  saved_at: string; items: unknown[]; banks: { id: string; name: string }[]; discount_cap: string; location_id: string | null;
};

const DB = 'cacu-offline';
const SALES = 'sales', SNAPSHOTS = 'snapshots';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Offline storage is not available in this browser')); return; }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SALES)) db.createObjectStore(SALES, { keyPath: 'key' }).createIndex('owner', ['business_id', 'user_id']);
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: 'owner' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = work(tx.objectStore(store));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

/** Keeps a sale on this device. A sale already kept under the same key is not replaced. */
export async function keepSale(entry: Omit<OutboxEntry, 'status' | 'detail' | 'attempts' | 'created_at' | 'updated_at'>) {
  const now = new Date().toISOString();
  await run(SALES, 'readwrite', s => s.add({ ...entry, status: 'pending', detail: null, attempts: 0, created_at: now, updated_at: now }));
}

export async function salesOnDevice(businessId: string): Promise<OutboxEntry[]> {
  const all = (await run<OutboxEntry[]>(SALES, 'readonly', s => s.getAll())) ?? [];
  return all.filter(e => e.business_id === businessId).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function markSale(key: string, change: Partial<Pick<OutboxEntry, 'status' | 'detail' | 'attempts'>>) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SALES, 'readwrite');
      const store = tx.objectStore(SALES);
      const found = store.get(key);
      found.onsuccess = () => { if (found.result) store.put({ ...found.result, ...change, updated_at: new Date().toISOString() }); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

/** Removes a sale from this device: only once the server has it, or when someone chooses to discard it. */
export async function forgetSale(key: string) {
  await run(SALES, 'readwrite', s => s.delete(key));
}

export async function saveSnapshot(businessId: string, userId: string, snapshot: CatalogueSnapshot) {
  await run(SNAPSHOTS, 'readwrite', s => s.put({ owner: `${businessId}:${userId}`, ...snapshot }));
}

export async function loadSnapshot(businessId: string, userId: string): Promise<CatalogueSnapshot | null> {
  return ((await run<CatalogueSnapshot>(SNAPSHOTS, 'readonly', s => s.get(`${businessId}:${userId}`))) as CatalogueSnapshot | undefined) ?? null;
}

/** Whether the device thinks it is online; a failed request is the final word. */
export const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
