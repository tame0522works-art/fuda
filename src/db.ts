import type { Doc, Tab } from './doc'
import type { Item } from './fields'
import { EMPTY_STATUS, type BackupStatus } from './reminder'

/** デザインも画像もこの端末の IndexedDB にだけ置く。どこにも送らない */

const DB_NAME = 'fuda'
const DB_VERSION = 1

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('docs')
      // 表紙などの画像は data URL にせず Blob のまま持つ（数 MB の画像でも文字列化で膨らませない）
      db.createObjectStore('images')
      db.createObjectStore('meta')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let dbPromise: Promise<IDBDatabase> | null = null
const db = () => (dbPromise ??= open())

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

export type Saved = {
  docs: Partial<Record<Tab, Doc>>
  items: Item[] | undefined
  images: Map<string, Blob>
  /** 読み込み時だけ使う。バックアップからの復元では今の値を引き継ぐ */
  backup?: BackupStatus
}

export async function loadAll(): Promise<Saved> {
  const [docKeys, docValues, items, backup, imageKeys, imageValues] = await Promise.all([
    run<IDBValidKey[]>('docs', 'readonly', (s) => s.getAllKeys()),
    run<Doc[]>('docs', 'readonly', (s) => s.getAll()),
    run<Item[] | undefined>('meta', 'readonly', (s) => s.get('items')),
    run<BackupStatus | undefined>('meta', 'readonly', (s) => s.get('backup')),
    run<IDBValidKey[]>('images', 'readonly', (s) => s.getAllKeys()),
    run<Blob[]>('images', 'readonly', (s) => s.getAll()),
  ])
  const docs: Partial<Record<Tab, Doc>> = {}
  docKeys.forEach((k, i) => (docs[k as Tab] = docValues[i]))
  const images = new Map<string, Blob>()
  imageKeys.forEach((k, i) => images.set(String(k), imageValues[i]))
  return { docs, items, images, backup: backup ?? EMPTY_STATUS }
}

export const saveDoc = (tab: Tab, doc: Doc) => run('docs', 'readwrite', (s) => s.put(doc, tab)).then(() => undefined)

export const saveBackupStatus = (status: BackupStatus) => run('meta', 'readwrite', (s) => s.put(status, 'backup')).then(() => undefined)

export const saveItems = (items: Item[]) => run('meta', 'readwrite', (s) => s.put(items, 'items')).then(() => undefined)

export const putImage = (id: string, blob: Blob) => run('images', 'readwrite', (s) => s.put(blob, id)).then(() => undefined)

export const deleteImage = (id: string) => run('images', 'readwrite', (s) => s.delete(id)).then(() => undefined)

export async function allImages(): Promise<Map<string, Blob>> {
  const [keys, values] = await Promise.all([
    run<IDBValidKey[]>('images', 'readonly', (s) => s.getAllKeys()),
    run<Blob[]>('images', 'readonly', (s) => s.getAll()),
  ])
  return new Map(keys.map((k, i) => [String(k), values[i]]))
}

/** バックアップからの復元。途中で失敗して半端に混ざらないよう、全部を1つの transaction で入れ替える */
export async function replaceAll(docs: Record<Tab, Doc>, items: Item[], images: ReadonlyMap<string, Blob>): Promise<void> {
  const d = await db()
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(['docs', 'images', 'meta'], 'readwrite')
    const docStore = tx.objectStore('docs')
    const imageStore = tx.objectStore('images')
    docStore.clear()
    imageStore.clear()
    for (const [tab, doc] of Object.entries(docs)) docStore.put(doc, tab)
    for (const [id, blob] of images) imageStore.put(blob, id)
    tx.objectStore('meta').put(items, 'items')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
