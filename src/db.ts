import type { Doc, Tab } from './doc'
import type { Item } from './fields'

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
}

export async function loadAll(): Promise<Saved> {
  const [docKeys, docValues, items, imageKeys, imageValues] = await Promise.all([
    run<IDBValidKey[]>('docs', 'readonly', (s) => s.getAllKeys()),
    run<Doc[]>('docs', 'readonly', (s) => s.getAll()),
    run<Item[] | undefined>('meta', 'readonly', (s) => s.get('items')),
    run<IDBValidKey[]>('images', 'readonly', (s) => s.getAllKeys()),
    run<Blob[]>('images', 'readonly', (s) => s.getAll()),
  ])
  const docs: Partial<Record<Tab, Doc>> = {}
  docKeys.forEach((k, i) => (docs[k as Tab] = docValues[i]))
  const images = new Map<string, Blob>()
  imageKeys.forEach((k, i) => images.set(String(k), imageValues[i]))
  return { docs, items, images }
}

export const saveDoc = (tab: Tab, doc: Doc) => run('docs', 'readwrite', (s) => s.put(doc, tab)).then(() => undefined)

export const saveItems = (items: Item[]) => run('meta', 'readwrite', (s) => s.put(items, 'items')).then(() => undefined)

export const putImage = (id: string, blob: Blob) => run('images', 'readwrite', (s) => s.put(blob, id)).then(() => undefined)

export const deleteImage = (id: string) => run('images', 'readwrite', (s) => s.delete(id)).then(() => undefined)
