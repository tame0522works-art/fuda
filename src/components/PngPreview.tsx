import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type PngExport = { blob: Blob; name: string; bitmap: ImageBitmap }

type Props = {
  png: PngExport
  onSave: () => void
  onClose: () => void
}

/** SNS をスマホで見たときのおおよその表示幅（CSS px）。多くのスマホの画面幅が 360〜430 */
const PHONE_WIDTH = 390

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`)

/**
 * 書き出した PNG を保存する前に見せる。描き直しではなく、保存されるファイルそのものを読み直して表示する。
 * 「スマホの画面幅」は、SNS に載せたときに文字が読める大きさかを確かめるため。
 */
export default function PngPreview({ png, onSave, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const [mode, setMode] = useState<'fit' | 'phone'>('fit')

  useLayoutEffect(() => {
    // showModal で開くと、背後の操作を止め、Esc で閉じ、フォーカスもダイアログの中に留まる
    dialogRef.current!.showModal()
    // 開いた直後は「保存する」にフォーカスを置き、Enter でそのまま保存できるようにする
    saveRef.current!.focus()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!
    canvas.width = png.bitmap.width
    canvas.height = png.bitmap.height
    canvas.getContext('2d')!.drawImage(png.bitmap, 0, 0)
  }, [png])

  const { width, height } = png.bitmap
  return (
    <dialog
      ref={dialogRef}
      className="png-preview"
      aria-label="書き出す画像の確認"
      // 閉じたことを知らせる close イベントだけに頼ると、届かなかったときに「開いている」扱いのまま残るので、
      // Esc（cancel）と「閉じる」ボタンでは直接 onClose を呼ぶ
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClose={onClose}
    >
      <header>
        <h2>書き出す画像の確認</h2>
        <span className="dim">{width}×{height} px ／ {kb(png.blob.size)}</span>
        <div className="spacer" />
        <div className="segment" role="radiogroup" aria-label="表示の大きさ">
          <button type="button" role="radio" aria-checked={mode === 'fit'} className={mode === 'fit' ? 'on' : ''} onClick={() => setMode('fit')}>
            全体
          </button>
          <button type="button" role="radio" aria-checked={mode === 'phone'} className={mode === 'phone' ? 'on' : ''} onClick={() => setMode('phone')}>
            スマホの画面幅
          </button>
        </div>
      </header>
      <div className={`png-preview-view ${mode}`}>
        <canvas ref={canvasRef} style={mode === 'phone' ? { width: PHONE_WIDTH } : undefined} />
      </div>
      {mode === 'phone' && <p className="dim">スマホで SNS を見たときのおおよその大きさ（幅 {PHONE_WIDTH}px）です。小さい文字が読めるか確かめてください。</p>}
      <footer>
        <button type="button" onClick={onClose}>閉じる</button>
        <button type="button" className="primary" ref={saveRef} onClick={onSave}>保存する</button>
      </footer>
    </dialog>
  )
}
