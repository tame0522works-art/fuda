import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from './components/Editor'
import Inspector from './components/Inspector'
import ItemsPanel from './components/ItemsPanel'
import PngPreview, { type PngExport } from './components/PngPreview'
import * as db from './db'
import {
  TABS, moveLayer, newImage, newRect, newText, starterDoc, uid,
  type Doc, type ImageEl, type Tab,
} from './doc'
import type { Item } from './fields'
import { commitFrom, initHistory, push, redo, replace, undo, type History } from './history'
import { isBackupError, parseBackup, toBackup } from './backup'
import { missingFonts } from './fonts'
import { alignEls, distributeEls, duplicateEls, moveEls, removeEls } from './group'
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
  const [selected, setSelected] = useState<Record<Tab, string[]>>({ menu: [], pop: [], card: [] })
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; selectAll: boolean } | null>(null)
  // 同梱フォントは使う文字の分だけ後から届くので、届くたびに描き直す
  const [fontTick, setFontTick] = useState(0)
  useEffect(() => {
    const onLoaded = () => setFontTick((t) => t + 1)
    document.fonts.addEventListener('loadingdone', onLoaded)
    return () => document.fonts.removeEventListener('loadingdone', onLoaded)
  }, [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pngPreview, setPngPreview] = useState<PngExport | null>(null)
  const lastEdit = useRef<{ key: string; at: number } | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)

  /** 保存データやバックアップの中身を画面に反映する。元に戻すの履歴と選択はここで初めからにする */
  const applySaved = useCallback(async (saved: db.Saved) => {
    const loaded = {
      menu: saved.docs.menu ?? starterDoc('menu'),
      pop: saved.docs.pop ?? starterDoc('pop'),
      card: saved.docs.card ?? starterDoc('card'),
    }
    setDocs({ menu: initHistory(loaded.menu), pop: initHistory(loaded.pop), card: initHistory(loaded.card) })
    setSelected({ menu: [], pop: [], card: [] })
    setEditing(null)
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
  }, [])

  useEffect(() => {
    db.loadAll()
      .then(applySaved)
      .catch(() => {
        setError('保存データを読み込めませんでした。見本の状態で開いています（プライベートブラウズでは保存できません）')
        setDocs({ menu: initHistory(starterDoc('menu')), pop: initHistory(starterDoc('pop')), card: initHistory(starterDoc('card')) })
      })
    // 容量が足りなくなったとき、ブラウザがこのサイトのデータを自動で消さないよう頼む（認められるかはブラウザ次第）
    navigator.storage?.persist?.().catch(() => {})
  }, [applySaved])

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

  const select = (ids: string[]) => setSelected((s) => ({ ...s, [tab]: ids }))

  const doc = docs?.[tab].present
  // 元に戻すで消えた要素が選択に残らないよう、今あるものだけにしぼる
  const selectedIds = doc ? selected[tab].filter((id) => doc.elements.some((e) => e.id === id)) : []
  const selectedEl = selectedIds.length === 1 ? doc?.elements.find((e) => e.id === selectedIds[0]) : undefined

  const addAndSelect = (next: Doc, ids: string[]) => {
    commit(next)
    select(ids)
  }

  /** 複数まとめてドロップされても1手で元に戻せるよう、全部読み込んでから1回だけ反映する */
  const addImages = async (files: File[], center?: { x: number; y: number }) => {
    if (!doc) return
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return setError('画像ファイルを選んでください')
    const problems: string[] = []
    if (images.length < files.length) problems.push('画像以外のファイルは入れませんでした')
    const added: ImageEl[] = []
    const step = Math.min(doc.page.width, doc.page.height) * 0.04
    for (const file of images) {
      if (file.size > MAX_IMAGE_BYTES) {
        problems.push(`${file.name} は大きすぎます（20MB まで）`)
        continue
      }
      try {
        const bitmap = await createImageBitmap(file)
        const id = uid()
        await db.putImage(id, file)
        setImages((m) => new Map(m).set(id, bitmap))
        const at = center && { x: center.x + step * added.length, y: center.y + step * added.length }
        added.push(newImage(doc.page, id, bitmap.width / bitmap.height, at))
      } catch {
        problems.push(`${file.name} は読み込めませんでした`)
      }
    }
    setError(problems.length ? problems.join(' ／ ') : null)
    if (added.length) addAndSelect({ ...doc, elements: [...doc.elements, ...added] }, added.map((e) => e.id))
  }

  // ページの外に画像を落としたとき、ブラウザがその画像を開いてアプリから離れてしまわないようにする
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  const deleteSelected = () => {
    if (!doc || selectedIds.length === 0) return
    commit(removeEls(doc, selectedIds))
    select([])
  }

  const duplicateSelected = () => {
    if (!doc || selectedIds.length === 0) return
    const r = duplicateEls(doc, selectedIds)
    commit(r.doc)
    select(r.ids)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 確認画面が開いている間は、裏のページを操作しない
      if (isTyping(e.target) || !docs || pngPreview) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        edit(e.shiftKey ? redo : undo)
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        edit(redo)
      } else if (!doc) {
        return
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        select(doc.elements.map((x) => x.id))
      } else if (selectedIds.length === 0) {
        return
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateSelected()
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = (doc.page.unit === 'px' ? 1 : 0.5) * (e.shiftKey ? 10 : 1)
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        commit(moveEls(doc, selectedIds, dx, dy), `${selectedIds.join(',')}:nudge`)
      } else if (e.key === 'Enter') {
        // 選んでいるテキストを、その場で書き換え始める
        if (selectedEl?.kind === 'text') {
          e.preventDefault()
          setEditing({ id: selectedEl.id, selectAll: false })
        }
      } else if (e.key === 'Escape') {
        select([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // 別の PC で PC の書体を選んだデザインを開いたとき、黙って代わりの書体にならないよう知らせる
  const missing = doc ? missingFonts(doc.elements.flatMap((e) => (e.kind === 'text' ? [e.font] : []))) : []

  const runExport = async () => {
    if (!docs) return
    if (missing.length > 0 && !confirm(`この端末には${missing.map((m) => `「${m}」`).join('')}がないため、代わりの書体で書き出されます。書き出しますか？`)) return
    setBusy(true)
    setError(null)
    try {
      // 書き出し中に表示が固まって見えないよう、ボタンの表示を先に描かせてから重い処理に入る
      await new Promise((r) => setTimeout(r, 30))
      const stamp = fileStamp()
      if (tab === 'menu') {
        // PNG は保存する前に確認画面を出す。確認した画像をそのまま保存するので、ここで作ったものを持っておく
        const blob = await exportPng(docs.menu.present, images)
        setPngPreview({ blob, name: `oshinagaki-${stamp}.png`, bitmap: await createImageBitmap(blob) })
      }
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

  const saveBackup = async () => {
    if (!docs) return
    try {
      const present = { menu: docs.menu.present, pop: docs.pop.present, card: docs.card.present }
      const backup = await toBackup(present, items, await db.allImages())
      download(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `fuda-backup-${fileStamp()}.json`)
      setNotice(`バックアップを書き出しました（画像 ${Object.keys(backup.images).length} 枚を含む）`)
    } catch {
      setError('バックアップを書き出せませんでした')
    }
  }

  const restoreBackup = async (file: File) => {
    try {
      const restored = parseBackup(JSON.parse(await file.text()))
      if (!confirm('今のお品書き・ポップ・値札と品目を、バックアップの内容で置き換えます。よろしいですか？')) return
      await db.replaceAll(restored.docs, restored.items, restored.images)
      await applySaved({ docs: restored.docs, items: restored.items, images: new Map(restored.images) })
      setError(null)
      setNotice(`バックアップから戻しました（画像 ${restored.images.size} 枚）`)
    } catch (e) {
      setError(isBackupError(e) ? e.message : e instanceof SyntaxError ? 'JSON として読めませんでした' : '復元できませんでした')
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
        <button type="button" onClick={saveBackup} title="3つのデザイン・品目・画像を1つのファイルに保存する（別の端末へ移すときにも）">
          バックアップ
        </button>
        <button type="button" onClick={() => backupInput.current!.click()} title="バックアップのファイルから戻す">復元</button>
        <input
          ref={backupInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void restoreBackup(f)
          }}
        />
        <button type="button" onClick={() => edit(undo)} disabled={h.past.length === 0} title="元に戻す (Ctrl+Z)">元に戻す</button>
        <button type="button" onClick={() => edit(redo)} disabled={h.future.length === 0} title="やり直し (Ctrl+Shift+Z)">やり直し</button>
        <button type="button" className="primary" onClick={runExport} disabled={busy}>
          {busy ? '書き出し中…' : `${tabInfo.output}を書き出す`}
        </button>
      </header>

      {missing.length > 0 && (
        <div className="banner" role="status">
          この端末にない書体を使っています: {missing.map((m) => `「${m}」`).join('')}。代わりの書体で表示・書き出しされます（作った PC で開けば元の書体に戻ります）。
        </div>
      )}
      {notice && !error && (
        <div className="banner ok" role="status">
          {notice}
          <button type="button" className="icon" aria-label="閉じる" onClick={() => setNotice(null)}>×</button>
        </div>
      )}
      {error && (
        <div className="banner" role="alert">
          {error}
          <button type="button" className="icon" aria-label="閉じる" onClick={() => setError(null)}>×</button>
        </div>
      )}

      {pngPreview && (
        <PngPreview
          png={pngPreview}
          onSave={() => {
            download(pngPreview.blob, pngPreview.name)
            setPngPreview(null)
            setNotice(`${pngPreview.name} を保存しました`)
          }}
          onClose={() => setPngPreview(null)}
        />
      )}

      <main>
        <aside className="tools" aria-label="要素を追加">
          <button
            type="button"
            onClick={() => {
              const el = newText(doc.page)
              addAndSelect({ ...doc, elements: [...doc.elements, el] }, [el.id])
              setEditing({ id: el.id, selectAll: true })
            }}
          >
            テキスト
          </button>
          <button type="button" onClick={() => { const el = newRect(doc.page); addAndSelect({ ...doc, elements: [...doc.elements, el] }, [el.id]) }}>
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
              if (f) void addImages([f])
            }}
          />
          <p className="tool-hint">ページへドラッグでも入れられます</p>
          {tab === 'card' && (
            <>
              <hr />
              <button type="button" onClick={() => { const el = newText(doc.page, '{{品名}}'); addAndSelect({ ...doc, elements: [...doc.elements, el] }, [el.id]) }}>
                品名欄
              </button>
              <button type="button" onClick={() => { const el = newText(doc.page, '{{価格}}円'); addAndSelect({ ...doc, elements: [...doc.elements, el] }, [el.id]) }}>
                価格欄
              </button>
            </>
          )}
        </aside>

        <Editor
          doc={doc}
          images={images}
          item={previewItem}
          selectedIds={selectedIds}
          onSelect={select}
          onPreview={(next) => edit((hh) => replace(hh, next))}
          onCommit={(base) => {
            lastEdit.current = null
            edit((hh) => commitFrom(hh, base))
          }}
          editing={editing}
          onEdit={setEditing}
          onDuplicate={duplicateSelected}
          onDelete={deleteSelected}
          onDropImages={(files, at) => void addImages(files, at)}
          onRecolor={(color, key) =>
            commit(
              {
                ...doc,
                elements: doc.elements.map((e) =>
                  !selectedIds.includes(e.id) ? e : e.kind === 'text' ? { ...e, color } : e.kind === 'rect' ? { ...e, fill: color } : e,
                ),
              },
              key,
            )
          }
          fontTick={fontTick}
        />

        <aside className="panel">
          {tab === 'card' && (
            <ItemsPanel card={doc} items={items} images={images} previewId={previewId} onPreview={setPreviewId} onItems={updateItems} fontTick={fontTick} />
          )}
          <Inspector
            tab={tab}
            doc={doc}
            selected={selectedEl}
            onDoc={commit}
            onDelete={deleteSelected}
            onDuplicate={duplicateSelected}
            onLayer={(dir) => selectedEl && commit(moveLayer(doc, selectedEl.id, dir))}
            selectionCount={selectedIds.length}
            onAlign={(to) => commit(alignEls(doc, selectedIds, to))}
            onDistribute={(axis) => commit(distributeEls(doc, selectedIds, axis))}
          />
        </aside>
      </main>
    </div>
  )
}
