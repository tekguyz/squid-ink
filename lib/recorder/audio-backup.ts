/**
 * The local backup buffer, light version (ROADMAP §8b).
 *
 * The recorded blob is written here the moment MediaRecorder stops, BEFORE the
 * upload is attempted, and is discarded only once the note's processing_status
 * reaches 'completed'. Track 3 does not exist yet, so in this track the blob
 * legitimately persists after a successful upload. That is the rule working,
 * not a leak.
 *
 * IndexedDB, deliberately. A module-level variable dies on a full page load and
 * localStorage cannot hold binary; IndexedDB is the only browser store that
 * both survives navigation and holds a recording.
 *
 * WHAT IS STORED IS AN ArrayBuffer, NOT A Blob. Callers hand in a Blob and get
 * a Blob back — the conversion lives here — but the row itself holds bytes plus
 * a mime type. Two reasons, and the first is not merely a test concern:
 *
 *   1. Blob-in-IndexedDB is the historically flaky path. Safari in particular
 *      has shipped versions that store a Blob and hand back something unusable.
 *      An ArrayBuffer is a plain structured-clone type that every engine
 *      round-trips exactly.
 *   2. It is provable here. `fake-indexeddb` cannot structured-clone a jsdom
 *      Blob at all — it returns an empty object and the bytes are silently
 *      lost. Storing a Blob would mean the backup buffer had no test that its
 *      contents survive, which for a data-loss guard is not acceptable.
 *
 * This is NOT the full encrypted 48-hour buffer from the Core UX/UI phase.
 * Nothing here is encrypted and nothing expires on a timer.
 */
const DB_NAME = "recorder-backup";
const DB_VERSION = 1;
const STORE = "recordings";

/** What callers pass and receive. */
export interface BackupRecord {
  noteId: string;
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  savedAtMs: number;
}

/** What the object store actually holds. */
interface StoredRecord {
  noteId: string;
  bytes: ArrayBuffer;
  mimeType: string;
  durationSeconds: number;
  savedAtMs: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "noteId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Runs one request inside its own transaction and closes the connection.
 *  A long-lived connection would block the upgrade path on the next version. */
async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const toRecord = (stored: StoredRecord): BackupRecord => ({
  noteId: stored.noteId,
  blob: new Blob([stored.bytes], { type: stored.mimeType }),
  mimeType: stored.mimeType,
  durationSeconds: stored.durationSeconds,
  savedAtMs: stored.savedAtMs,
});

export async function saveBackup(record: BackupRecord): Promise<void> {
  const stored: StoredRecord = {
    noteId: record.noteId,
    bytes: await record.blob.arrayBuffer(),
    mimeType: record.mimeType,
    durationSeconds: record.durationSeconds,
    savedAtMs: record.savedAtMs,
  };
  await run("readwrite", (store) => store.put(stored));
}

export async function loadBackup(noteId: string): Promise<BackupRecord | null> {
  const found = await run<StoredRecord | undefined>("readonly", (store) =>
    store.get(noteId),
  );
  return found ? toRecord(found) : null;
}

export async function listBackups(): Promise<BackupRecord[]> {
  const rows = await run<StoredRecord[]>("readonly", (store) => store.getAll());
  return rows.map(toRecord);
}

/** Deleting a key that is not there is a success in IndexedDB, and that is the
 *  behaviour we want: a double-discard must not blow up the caller. */
export async function discardBackup(noteId: string): Promise<void> {
  await run("readwrite", (store) => store.delete(noteId));
}
