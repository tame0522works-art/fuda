import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { removeEl, round, updateEl, type Doc, type El } from '../doc'
import type { Item } from '../fields'
import { ensureFonts } from '../fonts'
import { drawDoc, textOverflows, textSpecs, type Images } from '../render'
import { bboxOf, hitTest, idsInside } from '../group'
import { snapMove, snapResize, type Box, type Guide } from '../snap'
import { isTouch } from '../device'
import TextEditBox from './TextEditBox'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

type Point = { x: number; y: number }

type Drag =
  | { mode: 'move'; ids: string[]; base: Doc; start: Point; group: Box; origs: Map<string, Box> }
  | { mode: Handle; id: string; base: Doc; start: Point; orig: Box }
  /** 何もない所からドラッグして囲む。additive は Shift / Ctrl を押して始めたときの、元の選択 */
  | { mode: 'marquee'; start: Point; additive: string[] }

type Props = {
  doc: Doc
  images: Images
  /** 値札で、差し込み欄の代わりに見せる品目 */
  item?: Item
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  /** ドラッグ中の途中経過（履歴に積まない） */
  onPreview: (doc: Doc) => void
  /** ドラッグや直接入力を終えたとき。base は始める前の状態 */
  onCommit: (base: Doc) => void
  /** 画面上で直接入力しているテキスト */
  editing: { id: string; selectAll: boolean } | null
  onEdit: (editing: { id: string; selectAll: boolean } | null) => void
  onDuplicate: () => void
  onDelete: () => void
  /** 選んでいる要素の色を変える（テキストは文字色、図形は塗り）。key は元に戻すを1手にまとめるための識別子 */
  onRecolor: (color: string, key: string) => void
  /** 書体が届くたびに増える。描き直しのきっかけに使う */
  fontTick: number
  /** at はドロップした位置（用紙の単位） */
  onDropImages: (files: File[], at: { x: number; y: number }) => void
}

const PAD = 32

const colorOf = (el: El) => (el.kind === 'text' ? el.color : el.kind === 'rect' ? el.fill : 'transparent')
/** 画面上でこの距離（px）まで近づいたら吸着する。用紙の単位ではなく見た目の距離で決める */
const SNAP_PX = 6
/** 枠線だけの図形を「線の上」とみなす幅（画面の px）。指は狙いがずれやすいので広げる */
const HIT_PX = isTouch() ? 14 : 6

