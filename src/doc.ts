/**
 * お品書き・ポップ・値札は、すべて同じ「1枚のページに要素を自由に置いたもの」として扱う。
 * 違いは用紙の大きさと単位（画像は px、印刷物は mm）と書き出し方だけ。
 */

export type Unit = 'px' | 'mm'

export type Page = { width: number; height: number; unit: Unit }

type Box = { id: string; x: number; y: number; w: number; h: number }

export type TextEl = Box & {
  kind: 'text'
  text: string
  /** ページと同じ単位。mm のページでは画面上で pt に換算して見せる */
  size: number
  color: string
  weight: 400 | 700
  align: 'left' | 'center' | 'right'
  /** 書体のキー。fonts.ts の FONT_LIST か 'local:<名前>' */
  font: string
  lineHeight: number
}

export type RectEl = Box & {
  kind: 'rect'
  fill: string
  stroke: string
  strokeWidth: number
  radius: number
}

export type ImageEl = Box & {
  kind: 'image'
  imageId: string
  fit: 'cover' | 'contain'
}

export type El = TextEl | RectEl | ImageEl

export type Doc = { page: Page; background: string; elements: El[] }

export type Tab = 'menu' | 'pop' | 'card'

export const TABS: { key: Tab; label: string; output: string }[] = [
  { key: 'menu', label: 'お品書き', output: 'PNG 画像' },
  { key: 'pop', label: 'ポップ', output: '印刷用 PDF' },
  { key: 'card', label: '値札', output: 'A4 に面付けした PDF' },
]

export const PT_IN_MM = 25.4 / 72

export type PagePreset = { label: string; page: Page }

export const PRESETS: Record<Tab, PagePreset[]> = {
  menu: [
    { label: '縦長 4:5（1080×1350）', page: { width: 1080, height: 1350, unit: 'px' } },
    { label: '正方形（1080×1080）', page: { width: 1080, height: 1080, unit: 'px' } },
    { label: '横長 16:9（1600×900）', page: { width: 1600, height: 900, unit: 'px' } },
  ],
  pop: [
    { label: 'A4（210×297）', page: { width: 210, height: 297, unit: 'mm' } },
    { label: 'B5（182×257）', page: { width: 182, height: 257, unit: 'mm' } },
    { label: 'A5（148×210）', page: { width: 148, height: 210, unit: 'mm' } },
    { label: 'B6（128×182）', page: { width: 128, height: 182, unit: 'mm' } },
  ],
  card: [
    { label: '名刺 横（91×55）', page: { width: 91, height: 55, unit: 'mm' } },
    { label: '名刺 縦（55×91）', page: { width: 55, height: 91, unit: 'mm' } },
    { label: 'A8（74×52）', page: { width: 74, height: 52, unit: 'mm' } },
  ],
}

export const uid = () => crypto.randomUUID()

/** 新しく置く要素の初期サイズ。ページの大きさに比例させ、px でも mm でも同じ見た目で出す */
export function newText(page: Page, text = 'テキスト'): TextEl {
  const size = round(page, Math.min(page.width, page.height) * 0.08)
  return {
    id: uid(), kind: 'text', text, size, color: '#1b2028', weight: 700, align: 'center', font: 'gothic', lineHeight: 1.4,
    x: round(page, page.width * 0.15), y: round(page, page.height * 0.4),
    w: round(page, page.width * 0.7), h: round(page, size * 1.6),
  }
}

export function newRect(page: Page): RectEl {
  return {
    id: uid(), kind: 'rect', fill: '#f0c674', stroke: 'transparent', strokeWidth: 0,
    radius: round(page, Math.min(page.width, page.height) * 0.03),
    x: round(page, page.width * 0.25), y: round(page, page.height * 0.25),
    w: round(page, page.width * 0.5), h: round(page, page.height * 0.2),
  }
}

/** center を渡すとその点を中心に置く（ドロップした位置）。ページからはみ出す分は内側へ寄せる */
export function newImage(page: Page, imageId: string, aspect: number, center?: { x: number; y: number }): ImageEl {
  let w = page.width * 0.6
  let h = w / aspect
  if (h > page.height * 0.6) {
    h = page.height * 0.6
    w = h * aspect
  }
  const cx = center?.x ?? page.width / 2
  const cy = center?.y ?? page.height / 2
  const x = Math.min(Math.max(cx - w / 2, 0), page.width - w)
  const y = Math.min(Math.max(cy - h / 2, 0), page.height - h)
  return { id: uid(), kind: 'image', imageId, fit: 'cover', x: round(page, x), y: round(page, y), w: round(page, w), h: round(page, h) }
}

/** px は整数、mm は 0.1mm 刻みに丸める（ドラッグ中に数値が細かくなりすぎないように） */
export function round(page: Page, v: number): number {
  return page.unit === 'px' ? Math.round(v) : Math.round(v * 10) / 10
}

