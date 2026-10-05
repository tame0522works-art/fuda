/** 値札を A4 に何面並べるか。印刷所ではなく家庭のプリンタで刷って切る前提 */

export const A4 = { width: 210, height: 297 }

/** 家庭用プリンタの多くが端まで刷れないので、外周はこれだけ空ける */
export const SHEET_MARGIN = 10

export type SheetLayout = {
  cols: number
  rows: number
  perSheet: number
  /** 各面の左上（mm）。左上から右へ、行ごとに下へ */
  slots: { x: number; y: number }[]
  /** 並べた範囲全体の左上と右下。切り取り線を外周にだけ引くために使う */
  area: { x0: number; y0: number; x1: number; y1: number }
}

export function layoutSheet(card: { width: number; height: number }, paper = A4, margin = SHEET_MARGIN): SheetLayout | null {
  // 浮動小数点の誤差で 190/95 が 1.999… になり1列減るのを防ぐ
  const eps = 1e-6
  const cols = Math.floor((paper.width - margin * 2) / card.width + eps)
  const rows = Math.floor((paper.height - margin * 2) / card.height + eps)
  if (cols < 1 || rows < 1) return null
  const x0 = (paper.width - cols * card.width) / 2
  const y0 = (paper.height - rows * card.height) / 2
  const slots: { x: number; y: number }[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) slots.push({ x: x0 + c * card.width, y: y0 + r * card.height })
  }
  return { cols, rows, perSheet: cols * rows, slots, area: { x0, y0, x1: x0 + cols * card.width, y1: y0 + rows * card.height } }
}

export function sheetCount(itemCount: number, layout: SheetLayout): number {
  return Math.max(1, Math.ceil(itemCount / layout.perSheet))
}
