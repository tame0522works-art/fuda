import { FIELDS } from '../fields'
import { FONTS, PRESETS, PT_IN_MM, resizePage, round, updateEl, type Doc, type El, type FontKey, type Tab } from '../doc'

type Props = {
  tab: Tab
  doc: Doc
  selected: El | undefined
  /** key が同じ変更が続くあいだは、元に戻すを1手にまとめる */
  onDoc: (doc: Doc, key?: string) => void
  onDelete: () => void
  onDuplicate: () => void
  onLayer: (dir: 1 | -1) => void
}

export default function Inspector({ tab, doc, selected, onDoc, onDelete, onDuplicate, onLayer }: Props) {
  const { page } = doc
  const presetIndex = PRESETS[tab].findIndex(
    (p) => (p.page.width === page.width && p.page.height === page.height) || (p.page.width === page.height && p.page.height === page.width),
  )
  const unit = page.unit

  return (
    <div className="inspector">
      <section>
        <h2>用紙</h2>
        <label className="field">
          <span>大きさ</span>
          <select
            value={presetIndex}
            onChange={(e) => {
              const preset = PRESETS[tab][Number(e.target.value)].page
              // 縦横を入れ替えて使っている場合は、向きを保ったまま大きさだけ変える
              const landscape = page.width > page.height !== preset.width > preset.height
              onDoc(resizePage(doc, landscape ? { ...preset, width: preset.height, height: preset.width } : preset))
            }}
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

      {selected ? (
        <ElementFields key={selected.id} doc={doc} el={selected} onDoc={onDoc} tab={tab} />
      ) : (
        <section>
          <p className="dim">ページ上の要素をクリックすると、ここで文字や色を変えられます。</p>
        </section>
      )}

      {selected && (
        <section>
          <h2>配置</h2>
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

function ElementFields({ doc, el, onDoc, tab }: { doc: Doc; el: El; onDoc: Props['onDoc']; tab: Tab }) {
  const set = (patch: Partial<El>, key: string) => onDoc(updateEl(doc, el.id, patch), `${el.id}:${key}`)
  const mm = doc.page.unit === 'mm'

  switch (el.kind) {
    case 'text':
      return (
        <section>
          <h2>テキスト</h2>
          <textarea rows={4} value={el.text} onChange={(e) => set({ text: e.target.value }, 'text')} />
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
            <Segment
              value={el.font}
              options={Object.entries(FONTS).map(([k, f]) => [k as FontKey, f.label])}
              onChange={(font) => set({ font }, 'font')}
            />
            <Segment value={el.weight} options={[[400, '細'], [700, '太']]} onChange={(weight) => set({ weight }, 'weight')} />
          </div>
          <Segment
            value={el.align}
            options={[['left', '左'], ['center', '中央'], ['right', '右']]}
            onChange={(align) => set({ align }, 'align')}
          />
          <ColorField label="文字色" value={el.color} onChange={(color) => set({ color }, 'color')} />
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
