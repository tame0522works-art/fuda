import { useState } from 'react'
import { FIELDS } from '../fields'
import { PRESETS, PT_IN_MM, applyPreset, presetIndexOf, resizePage, round, updateEl, type Doc, type El, type Tab } from '../doc'
import { isTouch } from '../device'
import type { Align } from '../group'
import { FONT_LIST, LOCAL_PREFIX, canListLocalFonts, fontLabel, fontStack, fontWeights, isFontAvailable, listLocalFonts, localFontKey } from '../fonts'

type Props = {
  tab: Tab
  doc: Doc
  selected: El | undefined
  /** key が同じ変更が続くあいだは、元に戻すを1手にまとめる */
  onDoc: (doc: Doc, key?: string) => void
  onDelete: () => void
  onDuplicate: () => void
  onLayer: (dir: 1 | -1) => void
  /** 選んでいる要素の数。2つ以上のときは個別の設定の代わりに揃え・等間隔を出す */
  selectionCount: number
  onAlign: (to: Align) => void
  onDistribute: (axis: 'x' | 'y') => void
}

export default function Inspector({ tab, doc, selected, onDoc, onDelete, onDuplicate, onLayer, selectionCount, onAlign, onDistribute }: Props) {
  const { page } = doc
  const presetIndex = presetIndexOf(tab, page)
  const unit = page.unit
  // PC の書体一覧は許可を取って読むものなので、ボタンを押したときだけ読み、この画面を開いている間だけ覚えておく
  const [localFonts, setLocalFonts] = useState<string[]>([])

  return (
    <div className="inspector">
      <section>
        <h2>用紙</h2>
        <label className="field">
          <span>大きさ</span>
          <select
            value={presetIndex}
            onChange={(e) => onDoc(resizePage(doc, applyPreset(page, PRESETS[tab][Number(e.target.value)].page)))}
          >
            {presetIndex < 0 && <option value={-1}>カスタム</option>}
            {PRESETS[tab].map((p, i) => (
              <option key={p.label} value={i}>{p.label}</option>
            ))}
          </select>
        </label>
        <div className="row">
          <button type="button" onClick={() => onDoc(resizePage(doc, { ...page, width: page.height, height: page.width }))}>
            縦横を入れ替える
          </button>
          <span className="dim">{page.width}×{page.height} {unit}</span>
        </div>
        <ColorField label="背景色" value={doc.background} onChange={(v) => onDoc({ ...doc, background: v }, 'background')} />
      </section>

      {selectionCount > 1 ? (
        <section>
          <h2>{selectionCount} 個を選択中</h2>
          <AlignButtons onAlign={onAlign} />
          <div className="row wrap">
            <button type="button" disabled={selectionCount < 3} onClick={() => onDistribute('y')} title="上下の端の要素は動かさず、あいだの間隔をそろえる">
              上下に等間隔
            </button>
            <button type="button" disabled={selectionCount < 3} onClick={() => onDistribute('x')} title="左右の端の要素は動かさず、あいだの間隔をそろえる">
              左右に等間隔
            </button>
          </div>
          <div className="row wrap">
            <button type="button" onClick={onDuplicate}>まとめて複製</button>
            <button type="button" className="danger" onClick={onDelete}>まとめて削除</button>
          </div>
          <p className="dim">
            {isTouch() ? '何もない所から指でなぞって囲むと選べます。' : 'Shift を押しながらクリックで追加・解除、何もない所からドラッグで囲んで選べます。'}
          </p>
        </section>
      ) : selected ? (
        <ElementFields key={selected.id} doc={doc} el={selected} onDoc={onDoc} tab={tab} localFonts={localFonts} onLocalFonts={setLocalFonts} />
      ) : (
        <section>
          <p className="dim">ページ上の要素を{isTouch() ? 'タップ' : 'クリック'}すると、ここで文字や色を変えられます。</p>
          <p className="dim">行を増やすときは、近い行を選んで「複製」を押すと、すぐ下に同じ書式の行ができます。</p>
          <p className="dim">
            {isTouch()
              ? 'まとめて動かすときは、ページの何もない所から指でなぞって囲みます。'
              : 'まとめて動かすときは、何もない所からドラッグして囲むか、Shift を押しながらクリックします。'}
          </p>
        </section>
      )}

      {selected && (
        <section>
          <h2>配置</h2>
          <span className="dim">ページに揃える</span>
          <AlignButtons onAlign={onAlign} />
          <div className="row wrap">
            <button type="button" onClick={() => onLayer(1)}>手前へ</button>
            <button type="button" onClick={() => onLayer(-1)}>奥へ</button>
            <button type="button" onClick={onDuplicate}>複製</button>
            <button type="button" className="danger" onClick={onDelete}>削除</button>
          </div>
          <div className="grid2">
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <Num
                key={k}
                label={{ x: '左', y: '上', w: '幅', h: '高さ' }[k]}
                suffix={unit}
                value={selected[k]}
                step={unit === 'px' ? 1 : 0.5}
                onChange={(v) => onDoc(updateEl(doc, selected.id, { [k]: round(page, v) }), `${selected.id}:${k}`)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

type FieldsProps = { doc: Doc; el: El; onDoc: Props['onDoc']; tab: Tab; localFonts: string[]; onLocalFonts: (fonts: string[]) => void }

function ElementFields({ doc, el, onDoc, tab, localFonts, onLocalFonts }: FieldsProps) {
  const set = (patch: Partial<El>, key: string) => onDoc(updateEl(doc, el.id, patch), `${el.id}:${key}`)
  const mm = doc.page.unit === 'mm'

  switch (el.kind) {
    case 'text':
      return (
        <section>
          <h2>テキスト</h2>
          <textarea rows={4} value={el.text} onChange={(e) => set({ text: e.target.value }, 'text')} />
          <ColorField label="文字色" value={el.color} onChange={(color) => set({ color }, 'color')} />
          <FontPicker
            value={el.font}
            localFonts={localFonts}
            onLocalFonts={onLocalFonts}
            onChange={(font) => {
              const weights = fontWeights(font)
              // 太字のない書体へ替えたら、太さもその書体にある太さへ合わせる
              set({ font, weight: weights.includes(el.weight) ? el.weight : weights[0] }, 'font')
            }}
          />
          {tab === 'card' && (
            <div className="row wrap">
              <span className="dim">差し込み:</span>
              {FIELDS.map((f) => (
                <button key={f} type="button" className="chip" onClick={() => set({ text: el.text + `{{${f}}}` }, 'field')}>
                  {`{{${f}}}`}
                </button>
              ))}
            </div>
          )}
          <div className="grid2">
            {/* 印刷物は文字の大きさを pt で考える人が多いので、mm のページでは pt で見せる */}
            <Num
              label="文字サイズ"
              suffix={mm ? 'pt' : 'px'}
              value={mm ? Math.round((el.size / PT_IN_MM) * 10) / 10 : el.size}
              step={mm ? 0.5 : 1}
              onChange={(v) => set({ size: mm ? Math.round(v * PT_IN_MM * 1000) / 1000 : Math.round(v) }, 'size')}
            />
            <Num label="行間" value={el.lineHeight} step={0.1} onChange={(v) => set({ lineHeight: Math.max(0.8, v) }, 'lineHeight')} />
          </div>
          <div className="row wrap">
            {fontWeights(el.font).length > 1 && (
              <Segment value={el.weight} options={[[400, '細'], [700, '太']]} onChange={(weight) => set({ weight }, 'weight')} />
            )}
            <Segment
              value={el.align}
              options={[['left', '左'], ['center', '中央'], ['right', '右']]}
              onChange={(align) => set({ align }, 'align')}
            />
          </div>
        </section>
      )
    case 'rect':
      return (
        <section>
          <h2>図形</h2>
          <ColorField label="塗り" value={el.fill} allowNone onChange={(fill) => set({ fill }, 'fill')} />
          <ColorField label="線" value={el.stroke} allowNone onChange={(stroke) => set({ stroke }, 'stroke')} />
          <div className="grid2">
            <Num label="線の太さ" suffix={doc.page.unit} value={el.strokeWidth} step={mm ? 0.1 : 1} onChange={(v) => set({ strokeWidth: Math.max(0, v) }, 'strokeWidth')} />
            <Num label="角の丸み" suffix={doc.page.unit} value={el.radius} step={mm ? 0.5 : 1} onChange={(v) => set({ radius: Math.max(0, v) }, 'radius')} />
          </div>
        </section>
      )
    case 'image':
      return (
        <section>
          <h2>画像</h2>
          <Segment
            value={el.fit}
            options={[['cover', '枠いっぱいに切り抜く'], ['contain', '全体を収める']]}
            onChange={(fit) => set({ fit }, 'fit')}
          />
        </section>
      )
  }
}

function Num({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="field">
      <span>{label}{suffix && <small> ({suffix})</small>}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const v = e.target.valueAsNumber
          if (Number.isFinite(v)) onChange(v)
        }}
      />
    </label>
  )
}

function ColorField({ label, value, onChange, allowNone }: { label: string; value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  const none = value === 'transparent'
  return (
    <div className="field color">
      <span>{label}</span>
      <input type="color" value={none ? '#ffffff' : value} disabled={none} onChange={(e) => onChange(e.target.value)} />
      {allowNone && (
        <label className="check">
          <input type="checkbox" checked={none} onChange={(e) => onChange(e.target.checked ? 'transparent' : '#1b2028')} />
          なし
        </label>
      )}
    </div>
  )
}

function Segment<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segment" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

function FontPicker({ value, onChange, localFonts, onLocalFonts }: {
  value: string; onChange: (key: string) => void; localFonts: string[]; onLocalFonts: (fonts: string[]) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const groups = [...new Set(FONT_LIST.map((f) => f.group))]
  const localKeys = localFonts.map(localFontKey)
  // 別の端末で PC の書体を選んだデザインを開いたときも、今の書体を一覧に出しておく
  const orphan = value.startsWith(LOCAL_PREFIX) && !localKeys.includes(value)

  const addLocal = async () => {
    try {
      const fonts = await listLocalFonts()
      if (fonts.length === 0) setError('PC の書体を読めませんでした。ブラウザの許可を確認してください')
      else {
        setError(null)
        onLocalFonts(fonts)
      }
    } catch {
      setError('PC の書体を読む許可がありませんでした')
    }
  }

  return (
    <div className="field">
      <span>書体</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {FONT_LIST.filter((f) => f.group === g).map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </optgroup>
        ))}
        {(localKeys.length > 0 || orphan) && (
          <optgroup label="この PC の書体">
            {orphan && <option value={value}>{fontLabel(value)}</option>}
            {localKeys.map((k) => (
              <option key={k} value={k}>{fontLabel(k)}</option>
            ))}
          </optgroup>
        )}
      </select>
      <p className="font-sample" style={{ fontFamily: fontStack(value) }}>お品書き 新刊 700円 Aa</p>
      {!isFontAvailable(value) && (
        <p className="msg error">この端末には「{fontLabel(value)}」がありません。代わりの書体で表示・書き出しされます。</p>
      )}
      {canListLocalFonts() && localFonts.length === 0 && (
        <button type="button" className="chip" onClick={addLocal}>この PC の書体を一覧に追加</button>
      )}
      {error && <p className="msg error">{error}</p>}
    </div>
  )
}

const ALIGNS: [Align, string, string][] = [
  ['left', '左', '左端をそろえる'],
  ['hcenter', '左右中央', '左右の中央をそろえる'],
  ['right', '右', '右端をそろえる'],
  ['top', '上', '上端をそろえる'],
  ['vcenter', '上下中央', '上下の中央をそろえる'],
  ['bottom', '下', '下端をそろえる'],
]

function AlignButtons({ onAlign }: { onAlign: (to: Align) => void }) {
  return (
    <div className="align-grid">
      {ALIGNS.map(([to, label, title]) => (
        <button key={to} type="button" title={title} onClick={() => onAlign(to)}>{label}</button>
      ))}
    </div>
  )
}
