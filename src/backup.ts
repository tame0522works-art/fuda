import type { Doc, El, Page, Tab } from './doc'
import type { Item } from './fields'

/**
 * デザイン3つ・品目・画像を1つの JSON にまとめたバックアップ。
 * 別の端末へ移すときや、ブラウザのデータが消えたときに戻すために使う。
 * 画像は Blob のままでは JSON に入らないので base64 にして埋め込む（約1.33倍に膨らむ）。
 */

export type Backup = {
  app: 'fuda'
  format: 1
  exportedAt: string
  docs: Record<Tab, Doc>
  items: Item[]
  images: Record<string, { type: string; base64: string }>
}

export type Restored = { docs: Record<Tab, Doc>; items: Item[]; images: Map<string, Blob> }

const TABS: Tab[] = ['menu', 'pop', 'card']
const TAB_LABEL: Record<Tab, string> = { menu: 'お品書き', pop: 'ポップ', card: '値札' }
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|avif|bmp)$/
const COLOR = /^(#[0-9a-fA-F]{6}|transparent)$/
/** 取り込むときの上限。画像の追加と同じ 20MB を base64 にした長さ */
const MAX_IMAGE_BASE64 = Math.ceil((20 * 1024 * 1024 * 4) / 3) + 4
const MAX_ELEMENTS = 1000

function toBase64(bytes: Uint8Array): string {
  let s = ''
  // String.fromCharCode に一度に渡せる引数の数には上限があるので、区切って変換する
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes
}

/** デザインで使われている画像だけを入れる（削除した画像は入れない） */
export async function toBackup(docs: Record<Tab, Doc>, items: readonly Item[], blobs: ReadonlyMap<string, Blob>, now = new Date()): Promise<Backup> {
  const used = new Set(TABS.flatMap((t) => docs[t].elements.flatMap((e) => (e.kind === 'image' ? [e.imageId] : []))))
  const images: Backup['images'] = {}
  for (const id of used) {
    const blob = blobs.get(id)
    if (blob) images[id] = { type: blob.type, base64: toBase64(new Uint8Array(await blob.arrayBuffer())) }
  }
  return { app: 'fuda', format: 1, exportedAt: now.toISOString(), docs, items: [...items], images }
}

// ---- 読み込み。外から来るファイルなので、知っている形だけを組み立て直して取り込む ----

class BackupError extends Error {}
const fail = (message: string): never => {
  throw new BackupError(message)
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, where: string, min = -1e6, max = 1e6): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(`${where}の数値が読めません`)
const str = (v: unknown, where: string, max = 10_000): string =>
  typeof v === 'string' && v.length <= max ? v : fail(`${where}の文字が読めません`)
const color = (v: unknown, where: string): string => (typeof v === 'string' && COLOR.test(v) ? v : fail(`${where}の色が読めません`))
function oneOf<T extends string | number>(v: unknown, options: readonly T[], where: string): T {
  return options.includes(v as T) ? (v as T) : fail(`${where}の指定が読めません`)
}

function parsePage(v: unknown, where: string): Page {
  if (!isObj(v)) return fail(`${where}の用紙が読めません`)
  return {
    width: num(v.width, `${where}の用紙`, 1, 10_000),
    height: num(v.height, `${where}の用紙`, 1, 10_000),
    unit: oneOf(v.unit, ['px', 'mm'] as const, `${where}の用紙の単位`),
  }
}

function parseEl(v: unknown, where: string, imageIds: ReadonlySet<string>): El {
  if (!isObj(v)) return fail(`${where}が読めません`)
  const box = {
    id: str(v.id, where, 100) || fail(`${where}の id が空です`),
    x: num(v.x, where), y: num(v.y, where),
    w: num(v.w, where, 0.001), h: num(v.h, where, 0.001),
  }
  switch (v.kind) {
    case 'text':
      return {
        ...box, kind: 'text',
        text: str(v.text, where),
        size: num(v.size, `${where}の文字サイズ`, 0.001, 10_000),
        color: color(v.color, where),
        weight: oneOf(v.weight, [400, 700] as const, `${where}の太さ`),
        align: oneOf(v.align, ['left', 'center', 'right'] as const, `${where}の揃え`),
        font: str(v.font, `${where}の書体`, 200),
        lineHeight: num(v.lineHeight, `${where}の行間`, 0.5, 5),
      }
    case 'rect':
      return {
        ...box, kind: 'rect',
        fill: color(v.fill, where), stroke: color(v.stroke, where),
        strokeWidth: num(v.strokeWidth, where, 0), radius: num(v.radius, where, 0),
      }
    case 'image': {
      const imageId = str(v.imageId, where, 100)
      if (!imageIds.has(imageId)) fail(`${where}の画像がファイルに入っていません`)
      return { ...box, kind: 'image', imageId, fit: oneOf(v.fit, ['cover', 'contain'] as const, `${where}の画像の収め方`) }
    }
    default:
      return fail(`${where}の種類が読めません`)
  }
}

function parseDoc(v: unknown, tab: Tab, imageIds: ReadonlySet<string>): Doc {
  const where = `「${TAB_LABEL[tab]}」`
  if (!isObj(v)) return fail(`${where}のデザインが見つかりません`)
  if (!Array.isArray(v.elements) || v.elements.length > MAX_ELEMENTS) return fail(`${where}の要素が読めません`)
  const elements = v.elements.map((e, i) => parseEl(e, `${where}の${i + 1}番目の要素`, imageIds))
  if (new Set(elements.map((e) => e.id)).size !== elements.length) fail(`${where}に同じ id の要素があります`)
  return { page: parsePage(v.page, where), background: color(v.background, `${where}の背景`), elements }
}

export function parseBackup(json: unknown): Restored {
  if (!isObj(json)) return fail('JSON の形式ではありません')
  if (json.app === 'tsuri') return fail('これは tsuri のバックアップです。品目だけなら「値札」の「tsuri から読み込む」で取り込めます')
  if (json.app !== 'fuda') return fail('fuda のバックアップファイルではありません')
  if (json.format !== 1) return fail(`この形式（format: ${String(json.format)}）にはまだ対応していません`)

  if (!isObj(json.images)) return fail('画像の一覧が読めません')
  const images = new Map<string, Blob>()
  for (const [id, raw] of Object.entries(json.images)) {
    if (!isObj(raw) || typeof raw.type !== 'string' || !IMAGE_TYPES.test(raw.type)) fail(`画像 ${id} の形式が読めません`)
    const image = raw as { type: string; base64: unknown }
    if (typeof image.base64 !== 'string' || image.base64.length > MAX_IMAGE_BASE64) fail(`画像 ${id} が読めないか、大きすぎます`)
    let bytes: Uint8Array<ArrayBuffer>
    try {
      bytes = fromBase64(image.base64 as string)
    } catch {
      return fail(`画像 ${id} が壊れています`)
    }
    images.set(id, new Blob([bytes], { type: image.type }))
  }

  if (!isObj(json.docs)) return fail('デザインが見つかりません')
  const docsIn = json.docs
  const ids = new Set(images.keys())
  const docs = Object.fromEntries(TABS.map((t) => [t, parseDoc(docsIn[t], t, ids)])) as Record<Tab, Doc>

  if (!Array.isArray(json.items)) return fail('品目が読めません')
  const items = json.items.map((raw, i): Item => {
    if (!isObj(raw)) return fail(`${i + 1}件目の品目が読めません`)
    return { id: str(raw.id, `${i + 1}件目の品目`, 100), name: str(raw.name, `${i + 1}件目の品名`, 500), price: num(raw.price, `${i + 1}件目の価格`, 0, 10_000_000) }
  })
  return { docs, items, images }
}

export const isBackupError = (e: unknown): e is Error => e instanceof BackupError
