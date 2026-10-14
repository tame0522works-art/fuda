import type { Doc } from './doc'
import type { Item } from './fields'
import { FONT_LIST, fontStack } from './fonts'
import { exportCardsPdf, exportPng, exportPopPdf, type PreviewPage } from './output'
import type { Images } from './render'

/**
 * 書き出しを Worker に頼む。Worker が使えないブラウザでは、今までどおり画面側で書き出す。
 * 値札 50 品目で合計約 0.9 秒、写真入りのポップで一度に約 0.3 秒、画面を止めていた（PC で計測。スマホではさらに長い）。
 */

export type ExportJob =
  | { kind: 'png'; doc: Doc }
  | { kind: 'pop'; doc: Doc }
  | { kind: 'cards'; card: Doc; items: Item[] }

/** Worker に同梱フォントを登録し直してもらうための、@font-face の中身 */
export type FontFaceDesc = { family: string; src: string; weight: string; style: string; unicodeRange: string }

export type ExportRequest = { id: number; job: ExportJob; images: [string, ImageBitmap][]; faces: FontFaceDesc[] }

export type ExportResponse =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'done'; blob: Blob; pages: PreviewPage[] }
  | { id: number; type: 'error'; message: string }
  | { id: number; type: 'unsupported' }

export type ExportResult = { blob: Blob; pages: PreviewPage[] }

class Unsupported extends Error {}

/** undefined: まだ作っていない。null: このブラウザでは使えない */
let worker: Worker | null | undefined
let nextId = 1

function getWorker(): Worker | null {
  if (worker === undefined) {
    try {
      worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      worker = null
    }
  }
  return worker
}

const docsOf = (job: ExportJob) => (job.kind === 'cards' ? [job.card] : [job.doc])

/** 書き出すデザインで使っている同梱フォントの @font-face を、読み込み済みの CSS から拾う */
function fontFacesFor(docs: readonly Doc[]): FontFaceDesc[] {
  const keys = new Set(docs.flatMap((d) => d.elements.flatMap((e) => (e.kind === 'text' ? [e.font] : []))))
  const families = new Set(
    FONT_LIST.filter((f) => keys.has(f.key) && f.group !== '標準').map((f) => fontStack(f.key).split(',')[0].trim().replace(/^"|"$/g, '')),
  )
  if (families.size === 0) return []
  const faces: FontFaceDesc[] = []
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      const family = rule.style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '')
      if (!families.has(family)) continue
      faces.push({
        family,
        src: rule.style.getPropertyValue('src'),
        weight: rule.style.getPropertyValue('font-weight') || 'normal',
        style: rule.style.getPropertyValue('font-style') || 'normal',
        unicodeRange: rule.style.getPropertyValue('unicode-range') || 'U+0-10FFFF',
      })
    }
  }
  return faces
}

function runInWorker(w: Worker, job: ExportJob, images: Images, onProgress?: (done: number, total: number) => void): Promise<ExportResult> {
  const id = nextId++
  // 書き出すデザインで使っている画像だけを渡す（ImageBitmap は写して渡され、画面側の分はそのまま残る）
  const used = new Set(docsOf(job).flatMap((d) => d.elements.flatMap((e) => (e.kind === 'image' ? [e.imageId] : []))))
  const request: ExportRequest = { id, job, images: [...images].filter(([k]) => used.has(k)), faces: fontFacesFor(docsOf(job)) }
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<ExportResponse>) => {
      const msg = e.data
      if (msg.id !== id) return
      if (msg.type === 'progress') {
        onProgress?.(msg.done, msg.total)
        return
      }
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
      if (msg.type === 'done') resolve({ blob: msg.blob, pages: msg.pages })
      else if (msg.type === 'unsupported') reject(new Unsupported())
      else reject(new Error(msg.message))
    }
    // Worker のスクリプト自体を読めなかったとき（古いブラウザなど）
    const onError = (e: ErrorEvent) => {
      e.preventDefault()
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
      reject(new Unsupported())
    }
    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    w.postMessage(request)
  })
}

async function runHere(job: ExportJob, images: Images, onProgress?: (done: number, total: number) => void): Promise<ExportResult> {
  if (job.kind === 'png') return { blob: await exportPng(job.doc, images), pages: [] }
  if (job.kind === 'pop') return exportPopPdf(job.doc, images, { preview: true })
  return exportCardsPdf(job.card, job.items, images, { preview: true, onProgress })
}

export async function runExportJob(job: ExportJob, images: Images, onProgress?: (done: number, total: number) => void): Promise<ExportResult> {
  const w = getWorker()
  if (w) {
    try {
      return await runInWorker(w, job, images, onProgress)
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e
      // このブラウザでは Worker で描けないので、以後は画面側で書き出す
      w.terminate()
      worker = null
    }
  }
  return runHere(job, images, onProgress)
}

/** どちらで書き出したか（計測とテストで確かめるため） */
export const usingWorker = () => !!worker
