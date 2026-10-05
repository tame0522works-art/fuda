import type { Doc } from './doc'
import type { Item } from './fields'
import { buildPdf, chooseImage, flateImage, type PdfImage, type PdfPage } from './pdf'
import { ensureFonts } from './fonts'
import { drawDoc, drawSheet, textSpecs, type Images } from './render'
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
  await ensureFonts(textSpecs(doc))
  const { canvas, ctx } = surface(doc.page.width, doc.page.height)
  drawDoc(ctx, doc, 1, images)
  return canvas.convertToBlob({ type: 'image/png' })
}

/** 写真を印刷に使うときの JPEG の品質。300dpi で刷ると、これ以上上げても見た目の差は出にくい */
const PRINT_JPEG_QUALITY = 0.92

/** 確認画面に出すページ画像の幅（px）。300dpi の原寸を全ページ持つとメモリを使いすぎるので縮める */
const PREVIEW_WIDTH_PX = 1000

/** 確認画面に出す1ページ。PDF に埋め込むのと同じ画像（JPEG にしたページは圧縮後のもの）を縮めたもの */
export type PreviewPage = { bitmap: ImageBitmap; widthMm: number; heightMm: number; encoding: 'lossless' | 'jpeg' }

export type PdfExport = { blob: Blob; pages: PreviewPage[] }

type PrintOptions = { preview?: boolean }

/** hasPhoto のページは JPEG も作って比べる（pdf.ts の chooseImage） */
async function printPage(
  widthMm: number, heightMm: number, hasPhoto: boolean, opts: PrintOptions,
  draw: (ctx: OffscreenCanvasRenderingContext2D, k: number) => void,
): Promise<{ page: PdfPage; preview?: PreviewPage }> {
  const pxWidth = Math.round(widthMm * PX_PER_MM)
  const pxHeight = Math.round(heightMm * PX_PER_MM)
  const { canvas, ctx } = surface(pxWidth, pxHeight)
  draw(ctx, pxWidth / widthMm)
  // 可逆圧縮と JPEG はどちらもブラウザが裏で処理するので、順番に待たず同時に走らせる
  const [flate, jpeg] = await Promise.all([
    flateImage(rgbOf(ctx, pxWidth, pxHeight), pxWidth, pxHeight),
    hasPhoto
      ? canvas
          .convertToBlob({ type: 'image/jpeg', quality: PRINT_JPEG_QUALITY })
          .then(async (blob): Promise<PdfImage> => ({ filter: 'DCTDecode', data: new Uint8Array(await blob.arrayBuffer()), pxWidth, pxHeight }))
      : undefined,
  ])
  const image = chooseImage(flate, jpeg)
  const page = { widthMm, heightMm, image }
  if (!opts.preview) return { page }
  const resize = { resizeWidth: PREVIEW_WIDTH_PX, resizeQuality: 'high' } as const
  const jpegChosen = image.filter === 'DCTDecode'
  const bitmap = jpegChosen
    ? await createImageBitmap(new Blob([image.data as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), resize)
    : await createImageBitmap(canvas, resize)
  return { page, preview: { bitmap, widthMm, heightMm, encoding: jpegChosen ? 'jpeg' : 'lossless' } }
}

async function toPdfExport(printed: { page: PdfPage; preview?: PreviewPage }[]): Promise<PdfExport> {
  return {
    blob: new Blob([await buildPdf(printed.map((p) => p.page))], { type: 'application/pdf' }),
    pages: printed.flatMap((p) => (p.preview ? [p.preview] : [])),
  }
}

const hasPhoto = (doc: Doc) => doc.elements.some((e) => e.kind === 'image')

export async function exportPopPdf(doc: Doc, images: Images, opts: PrintOptions = {}): Promise<PdfExport> {
  await ensureFonts(textSpecs(doc))
  return toPdfExport([await printPage(doc.page.width, doc.page.height, hasPhoto(doc), opts, (ctx, k) => drawDoc(ctx, doc, k, images))])
}

export async function exportCardsPdf(card: Doc, items: readonly Item[], images: Images, opts: PrintOptions = {}): Promise<PdfExport> {
  const layout = layoutSheet(card.page)
  if (!layout) throw new Error('この大きさの値札は A4 に入りません')
  // 書体の読み込みが終わる前に描くと、その品目だけ代わりの書体で刷られてしまう
  await ensureFonts(textSpecs(card, items))
  const printed = []
  for (let s = 0; s < sheetCount(items.length, layout); s++) {
    printed.push(await printPage(A4.width, A4.height, hasPhoto(card), opts, (ctx, k) => drawSheet(ctx, card, items, s, k, images)))
  }
  return toPdfExport(printed)
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
