import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from './components/Editor'
import Inspector from './components/Inspector'
import ItemsPanel from './components/ItemsPanel'
import * as db from './db'
import {
  TABS, duplicateEl, moveLayer, newImage, newRect, newText, removeEl, round, starterDoc, updateEl, uid,
  type Doc, type Tab,
} from './doc'
import type { Item } from './fields'
import { commitFrom, initHistory, push, redo, replace, undo, type History } from './history'
import { download, exportCardsPdf, exportPng, exportPopPdf, fileStamp } from './output'

type Docs = Record<Tab, History<Doc>>

/** 表紙の写真などをそのまま入れても重くなりすぎないよう、取り込む画像の上限を決めておく */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

export default function App() {
  const [docs, setDocs] = useState<Docs | null>(null)
  const [tab, setTab] = useState<Tab>('menu')
  const [items, setItems] = useState<Item[]>([])
  const [images, setImages] = useState<ReadonlyMap<string, ImageBitmap>>(new Map())
  const [selected, setSelected] = useState<Record<Tab, string | null>>({ menu: null, pop: null, card: null })
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; selectAll: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastEdit = useRef<{ key: string; at: number } | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    db.loadAll()
      .then(async (saved) => {
        const loaded = {
          menu: saved.docs.menu ?? starterDoc('menu'),
          pop: saved.docs.pop ?? starterDoc('pop'),
          card: saved.docs.card ?? starterDoc('card'),
        }
        setDocs({ menu: initHistory(loaded.menu), pop: initHistory(loaded.pop), card: initHistory(loaded.card) })
        // 削除した画像は元に戻せるよう保存したままにしているので、開き直した時点で使われていないものを片付ける
        const used = new Set(Object.values(loaded).flatMap((d) => d.elements.flatMap((e) => (e.kind === 'image' ? [e.imageId] : []))))
        for (const id of saved.images.keys()) {
          if (!used.has(id)) {
            saved.images.delete(id)
            void db.deleteImage(id).catch(() => {})
          }
        }
        const loadedItems = saved.items ?? []
        setItems(loadedItems)
        setPreviewId(loadedItems[0]?.id ?? null)
        const decoded = new Map<string, ImageBitmap>()
        await Promise.all(
          [...saved.images].map(async ([id, blob]) => {
            try {
              decoded.set(id, await createImageBitmap(blob))
            } catch {
              // 読めない画像はその要素だけ灰色で表示し、ほかは開けるようにする
            }
          }),
        )
        setImages(decoded)
      })
      .catch(() => {
        setError('保存データを読み込めませんでした。見本の状態で開いています（プライベートブラウズでは保存できません）')
        setDocs({ menu: initHistory(starterDoc('menu')), pop: initHistory(starterDoc('pop')), card: initHistory(starterDoc('card')) })
      })
  }, [])

  // 書き込みはまとめて少し遅らせる（ドラッグ中に毎フレーム保存しない）
  const menu = docs?.menu.present
  const pop = docs?.pop.present
  const card = docs?.card.present
  useEffect(() => {
    if (!menu || !pop || !card) return
    const timer = setTimeout(() => {
      Promise.all([db.saveDoc('menu', menu), db.saveDoc('pop', pop), db.saveDoc('card', card)]).catch(() => setError('保存に失敗しました'))
    }, 400)
    return () => clearTimeout(timer)
  }, [menu, pop, card])

  const updateItems = (next: Item[]) => {
    setItems(next)
    db.saveItems(next).catch(() => setError('品目の保存に失敗しました'))
  }

  const edit = useCallback(
    (fn: (h: History<Doc>) => History<Doc>) => setDocs((d) => (d ? { ...d, [tab]: fn(d[tab]) } : d)),
    [tab],
  )

  /** 同じ key の変更が1秒以内に続いたら、元に戻すを1手にまとめる */
  const commit = useCallback(
    (next: Doc, key?: string) => {
      const now = Date.now()
      const coalesce = !!key && lastEdit.current?.key === key && now - lastEdit.current.at < 1000
      lastEdit.current = key ? { key, at: now } : null
      edit((h) => push(h, next, coalesce))
    },
    [edit],
  )

  const select = (id: string | null) => setSelected((s) => ({ ...s, [tab]: id }))

  const doc = docs?.[tab].present
  const selectedId = selected[tab]
  const selectedEl = doc?.elements.find((e) => e.id === selectedId)

  const addAndSelect = (next: Doc, id: string) => {
    commit(next)
    select(id)
  }

  const addImage = async (file: File) => {
    if (!doc) return
    if (!file.type.startsWith('image/')) return setError('画像ファイルを選んでください')
    if (file.size > MAX_IMAGE_BYTES) return setError('画像が大きすぎます（20MB まで）')
    try {
      const bitmap = await createImageBitmap(file)
      const id = uid()
      await db.putImage(id, file)
      setImages((m) => new Map(m).set(id, bitmap))
      const el = newImage(doc.page, id, bitmap.width / bitmap.height)
      addAndSelect({ ...doc, elements: [...doc.elements, el] }, el.id)
    } catch {
      setError('この画像は読み込めませんでした')
    }
  }

  const deleteSelected = useCallback(() => {
    if (!doc || !selectedId) return
    commit(removeEl(doc, selectedId))
    setSelected((s) => ({ ...s, [tab]: null }))
  }, [doc, selectedId, commit, tab])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !docs) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        edit(e.shiftKey ? redo : undo)
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        edit(redo)
      } else if (!doc || !selectedId) {
        return
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        const r = duplicateEl(doc, selectedId)
        commit(r.doc)
        select(r.id)
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const el = doc.elements.find((x) => x.id === selectedId)!
        const step = (doc.page.unit === 'px' ? 1 : 0.5) * (e.shiftKey ? 10 : 1)
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        commit(updateEl(doc, selectedId, { x: round(doc.page, el.x + dx), y: round(doc.page, el.y + dy) }), `${selectedId}:nudge`)
      } else if (e.key === 'Enter') {
        // 選んでいるテキストを、その場で書き換え始める
        if (doc.elements.find((x) => x.id === selectedId)?.kind === 'text') {
          e.preventDefault()
          setEditing({ id: selectedId, selectAll: false })
        }
      } else if (e.key === 'Escape') {
        select(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const runExport = async () => {
    if (!docs) return
    setBusy(true)
    setError(null)
    try {
      // 書き出し中に表示が固まって見えないよう、ボタンの表示を先に描かせてから重い処理に入る
      await new Promise((r) => setTimeout(r, 30))
      const stamp = fileStamp()
      if (tab === 'menu') download(await exportPng(docs.menu.present, images), `oshinagaki-${stamp}.png`)
      if (tab === 'pop') download(await exportPopPdf(docs.pop.present, images), `pop-${stamp}.pdf`)
      if (tab === 'card') {
        if (items.length === 0) throw new Error('値札にする品目がありません。右の「品目」から追加してください')
        download(await exportCardsPdf(docs.card.present, items, images), `nefuda-${stamp}.pdf`)
      }
    } catch (e) {
      setError((e as Error).message || '書き出しに失敗しました')
    } finally {
      setBusy(false)
    }
  }

  if (!docs || !doc) return <div className="loading">読み込み中…</div>

  const tabInfo = TABS.find((t) => t.key === tab)!
  const h = docs[tab]
  const previewItem = tab === 'card' ? items.find((i) => i.id === previewId) : undefined

  return (
    <div className="app">
      <header>
        <h1>fuda</h1>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={t.key === tab} className={t.key === tab ? 'on' : ''} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <button type="button" onClick={() => edit(undo)} disabled={h.past.length === 0} title="元に戻す (Ctrl+Z)">元に戻す</button>
        <button type="button" onClick={() => edit(redo)} disabled={h.future.length === 0} title="やり直し (Ctrl+Shift+Z)">やり直し</button>
        <button type="button" className="primary" onClick={runExport} disabled={busy}>
          {busy ? '書き出し中…' : `${tabInfo.output}を書き出す`}
        </button>
      </header>

      {error && (
        <div className="banner" role="alert">
          {error}
          <button type="button" className="icon" aria-label="閉じる" onClick={() => setError(null)}>×</button>
        </div>
      )}

      <main>
        <aside className="tools" aria-label="要素を追加">
          <button
            type="button"
            onClick={() => {
              const el = newText(doc.page)
              addAndSelect({ ...doc, elements: [...doc.elements, el] }, el.id)
              setEditing({ id: el.id, selectAll: true })
            }}
          >
            テキスト
          </button>
          <button type="button" onClick={() => { const el = newRect(doc.page); addAndSelect({ ...doc, elements: [...doc.elements, el] }, el.id) }}>
            図形
          </button>
          <button type="button" onClick={() => imageInput.current!.click()}>画像</button>
          <input
            ref={imageInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void addImage(f)
            }}
          />
          {tab === 'card' && (
            <>
              <hr />
              <button type="button" onClick={() => { const el = newText(doc.page, '{{品名}}'); addAndSelect({ ...doc, elements: [...doc.elements, el] }, el.id) }}>
                品名欄
              </button>
              <button type="button" onClick={() => { const el = newText(doc.page, '{{価格}}円'); addAndSelect({ ...doc, elements: [...doc.elements, el] }, el.id) }}>
                価格欄
              </button>
            </>
          )}
        </aside>

        <Editor
          doc={doc}
          images={images}
          item={previewItem}
          selectedId={selectedId}
          onSelect={select}
          onPreview={(next) => edit((hh) => replace(hh, next))}
          onCommit={(base) => {
            lastEdit.current = null
            edit((hh) => commitFrom(hh, base))
          }}
          editing={editing}
          onEdit={setEditing}
        />

        <aside className="panel">
          {tab === 'card' && (
            <ItemsPanel card={doc} items={items} images={images} previewId={previewId} onPreview={setPreviewId} onItems={updateItems} />
          )}
          <Inspector
            tab={tab}
            doc={doc}
            selected={selectedEl}
            onDoc={commit}
            onDelete={deleteSelected}
            onDuplicate={() => {
              if (!selectedId) return
              const r = duplicateEl(doc, selectedId)
              addAndSelect(r.doc, r.id)
            }}
            onLayer={(dir) => selectedId && commit(moveLayer(doc, selectedId, dir))}
          />
        </aside>
      </main>
    </div>
  )
}