export default function Editor({ doc, images, item, selectedIds, onSelect, onPreview, onCommit, editing, onEdit, onDuplicate, onDelete, onRecolor, onDropImages, fontTick }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })
  const [guides, setGuides] = useState<Guide[]>([])
  const [dropping, setDropping] = useState(false)
  const [marquee, setMarquee] = useState<Box | null>(null)
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
    // まだ届いていない書体があれば読み込みを始める。届いたら fontTick が変わって描き直される
    ensureFonts(textSpecs(doc, [item])).catch(() => {})
  }, [doc, images, item, scale, cssW, cssH, area.w, editing, fontTick])

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

  const capture = (e: PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const beginResize = (e: PointerEvent, el: El, mode: Handle) => {
    capture(e)
    dragRef.current = { mode, id: el.id, base: doc, start: toUnits(e), orig: { x: el.x, y: el.y, w: el.w, h: el.h } }
  }

  const beginMove = (e: PointerEvent, ids: string[]) => {
    capture(e)
    const els = doc.elements.filter((el) => ids.includes(el.id))
    dragRef.current = {
      mode: 'move', ids, base: doc, start: toUnits(e), group: bboxOf(els),
      origs: new Map(els.map((el) => [el.id, { x: el.x, y: el.y, w: el.w, h: el.h }])),
    }
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
    const hit = hitTest(doc, p, HIT_PX / scale)
    const toggle = e.shiftKey || e.ctrlKey || e.metaKey
    if (hit && toggle) {
      onSelect(selectedIds.includes(hit.id) ? selectedIds.filter((id) => id !== hit.id) : [...selectedIds, hit.id])
      return
    }
    if (hit) {
      // 選んでいるまとまりの1つをつかんだら、まとまりごと動かす
      const ids = selectedIds.includes(hit.id) ? selectedIds : [hit.id]
      onSelect(ids)
      beginMove(e, ids)
      return
    }
    capture(e)
    const additive = toggle ? selectedIds : []
    dragRef.current = { mode: 'marquee', start: p, additive }
    onSelect(additive)
    setMarquee({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const onMove = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const p = toUnits(e)
    const dx = p.x - d.start.x
    const dy = p.y - d.start.y
    const pg = doc.page
    const threshold = SNAP_PX / scale

    if (d.mode === 'marquee') {
      const r = { x: Math.min(p.x, d.start.x), y: Math.min(p.y, d.start.y), w: Math.abs(dx), h: Math.abs(dy) }
      setMarquee(r)
      onSelect([...new Set([...d.additive, ...idsInside(doc, r)])])
      return
    }

    if (d.mode === 'move') {
      // まとまりの外枠で吸着を判定し、同じだけ全員を動かす
      const others = d.base.elements.filter((el) => !d.ids.includes(el.id))
      const moved = { ...d.group, x: d.group.x + dx, y: d.group.y + dy }
      // Alt を押している間は吸着を切る（細かく置きたいとき用）
      const snapped = e.altKey ? { box: moved, guides: [] } : snapMove(moved, others, pg, threshold)
      setGuides(snapped.guides)
      const sx = snapped.box.x - d.group.x
      const sy = snapped.box.y - d.group.y
      onPreview({
        ...d.base,
        elements: d.base.elements.map((el) => {
          const o = d.origs.get(el.id)
          return o ? { ...el, x: round(pg, o.x + sx), y: round(pg, o.y + sy) } : el
        }),
      })
      return
    }

    const min = Math.min(pg.width, pg.height) * 0.02
    let { x, y, w, h } = d.orig
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
    const others = d.base.elements.filter((el) => el.id !== d.id)
    const snapped = e.altKey ? { box: { x, y, w, h }, guides: [] } : snapResize({ x, y, w, h }, d.mode, others, pg, threshold, min)
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
    if (d.mode === 'marquee') {
      setMarquee(null)
      return
    }
    onCommit(d.base)
  }

  const selectedEls = doc.elements.filter((e) => selectedIds.includes(e.id))
  const selected = selectedEls.length === 1 ? selectedEls[0] : undefined
  const group = selectedEls.length > 1 ? bboxOf(selectedEls) : undefined
  const editingEl = doc.elements.find((e) => e.id === editing?.id)
  const overflow = selected?.kind === 'text' && textOverflows(selected, item)
  const colorable = selectedEls.find((e) => e.kind !== 'image')

  // よく使う操作は右のパネルまで探しに行かなくて済むよう、選んだ要素（まとまり）のそばに出す
  const quickActions = (box: { x: number; y: number; w: number }) => (
    <div
      className={[
        'quick-actions',
        box.y * scale < 40 && 'below',
        // ページの左寄りにある要素では左端に揃え、ボタンがページの外（画面の外）へはみ出さないようにする
        box.x + box.w / 2 < doc.page.width / 2 && 'start',
      ].filter(Boolean).join(' ')}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {group && <span className="quick-count">{selectedEls.length} 個</span>}
      <button type="button" title="すぐ下に同じ書式で増やす (Ctrl+D)" onClick={onDuplicate}>複製</button>
      {selected?.kind === 'text' && (
        <button type="button" title="文字を書き換える (Enter / ダブルクリック)" onClick={() => onEdit({ id: selected.id, selectAll: false })}>
          編集
        </button>
      )}
      {colorable && (
        <label className="quick-color" title={group ? '文字の色・図形の塗り' : colorable.kind === 'text' ? '文字の色' : '塗りの色'}>
          <span className="chip-swatch" style={{ background: colorOf(colorable) }} />
          色
          <input
            type="color"
            value={colorOf(colorable) === 'transparent' ? '#ffffff' : colorOf(colorable)}
            onChange={(e) => onRecolor(e.target.value, `${selectedIds.join(',')}:color`)}
          />
        </label>
      )}
      <button type="button" className="danger" title="削除 (Delete)" onClick={onDelete}>削除</button>
    </div>
  )

  return (
    <div
      className={dropping ? 'stage dropping' : 'stage'}
      ref={wrapRef}
      onPointerDown={() => onSelect([])}
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
          const r = canvasRef.current!.getBoundingClientRect()
          const hit = hitTest(doc, { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }, HIT_PX / scale)
          if (hit?.kind === 'text') {
            onSelect([hit.id])
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
                onPointerDown={(e) => beginResize(e, selected, hd)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              />
            ))}
            {overflow && <div className="overflow-note">文字が枠からはみ出しています</div>}
            {quickActions(selected)}
          </div>
        )}
        {group && !editingEl && (
          <>
            {selectedEls.map((el) => (
              <div key={el.id} className="selection member" style={{ left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale }} />
            ))}
            <div className="selection group" style={{ left: group.x * scale, top: group.y * scale, width: group.w * scale, height: group.h * scale }}>
              {quickActions(group)}
            </div>
          </>
        )}
        {marquee && (
          <div className="marquee" style={{ left: marquee.x * scale, top: marquee.y * scale, width: marquee.w * scale, height: marquee.h * scale }} />
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
