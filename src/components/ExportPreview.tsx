import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PreviewPage } from '../output'

export type ExportPreviewData =
  | { kind: 'png'; blob: Blob; name: string; bitmap: ImageBitmap }
  | { kind: 'pdf'; blob: Blob; name: string; pages: PreviewPage[] }

type Props = {
  data: ExportPreviewData
  onSave: () => void
  onClose: () => void
}

/** SNS をスマホで見たときのおおよその表示幅（CSS px）。多くのスマホの画面幅が 360〜430 */
const PHONE_WIDTH = 390
/** CSS の 1px は 1/96 インチと決まっているので、mm をこの倍率で px にすると、画面上でおおよそ実寸になる */
const CSS_PX_PER_MM = 96 / 25.4

/** ページ画像は大きいので、確認画面を閉じたら手放す（閉じる側で呼ぶ） */
export function releasePreview(data: ExportPreviewData) {
  if (data.kind === 'png') data.bitmap.close()
  else data.pages.forEach((p) => p.bitmap.close())
}

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`)

/**
 * 書き出す前の確認画面。
 * PNG は保存されるファイルそのものを読み直して表示する。PDF は埋め込む画像（JPEG にしたページは圧縮後のもの）を縮めて表示する。
 * PNG は「スマホの画面幅」、PDF は「印刷したときの大きさ」に切り替えて、文字が読める大きさかを確かめられる。
 */
export default function ExportPreview({ data, onSave, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const [zoom, setZoom] = useState<'fit' | 'real'>('fit')

  useLayoutEffect(() => {
    // showModal で開くと、背後の操作を止め、フォーカスもダイアログの中に留まる
    dialogRef.current!.showModal()
    // 開いた直後は「保存する」にフォーカスを置き、Enter でそのまま保存できるようにする
    saveRef.current!.focus()
  }, [])

  const realLabel = data.kind === 'png' ? 'スマホの画面幅' : '印刷したときの大きさ'
  const info =
    data.kind === 'png'
      ? `${data.bitmap.width}×${data.bitmap.height} px ／ ${kb(data.blob.size)}`
      : `${data.pages[0].widthMm}×${data.pages[0].heightMm} mm × ${data.pages.length}ページ ／ ${kb(data.blob.size)} ／ 300dpi`

  return (
    <dialog
      ref={dialogRef}
      className="export-preview"
      aria-label="書き出す内容の確認"
      // 閉じたことを知らせる close イベントだけに頼ると、届かなかったときに「開いている」扱いのまま残るので、
      // Esc（cancel）と「閉じる」ボタンでは直接 onClose を呼ぶ
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClose={onClose}
    >
      <header>
        <h2>書き出す内容の確認</h2>
        <span className="dim">{info}</span>
        <div className="spacer" />
        <div className="segment" role="radiogroup" aria-label="表示の大きさ">
          <button type="button" role="radio" aria-checked={zoom === 'fit'} className={zoom === 'fit' ? 'on' : ''} onClick={() => setZoom('fit')}>
            全体
          </button>
          <button type="button" role="radio" aria-checked={zoom === 'real'} className={zoom === 'real' ? 'on' : ''} onClick={() => setZoom('real')}>
            {realLabel}
          </button>
        </div>
      </header>
      <div className={`export-preview-view ${zoom}`}>
        {data.kind === 'png' ? (
          <PageCanvas bitmap={data.bitmap} width={zoom === 'real' ? PHONE_WIDTH : undefined} />
        ) : (
          data.pages.map((p, i) => (
            <figure key={i}>
              <PageCanvas bitmap={p.bitmap} width={zoom === 'real' ? p.widthMm * CSS_PX_PER_MM : undefined} />
              <figcaption className="dim">
                {i + 1} / {data.pages.length} ページ ・ {p.encoding === 'jpeg' ? 'JPEG（写真を含むため小さく圧縮）' : '劣化なし'}
              </figcaption>
            </figure>
          ))
        )}
      </div>
      {zoom === 'real' && (
        <p className="dim">
          {data.kind === 'png'
            ? `スマホで SNS を見たときのおおよその大きさ（幅 ${PHONE_WIDTH}px）です。小さい文字が読めるか確かめてください。`
            : '画面上でおおよそ実寸の大きさです（画面によって多少ずれます）。印刷して読める文字の大きさか確かめてください。'}
        </p>
      )}
      <footer>
        <button type="button" onClick={onClose}>閉じる</button>
        <button type="button" className="primary" ref={saveRef} onClick={onSave}>保存する</button>
      </footer>
    </dialog>
  )
}

function PageCanvas({ bitmap, width }: { bitmap: ImageBitmap; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  }, [bitmap])
  return <canvas ref={ref} style={width ? { width } : undefined} />
}
