import type { Doc } from './doc'
import type { Item } from './fields'
import { buildPdf, type PdfPage } from './pdf'
import { drawDoc, drawSheet, type Images } from './render'
import { A4, layoutSheet, sheetCount } from './sheet'

/** 家庭用プリンタにも同人誌の印刷所の推奨にも足りる解像度 */
export const PRINT_DPI = 300
const PX_PER_MM = PRINT_DPI / 25.4

function surface(w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h)
  return { canvas, ctx: canvas.getContext('2d')! }
}

function rgbOf(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): Uint8Array<ArrayBuffer> {
  const rgba = ctx.getImageData(0, 0, w, h).data
  const rgb = new Uint8Array(w * h * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]
    rgb[j + 1] = rgba[i + 1]
    rgb[j + 2] = rgba[i + 2]
  }
  return rgb
}

export async function exportPng(doc: Doc, images: Images): Promise<Blob> {
  const { canvas, ctx } = surface(doc.page.width, doc.page.height)
  drawDoc(ctx, doc, 1, images)
  return canvas.convertToBlob({ type: 'image/png' })
}

function printPage(widthMm: number, heightMm: number, draw: (ctx: OffscreenCanvasRenderingContext2D, k: number) => void): PdfPage {
  const pxWidth = Math.round(widthMm * PX_PER_MM)
  const pxHeight = Math.round(heightMm * PX_PER_MM)
  const { ctx } = surface(pxWidth, pxHeight)
  draw(ctx, pxWidth / widthMm)
  return { widthMm, heightMm, pxWidth, pxHeight, rgb: rgbOf(ctx, pxWidth, pxHeight) }
}

export async function exportPopPdf(doc: Doc, images: Images): Promise<Blob> {
  const page = printPage(doc.page.width, doc.page.height, (ctx, k) => drawDoc(ctx, doc, k, images))
  return new Blob([await buildPdf([page])], { type: 'application/pdf' })
}

export async function exportCardsPdf(card: Doc, items: readonly Item[], images: Images): Promise<Blob> {
  const layout = layoutSheet(card.page)
  if (!layout) throw new Error('この大きさの値札は A4 に入りません')
  const pages: PdfPage[] = []
  for (let s = 0; s < sheetCount(items.length, layout); s++) {
    pages.push(printPage(A4.width, A4.height, (ctx, k) => drawSheet(ctx, card, items, s, k, images)))
  }
  return new Blob([await buildPdf(pages)], { type: 'application/pdf' })
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // クリック直後に解放すると、ブラウザによってはダウンロードが始まる前に URL が消える
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function fileStamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
}