/** 用紙を変えたとき、配置が崩れないよう全要素を新しい用紙に合わせて伸縮する */
export function resizePage(doc: Doc, page: Page): Doc {
  const sx = page.width / doc.page.width
  const sy = page.height / doc.page.height
  const s = Math.min(sx, sy)
  const elements = doc.elements.map((e): El => {
    const box = { x: round(page, e.x * sx), y: round(page, e.y * sy), w: round(page, e.w * sx), h: round(page, e.h * sy) }
    switch (e.kind) {
      case 'text':
        return { ...e, ...box, size: round(page, e.size * s) }
      case 'rect':
        return { ...e, ...box, radius: round(page, e.radius * s), strokeWidth: round(page, e.strokeWidth * s) }
      case 'image':
        return { ...e, ...box }
    }
  })
  return { ...doc, page, elements }
}

export function updateEl(doc: Doc, id: string, patch: Partial<El>): Doc {
  return { ...doc, elements: doc.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as El) : e)) }
}

export function removeEl(doc: Doc, id: string): Doc {
  return { ...doc, elements: doc.elements.filter((e) => e.id !== id) }
}

/** 配列の後ろほど手前に描く。dir=1 で1つ手前、-1 で1つ奥へ */
export function moveLayer(doc: Doc, id: string, dir: 1 | -1): Doc {
  const i = doc.elements.findIndex((e) => e.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= doc.elements.length) return doc
  const elements = [...doc.elements]
  ;[elements[i], elements[j]] = [elements[j], elements[i]]
  return { ...doc, elements }
}

/**
 * 複製は元の要素のすぐ下に置く。お品書きでは「行を1つ増やす」操作として使われるため。
 * 下に入らなければすぐ上、それも無理ならずらして重ねる。
 */
export function duplicateEl(doc: Doc, id: string): { doc: Doc; id: string } {
  const src = doc.elements.find((e) => e.id === id)
  if (!src) return { doc, id }
  const offset = round(doc.page, Math.min(doc.page.width, doc.page.height) * 0.03)
  const y =
    src.y + src.h * 2 <= doc.page.height ? src.y + src.h
    : src.y - src.h >= 0 ? src.y - src.h
    : src.y + offset
  const copy = { ...src, id: uid(), x: y === src.y + offset ? src.x + offset : src.x, y: round(doc.page, y) }
  const i = doc.elements.indexOf(src)
  return { doc: { ...doc, elements: [...doc.elements.slice(0, i + 1), copy, ...doc.elements.slice(i + 1)] }, id: copy.id }
}

/** 初めて開いたときに空のページではなく、何を作れるかが一目で分かる見本を出す */
export function starterDoc(tab: Tab): Doc {
  const page = PRESETS[tab][0].page
  const t = (text: string, x: number, y: number, w: number, h: number, size: number, extra: Partial<TextEl> = {}): TextEl => ({
    ...newText(page, text), x, y, w, h, size, ...extra,
  })
  const r = (x: number, y: number, w: number, h: number, extra: Partial<RectEl> = {}): RectEl => ({ ...newRect(page), x, y, w, h, ...extra })
  switch (tab) {
    case 'menu':
      return {
        page, background: '#fbf7ee',
        elements: [
          r(40, 40, 1000, 1270, { fill: 'transparent', stroke: '#1b2028', strokeWidth: 4, radius: 24 }),
          t('お品書き', 80, 90, 920, 130, 96, { font: 'mincho' }),
          t('サークル名 ／ スペース番号', 80, 230, 920, 60, 40, { weight: 400 }),
          r(120, 330, 840, 4, { fill: '#1b2028', radius: 0 }),
          t('新刊　タイトル\n700円', 120, 400, 840, 200, 64),
          t('既刊　タイトル\n500円', 120, 680, 840, 200, 56, { weight: 400 }),
          t('ポストカード　各100円', 120, 960, 840, 90, 48, { weight: 400 }),
          t('現金・キャッシュレス対応', 80, 1180, 920, 60, 36, { weight: 400, color: '#5f6a7a' }),
        ],
      }
    case 'pop':
      return {
        page, background: '#ffffff',
        elements: [
          r(0, 0, 210, 60, { fill: '#f0c674', radius: 0 }),
          t('新刊', 15, 12, 180, 36, 26),
          t('タイトル', 15, 90, 180, 40, 18, { font: 'mincho' }),
          t('A5 / 36ページ / 全年齢', 15, 140, 180, 14, 7, { weight: 400 }),
          t('700円', 15, 220, 180, 40, 28),
        ],
      }
    case 'card':
      return {
        page, background: '#ffffff',
        elements: [
          r(3, 3, 85, 49, { fill: 'transparent', stroke: '#1b2028', strokeWidth: 0.4, radius: 3 }),
          t('{{品名}}', 8, 9, 75, 20, 5.5, { lineHeight: 1.3 }),
          t('{{価格}}円', 8, 32, 75, 14, 10),
        ],
      }
  }
}
