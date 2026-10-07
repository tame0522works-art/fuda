import type { CardSteps as Steps } from '../steps'

type Props = {
  steps: Steps
  busy: boolean
  onAddItem: () => void
  onExport: () => void
}

const MARK = { done: '✓', warn: '!', todo: '' } as const

/** 値札タブの上に出す「① デザイン ② 品目 ③ 書き出す」。今どこまで済んでいて、次に何をするかを示す */
export default function CardSteps({ steps, busy, onAddItem, onExport }: Props) {
  return (
    <ol className="card-steps" aria-label="値札を作る手順">
      {steps.steps.map((s, i) => (
        <li key={s.key} className={[s.status, s.key === steps.current && 'current'].filter(Boolean).join(' ')} aria-current={s.key === steps.current ? 'step' : undefined}>
          <span className="step-no" aria-hidden="true">{MARK[s.status] || i + 1}</span>
          <span className="step-text">
            <strong>{s.label}</strong>
            <span className="dim">{s.detail}</span>
          </span>
          {s.key === 'items' && s.status === 'todo' && (
            <button type="button" className="primary" onClick={onAddItem}>品目を追加</button>
          )}
          {s.key === 'export' && steps.current === 'export' && (
            <button type="button" className="primary" onClick={onExport} disabled={busy}>{busy ? '書き出し中…' : '書き出す'}</button>
          )}
        </li>
      ))}
    </ol>
  )
}
