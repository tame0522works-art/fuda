import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { removeEl, round, updateEl, type Doc, type El } from '../doc'
import type { Item } from '../fields'
import { drawDoc, textOverflows, type Images } from '../render'
import { snapMove, snapResize, type Guide } from '../snap'
import TextEditBox from './TextEditBox'

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
  /** ドラッグや直接入力を終えたとき。base は始める前の状態 */
  onCommit: (base: Doc) => void
  /** 画面上で直接入力しているテキスト */
  editing: { id: string; selectAll: boolean } | null
  onEdit: (editing: { id: string; selectAll: boolean } | null) => void
  onDuplicate: () => void
  onDelete: () => void
  /** at はドロップした位置（用紙の単位） */
  onDropImages: (files: File[], at: { x: number; y: number }) => void
}

const PAD = 32
/** 画面上でこの距離（px）まで近づいたら吸着する。用紙の単位ではなく見た目の距離で決める */
const SNAP_PX = 6

export default function Editor({ doc, images, item, selectedId, onSelect, onPreview, onCommit, editing, onEdit, onDuplicate, onDelete, onDropImages }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })
  const [guides, setGuides] = useState<Guide[]>([])
  const [dropping, setDropping] = useState(false)
  // 子要素の上を通るたびに dragenter / dragleave が交互に来るので、出入りの回数で判定する
  const dragDepth = useRef(0)
  // 直接入力は何文字打っても「元に戻す」1回で入力前に戻るよう、始めた時点の状態を覚えておく
  const editBase = useRef<Doc | null>(null)
  const docRef = useRef(doc)
  docRef.current = doc
  useEffect(() => {
    editBase.current = editing ? docRef.current : null
  }, [editing])

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
    // 入力中の文字はキャンバスに描かず、重ねた入力欄だけに見せる（二重に見えないように）
    const shown = editing ? { ...doc, elements: doc.elements.filter((e) => e.id !== editing.id) } : doc
    drawDoc(canvas.getContext('2d')!, shown, scale * dpr, images, item)
  }, [doc, images, item, scale, cssW, cssH, area.w, editing])

  const finishEdit = () => {
    const base = editBase.current
    // blur と Esc が続けて来ても1回だけ確定する
    if (!base || !editing) return
    editBase.current = null
    const current = docRef.current
    const el = current.elements.find((e) => e.id === editing.id)
    onEdit(null)
    // 空にしたテキストは消す。元に戻せば入力前の文字ごと戻る
    if (el?.kind === 'text' && el.text.trim() === '') onPreview(removeEl(current, el.id))
    onCommit(base)
  }

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
    if (editing) {
      // 入力中に外をクリックしたら確定だけして、ドラッグは始めない
      finishEdit()
      return
    }
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
    const others = d.base.elements.filter((el) => el.id !== d.id)
    const threshold = SNAP_PX / scale
    // Alt を押している間は吸着を切る（細かく置きたいとき用）
    const snapped = e.altKey
      ? { box: { x, y, w, h }, guides: [] }
      : d.mode === 'move'
        ? snapMove({ x, y, w, h }, others, pg, threshold)
        : snapResize({ x, y, w, h }, d.mode, others, pg, threshold, min)
    setGuides(snapped.guides)
    const b = snapped.box
    const box = { x: round(pg, b.x), y: round(pg, b.y), w: round(pg, b.w), h: round(pg, b.h) }
    onPreview({ ...d.base, elements: d.base.elements.map((el) => (el.id === d.id ? { ...el, ...box } : el)) })
  }

  const onUp = () => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    setGuides([])
    onCommit(d.base)
  }

  const hitText = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect()
    const x = (e.clientX - r.left) / scale
    const y = (e.clientY - r.top) / scale
    return [...doc.elements].reverse().find((el) => x >= el.x && x <= el.x + el.w && y >= el.y && y <= el.y + el.h)
  }

  const selected = doc.elements.find((e) => e.id === selectedId)
  const editingEl = doc.elements.find((e) => e.id === editing?.id)
  const overflow = selected?.kind === 'text' && textOverflows(selected, item)

  return (
    <div
      className={dropping ? 'stage dropping' : 'stage'}
      ref={wrapRef}
      onPointerDown={() => onSelect(null)}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepth.current++
        setDropping(true)
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDropping(false)
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDropping(false)
        const files = [...e.dataTransfer.files]
        if (files.length === 0) return
        const r = canvasRef.current!.getBoundingClientRect()
        onDropImages(files, { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale })
      }}
    >
      {dropping && <div className="drop-note">ここに画像をドロップ</div>}
      <div
        className="paper"
        style={{ width: cssW, height: cssH }}
        onPointerDown={onStageDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={(e) => {
          const hit = hitText(e)
          if (hit?.kind === 'text') {
            onSelect(hit.id)
            onEdit({ id: hit.id, selectAll: false })
          }
        }}
      >
        <canvas ref={canvasRef} style={{ width: cssW, height: cssH }} />
        {guides.map((g) => (
          <div
            key={`${g.axis}${g.at}`}
            className={`guide ${g.axis}`}
            style={g.axis === 'x' ? { left: g.at * scale } : { top: g.at * scale }}
          />
        ))}
        {selected && !editingEl && (
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
            {/* よく使う操作は右のパネルまで探しに行かなくて済むよう、選んだ要素のそばに出す */}
            <div
              className={selected.y * scale < 40 ? 'quick-actions below' : 'quick-actions'}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button type="button" title="すぐ下に同じ書式で増やす (Ctrl+D)" onClick={onDuplicate}>複製</button>
              {selected.kind === 'text' && (
                <button type="button" title="文字を書き換える (Enter / ダブルクリック)" onClick={() => onEdit({ id: selected.id, selectAll: false })}>
                  編集
                </button>
              )}
              <button type="button" className="danger" title="削除 (Delete)" onClick={onDelete}>削除</button>
            </div>
          </div>
        )}
        {editing && editingEl?.kind === 'text' && (
          <TextEditBox
            key={editing.id}
            el={editingEl}
            scale={scale}
            selectAll={editing.selectAll}
            onChange={(text) => onPreview(updateEl(docRef.current, editingEl.id, { text }))}
            onFinish={finishEdit}
          />
        )}
      </div>
    </div>
  )
}
