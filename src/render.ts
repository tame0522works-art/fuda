import type { Doc, El, TextEl } from './doc'
import { fillFields, type Item } from './fields'
import { fontStack } from './fonts'
import { A4, layoutSheet } from './sheet'
import { wrapText } from './wrap'

/**
 * 画面表示・PNG・PDF・値札の面付けは、すべてこの1つの描画関数を通す。
 * k は「ページの1単位（px または mm）を何ピクセルで描くか」。
 */

export type Images = ReadonlyMap<string, ImageBitmap>

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export const fontCss = (el: TextEl, px: number) => `${el.weight} ${px}px ${fontStack(el.font)}`

// 折り返しは描く倍率と無関係に、常に同じ基準サイズで測る。
// 画面（小さく描く）と書き出し（大きく描く）でフォントのヒンティング差が出て、改行位置がずれるのを防ぐため
const MEASURE_PX = 100
let measureCtx: OffscreenCanvasRenderingContext2D | null = null

export function textLines(el: TextEl, item?: Item): string[] {
  measureCtx ??= new OffscreenCanvas(1, 1).getContext('2d')!
  const ctx = measureCtx
  ctx.font = fontCss(el, MEASURE_PX)
  const scale = el.size / MEASURE_PX
  return wrapText(fillFields(el.text, item), el.w, (s) => ctx.measureText(s).width * scale)
}

export function drawDoc(ctx: Ctx, doc: Doc, k: number, images: Images, item?: Item) {
  ctx.save()
  ctx.fillStyle = doc.background
  ctx.fillRect(0, 0, doc.page.width * k, doc.page.height * k)
  for (const el of doc.elements) drawEl(ctx, el, k, images, item)
  ctx.restore()
}

function drawEl(ctx: Ctx, el: El, k: number, images: Images, item?: Item) {
  const x = el.x * k
  const y = el.y * k
  const w = el.w * k
  const h = el.h * k
  switch (el.kind) {
    case 'rect': {
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, Math.min(el.radius * k, w / 2, h / 2))
      if (el.fill !== 'transparent') {
        ctx.fillStyle = el.fill
        ctx.fill()
      }
      if (el.strokeWidth > 0 && el.stroke !== 'transparent') {
        ctx.strokeStyle = el.stroke
        ctx.lineWidth = el.strokeWidth * k
        ctx.stroke()
      }
      return
    }
    case 'image': {
      const img = images.get(el.imageId)
      if (!img) {
        ctx.fillStyle = '#d0d5dc'
        ctx.fillRect(x, y, w, h)
        return
      }
      const scale = el.fit === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height)
      const dw = img.width * scale
      const dh = img.height * scale
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, w, h)
      ctx.clip()
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
      ctx.restore()
      return
    }
    case 'text': {
      const lines = textLines(el, item)
      const lh = el.size * el.lineHeight * k
      ctx.font = fontCss(el, el.size * k)
      ctx.fillStyle = el.color
      ctx.textBaseline = 'middle'
      ctx.textAlign = el.align
      const tx = el.align === 'left' ? x : el.align === 'center' ? x + w / 2 : x + w
      lines.forEach((line, i) => ctx.fillText(line, tx, y + lh * (i + 0.5)))
      return
    }
  }
}

/**
 * 値札を A4 1枚分に面付けして描く。k は 1mm あたりのピクセル数。
 * 品目が1つもないときは、差し込み欄のまま1面だけ描いて見本にする。
 */
export function drawSheet(ctx: Ctx, card: Doc, items: readonly Item[], sheet: number, k: number, images: Images) {
  const layout = layoutSheet(card.page)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, A4.width * k, A4.height * k)
  if (!layout) return
  const onSheet: (Item | undefined)[] = items.length === 0 ? [undefined] : items.slice(sheet * layout.perSheet, (sheet + 1) * layout.perSheet)
  onSheet.forEach((item, i) => {
    const slot = layout.slots[i]
    ctx.save()
    ctx.translate(slot.x * k, slot.y * k)
    ctx.beginPath()
    ctx.rect(0, 0, card.page.width * k, card.page.height * k)
    ctx.clip()
    drawDoc(ctx, card, k, images, item)
    ctx.restore()
  })
  drawCutMarks(ctx, card, layout.cols, layout.rows, layout.area, k)
}

/** 切り取り線は値札の上には引かず、外周の余白にだけ出す（切った後に線が残らないように） */
function drawCutMarks(
  ctx: Ctx, card: Doc, cols: number, rows: number,
  area: { x0: number; y0: number; x1: number; y1: number }, k: number,
) {
  const gap = 2
  ctx.save()
  ctx.strokeStyle = '#8a929c'
  ctx.lineWidth = Math.max(1, 0.15 * k)
  ctx.beginPath()
  for (let c = 0; c <= cols; c++) {
    const x = (area.x0 + c * card.page.width) * k
    ctx.moveTo(x, 0)
    ctx.lineTo(x, (area.y0 - gap) * k)
    ctx.moveTo(x, (area.y1 + gap) * k)
    ctx.lineTo(x, A4.height * k)
  }
  for (let r = 0; r <= rows; r++) {
    const y = (area.y0 + r * card.page.height) * k
    ctx.moveTo(0, y)
    ctx.lineTo((area.x0 - gap) * k, y)
    ctx.moveTo((area.x1 + gap) * k, y)
    ctx.lineTo(A4.width * k, y)
  }
  ctx.stroke()
  ctx.restore()
}

/** 折り返した結果が枠の高さに収まらないか。値札では品名が長いものだけはみ出すので、品目ごとに確かめる */
export function textOverflows(el: TextEl, item?: Item): boolean {
  return textLines(el, item).length * el.size * el.lineHeight > el.h + 1e-6
}

/** 書体の読み込みに渡す「どの書体・太さで、どの文字を描くか」。値札は品目ごとに差し込んだ後の文字で数える */
export function textSpecs(doc: Doc, items: readonly (Item | undefined)[] = [undefined]) {
  return doc.elements.flatMap((el) =>
    el.kind === 'text' ? items.map((item) => ({ font: el.font, weight: el.weight, text: fillFields(el.text, item) })) : [],
  )
}
