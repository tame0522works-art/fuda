import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { round, type Doc, type El } from '../doc'
import type { Item } from '../fields'
import { drawDoc, textOverflows, type Images } from '../render'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

type Drag = {
  mode: 'move' | Handle
  id: string
  base: Doc
  start: { x: number; y: number }
  orig: { x: number; y: number; w: number; h: number }
}

type Props = {
  doc: Doc
  images: Images
  /** 値札で、差し込み欄の代わりに見せる品目 */
  item?: Item
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** ドラッグ中の途中経過（履歴に積まない） */
  onPreview: (doc: Doc) => void
  /** ドラッグを終えたとき。base はドラッグを始める前の状態 */
  onCommit: (base: Doc) => void
}

const PAD = 32

export default function Editor({ doc, images, item, selectedId, onSelect, onPreview, onCommit }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const el = wrapRef.current!
    const ro = new ResizeObserver(([entry]) => setArea({ w: entry.contentRect.width, h: entry.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 画面の1px あたりに何単位（px / mm）を描くか
  const scale = Math.max(0.01, Math.min((area.w - PAD * 2) / doc.page.width, (area.h - PAD * 2) / doc.page.height))
  const cssW = doc.page.width * scale
  const cssH = doc.page.height * scale

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || area.w === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    drawDoc(canvas.getContext('2d')!, doc, scale * dpr, images, item)
  }, [doc, images, item, scale, cssW, cssH, area.w])

  const toUnits = (e: PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }

  const begin = (e: PointerEvent, el: El, mode: Drag['mode']) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { mode, id: el.id, base: doc, start: toUnits(e), orig: { x: el.x, y: el.y, w: el.w, h: el.h } }
  }

  const onStageDown = (e: PointerEvent) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const p = toUnits(e)
    // 後ろの要素ほど手前に描いているので、後ろから当たり判定する
    const hit = [...doc.elements].reverse().find((el) => p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y && p.y <= el.y + el.h)
    onSelect(hit?.id ?? null)
    if (hit) begin(e, hit, 'move')
  }

  const onMove = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const p = toUnits(e)
    const dx = p.x - d.start.x
    const dy = p.y - d.start.y
    const min = Math.min(doc.page.width, doc.page.height) * 0.02
    let { x, y, w, h } = d.orig
    if (d.mode === 'move') {
      x += dx
      y += dy
    } else {
      if (d.mode.includes('e')) w = Math.max(min, d.orig.w + dx)
      if (d.mode.includes('s')) h = Math.max(min, d.orig.h + dy)
      if (d.mode.includes('w')) {
        w = Math.max(min, d.orig.w - dx)
        x = d.orig.x + d.orig.w - w
      }
      if (d.mode.includes('n')) {
        h = Math.max(min, d.orig.h - dy)
        y = d.orig.y + d.orig.h - h
      }
    }
    const pg = doc.page
    const box = { x: round(pg, x), y: round(pg, y), w: round(pg, w), h: round(pg, h) }
    onPreview({ ...d.base, elements: d.base.elements.map((el) => (el.id === d.id ? { ...el, ...box } : el)) })
  }

  const onUp = () => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    onCommit(d.base)
  }

  const selected = doc.elements.find((e) => e.id === selectedId)
  const overflow = selected?.kind === 'text' && textOverflows(selected, item)

  return (
    <div className="stage" ref={wrapRef} onPointerDown={() => onSelect(null)}>
      <div
        className="paper"
        style={{ width: cssW, height: cssH }}
        onPointerDown={onStageDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <canvas ref={canvasRef} style={{ width: cssW, height: cssH }} />
        {selected && (
          <div
            className={overflow ? 'selection overflow' : 'selection'}
            style={{ left: selected.x * scale, top: selected.y * scale, width: selected.w * scale, height: selected.h * scale }}
          >
            {HANDLES.map((hd) => (
              <div
                key={hd}
                className={`handle ${hd}`}
                onPointerDown={(e) => begin(e, selected, hd)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              />
            ))}
            {overflow && <div className="overflow-note">文字が枠からはみ出しています</div>}
          </div>
        )}
      </div>
    </div>
  )
}
