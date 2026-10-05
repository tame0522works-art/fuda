import { round, uid, type Doc, type El } from './doc'
import type { Box } from './snap'

/** 複数の要素をまとめて扱う操作。1つだけのときも同じ関数で扱う */

export function bboxOf(els: readonly Box[]): Box {
  const x0 = Math.min(...els.map((e) => e.x))
  const y0 = Math.min(...els.map((e) => e.y))
  const x1 = Math.max(...els.map((e) => e.x + e.w))
  const y1 = Math.max(...els.map((e) => e.y + e.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const pick = (doc: Doc, ids: readonly string[]) => doc.elements.filter((e) => ids.includes(e.id))

/**
 * 点 p にある一番手前の要素。塗りのない図形（枠線だけ）は線の近くでしか当たらない。
 * 外枠の内側を押したときに、中の文字ではなく外枠をつかんでしまうのを防ぐため。
 * tol は「線の近く」とみなす幅（用紙の単位）。
 */
export function hitTest(doc: Doc, p: { x: number; y: number }, tol: number): El | undefined {
  return [...doc.elements].reverse().find((el) => {
    const inside = p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y && p.y <= el.y + el.h
    if (el.kind !== 'rect' || el.fill !== 'transparent') return inside
    const band = el.strokeWidth / 2 + tol
    const outer = p.x >= el.x - band && p.x <= el.x + el.w + band && p.y >= el.y - band && p.y <= el.y + el.h + band
    const inner = p.x > el.x + band && p.x < el.x + el.w - band && p.y > el.y + band && p.y < el.y + el.h - band
    return outer && !inner
  })
}

/** 囲んだ範囲にすっぽり入っている要素（はみ出しているものは選ばない。背景の大きな枠まで拾わないように） */
export function idsInside(doc: Doc, r: Box): string[] {
  return doc.elements.filter((e) => e.x >= r.x && e.y >= r.y && e.x + e.w <= r.x + r.w && e.y + e.h <= r.y + r.h).map((e) => e.id)
}

export function moveEls(doc: Doc, ids: readonly string[], dx: number, dy: number): Doc {
  return {
    ...doc,
    elements: doc.elements.map((e) => (ids.includes(e.id) ? { ...e, x: round(doc.page, e.x + dx), y: round(doc.page, e.y + dy) } : e)),
  }
}

export function removeEls(doc: Doc, ids: readonly string[]): Doc {
  return { ...doc, elements: doc.elements.filter((e) => !ids.includes(e.id)) }
}

/**
 * 複製はまとまりのすぐ下に置く。お品書きでは「行を増やす」操作として使われるため。
 * 下に入らなければすぐ上、それも無理ならずらして重ねる。複製はそれぞれ元の要素の直後（1つ手前）に入る。
 */
export function duplicateEls(doc: Doc, ids: readonly string[]): { doc: Doc; ids: string[] } {
  const src = pick(doc, ids)
  if (src.length === 0) return { doc, ids: [] }
  const box = bboxOf(src)
  const offset = round(doc.page, Math.min(doc.page.width, doc.page.height) * 0.03)
  const [dx, dy] =
    box.y + box.h * 2 <= doc.page.height ? [0, box.h]
    : box.y - box.h >= 0 ? [0, -box.h]
    : [offset, offset]
  const newIds: string[] = []
  const elements = doc.elements.flatMap((e) => {
    if (!ids.includes(e.id)) return [e]
    const copy = { ...e, id: uid(), x: round(doc.page, e.x + dx), y: round(doc.page, e.y + dy) }
    newIds.push(copy.id)
    return [e, copy]
  })
  return { doc: { ...doc, elements }, ids: newIds }
}

export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** 複数なら選んだまとまりの外枠に、1つだけならページに揃える */
export function alignEls(doc: Doc, ids: readonly string[], to: Align): Doc {
  const els = pick(doc, ids)
  if (els.length === 0) return doc
  const frame = els.length === 1 ? { x: 0, y: 0, w: doc.page.width, h: doc.page.height } : bboxOf(els)
  const place = (e: El): { x?: number; y?: number } => {
    switch (to) {
      case 'left': return { x: frame.x }
      case 'hcenter': return { x: frame.x + (frame.w - e.w) / 2 }
      case 'right': return { x: frame.x + frame.w - e.w }
      case 'top': return { y: frame.y }
      case 'vcenter': return { y: frame.y + (frame.h - e.h) / 2 }
      case 'bottom': return { y: frame.y + frame.h - e.h }
    }
  }
  return {
    ...doc,
    elements: doc.elements.map((e) => {
      if (!ids.includes(e.id)) return e
      const p = place(e)
      return { ...e, x: round(doc.page, p.x ?? e.x), y: round(doc.page, p.y ?? e.y) }
    }),
  }
}

/** 両端の要素は動かさず、あいだの要素の間隔をそろえる（3つ以上のとき） */
export function distributeEls(doc: Doc, ids: readonly string[], axis: 'x' | 'y'): Doc {
  const els = pick(doc, ids)
  if (els.length < 3) return doc
  const pos = axis === 'x' ? 'x' : 'y'
  const len = axis === 'x' ? 'w' : 'h'
  const sorted = [...els].sort((a, b) => a[pos] - b[pos])
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const used = sorted.reduce((s, e) => s + e[len], 0)
  const gap = (last[pos] + last[len] - first[pos] - used) / (sorted.length - 1)
  const next = new Map<string, number>()
  let at = first[pos]
  for (const e of sorted) {
    next.set(e.id, at)
    at += e[len] + gap
  }
  next.set(last.id, last[pos])
  return { ...doc, elements: doc.elements.map((e) => (next.has(e.id) ? { ...e, [pos]: round(doc.page, next.get(e.id)!) } : e)) }
}
