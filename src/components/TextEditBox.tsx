import { useLayoutEffect, useRef } from 'react'
import { FONTS, type TextEl } from '../doc'

type Props = {
  el: TextEl
  /** 画面の1px あたりの用紙の単位 */
  scale: number
  /** 新しく置いたテキストは全選択して、そのまま打ち替えられるようにする */
  selectAll: boolean
  onChange: (text: string) => void
  onFinish: () => void
}

/**
 * キャンバスに描いた文字の真上に、同じ位置・大きさ・書体の入力欄を重ねる。
 * 入力中だけはブラウザの折り返しで表示し、確定するとキャンバス側の禁則付きの折り返しに戻る。
 */
export default function TextEditBox({ el, scale, selectAll, onChange, onFinish }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const ta = ref.current!
    ta.focus()
    if (selectAll) ta.select()
    else ta.setSelectionRange(ta.value.length, ta.value.length)
    // 開いた瞬間だけ実行する（入力のたびにカーソルを末尾へ飛ばさないように）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 枠より長く打っても隠れないよう、入力欄の高さだけは中身に合わせて伸ばす
  useLayoutEffect(() => {
    const ta = ref.current!
    ta.style.height = 'auto'
    ta.style.height = `${Math.max(el.h * scale, ta.scrollHeight)}px`
  }, [el.text, el.h, el.size, el.lineHeight, scale])

  return (
    <textarea
      ref={ref}
      className="text-edit"
      aria-label="テキストを編集"
      value={el.text}
      spellCheck={false}
      style={{
        left: el.x * scale,
        top: el.y * scale,
        width: el.w * scale,
        font: `${el.weight} ${el.size * scale}px ${FONTS[el.font].css}`,
        lineHeight: el.lineHeight,
        textAlign: el.align,
        color: el.color,
      }}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onFinish}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Esc と Ctrl+Enter で確定。Enter だけなら改行
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          onFinish()
        }
      }}
    />
  )
}
