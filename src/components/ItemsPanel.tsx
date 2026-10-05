import { useEffect, useRef, useState } from 'react'
import { uid, type Doc } from '../doc'
import type { Item } from '../fields'
import { drawSheet, textOverflows, type Images } from '../render'
import { A4, layoutSheet, sheetCount } from '../sheet'
import { itemsFromTsuriBackup } from '../tsuri'

type Props = {
  card: Doc
  items: Item[]
  images: Images
  previewId: string | null
  onPreview: (id: string | null) => void
  onItems: (items: Item[]) => void
}

export default function ItemsPanel({ card, items, images, previewId, onPreview, onItems }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const layout = layoutSheet(card.page)

  const importFile = async (file: File) => {
    try {
      const next = itemsFromTsuriBackup(JSON.parse(await file.text()))
      if (items.length > 0 && !confirm(`今の品目 ${items.length} 件を、読み込んだ ${next.length} 件で置き換えます。よろしいですか？`)) return
      onItems(next)
      onPreview(next[0]?.id ?? null)
      setMessage({ kind: 'ok', text: `tsuri から ${next.length} 件を読み込みました` })
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof SyntaxError ? 'JSON として読めませんでした' : (e as Error).message })
    }
  }

  const update = (id: string, patch: Partial<Item>) => onItems(items.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  const overflows = (item: Item) => card.elements.some((el) => el.kind === 'text' && textOverflows(el, item))

  return (
    <section className="items">
      <h2>品目</h2>
      <div className="row wrap">
        <button type="button" onClick={() => fileRef.current!.click()}>tsuri から読み込む</button>
        <button type="button" onClick={() => onItems([...items, { id: uid(), name: '新しい品目', price: 500 }])}>品目を追加</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void importFile(f)
          }}
        />
      </div>
      {message && <p className={message.kind === 'error' ? 'msg error' : 'msg'}>{message.text}</p>}

      {items.length === 0 ? (
        <p className="dim">品目がまだありません。tsuri の「バックアップ（JSON）」を読み込むか、品目を追加してください。</p>
      ) : (
        <ul className="item-list">
          {items.map((it) => (
            <li key={it.id} className={it.id === previewId ? 'on' : ''}>
              <input
                type="radio"
                name="preview"
                aria-label={`${it.name} を見本に表示`}
                checked={it.id === previewId}
                onChange={() => onPreview(it.id)}
              />
              <input className="name" value={it.name} aria-label="品名" onChange={(e) => update(it.id, { name: e.target.value })} />
              <input
                className="price"
                type="number"
                min={0}
                value={it.price}
                aria-label="価格"
                onChange={(e) => Number.isFinite(e.target.valueAsNumber) && update(it.id, { price: Math.max(0, e.target.valueAsNumber) })}
              />
              <button type="button" className="icon" aria-label={`${it.name} を削除`} onClick={() => onItems(items.filter((x) => x.id !== it.id))}>×</button>
              {overflows(it) && <p className="warn">はみ出し: 枠に収まりません</p>}
            </li>
          ))}
        </ul>
      )}
      <label className="check">
        <input type="checkbox" checked={previewId === null} onChange={(e) => onPreview(e.target.checked ? null : (items[0]?.id ?? null))} />
        差し込み欄のまま表示する
      </label>

      <h2>A4 への面付け</h2>
      {layout ? (
        <>
          <p className="dim">
            1枚に {layout.cols}×{layout.rows} = {layout.perSheet} 面 ／ {sheetCount(items.length, layout)} 枚
          </p>
          <SheetPreview card={card} items={items} images={images} />
        </>
      ) : (
        <p className="msg error">この大きさの値札は A4 に入りません</p>
      )}
    </section>
  )
}

function SheetPreview({ card, items, images }: { card: Doc; items: Item[]; images: Images }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const cssW = 220
  const cssH = (cssW * A4.height) / A4.width
  useEffect(() => {
    const canvas = ref.current!
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    drawSheet(canvas.getContext('2d')!, card, items, 0, canvas.width / A4.width, images)
  }, [card, items, images, cssH])
  return <canvas ref={ref} className="sheet-preview" style={{ width: cssW, height: cssH }} aria-label="1枚目の面付けの見本" />
}
