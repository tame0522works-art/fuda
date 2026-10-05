/**
 * 書体の一覧。文字要素は書体を文字列のキーで持つ。
 * - 'gothic' 'mincho' … 端末に入っている標準の書体
 * - 'zen-maru' など … fuda に同梱した無料フォント（すべて SIL Open Font License 1.1）
 * - 'local:<名前>' … PC にインストールされている書体（Chrome / Edge で一覧から追加したもの）
 *
 * 同梱フォントの @font-face は fonts-load.ts で読み込む（ここは Node の検証からも読むので CSS を import しない）。
 */

export type FontDef = { key: string; label: string; group: string; css: string; weights: (400 | 700)[] }

export const FONT_LIST: FontDef[] = [
  { key: 'gothic', label: 'ゴシック', group: '標準', css: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif', weights: [400, 700] },
  { key: 'mincho', label: '明朝', group: '標準', css: '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif', weights: [400, 700] },
  { key: 'zen-maru', label: 'Zen Maru Gothic', group: '丸ゴシック', css: '"Zen Maru Gothic", sans-serif', weights: [400, 700] },
  { key: 'dela-gothic', label: 'Dela Gothic One', group: '太い見出し', css: '"Dela Gothic One", sans-serif', weights: [400] },
  { key: 'klee', label: 'Klee One（教科書体風）', group: '手書き風', css: '"Klee One", serif', weights: [400, 700] },
  { key: 'yomogi', label: 'Yomogi（ペン字風）', group: '手書き風', css: '"Yomogi", sans-serif', weights: [400] },
  { key: 'dotgothic', label: 'DotGothic16（レトロ）', group: 'デザイン', css: '"DotGothic16", sans-serif', weights: [400] },
  { key: 'rocknroll', label: 'RocknRoll One（ポップ）', group: 'デザイン', css: '"RocknRoll One", sans-serif', weights: [400] },
]

export const LOCAL_PREFIX = 'local:'

// PC の書体名は外から来る文字列なので、CSS の font 指定を壊す記号は落としてから使う
const safeFamily = (name: string) => name.replace(/["\\;{}]/g, '').trim()

export const localFontKey = (family: string) => LOCAL_PREFIX + safeFamily(family)

/** canvas と CSS の font 指定に使う書体の並び。知らないキーでも必ず何かで描けるようにする */
export function fontStack(key: string): string {
  const def = FONT_LIST.find((f) => f.key === key)
  if (def) return def.css
  if (key.startsWith(LOCAL_PREFIX)) return `"${safeFamily(key.slice(LOCAL_PREFIX.length))}", ${FONT_LIST[0].css}`
  return FONT_LIST[0].css
}

/** 太字を持たない書体で太字を指定すると、ブラウザが輪郭を太らせて崩れるので、選べる太さを書体ごとに決める */
export function fontWeights(key: string): (400 | 700)[] {
  return FONT_LIST.find((f) => f.key === key)?.weights ?? [400, 700]
}

export function fontLabel(key: string): string {
  return FONT_LIST.find((f) => f.key === key)?.label ?? key.slice(LOCAL_PREFIX.length)
}

/**
 * 描く前に、使う文字の分だけ書体を読み込む。
 * 同梱フォントは文字のまとまりごとに分割してあり、canvas は自分では読み込みを起こさないため。
 * 新しく読み込んだものがあれば true（描き直しが要る）。
 */
export async function ensureFonts(specs: readonly { font: string; weight: number; text: string }[]): Promise<boolean> {
  const pending = specs
    .filter((s) => s.text !== '')
    .map((s) => ({ font: `${s.weight} 16px ${fontStack(s.font)}`, text: s.text }))
    .filter((s) => !document.fonts.check(s.font, s.text))
  if (pending.length === 0) return false
  await Promise.all(pending.map((s) => document.fonts.load(s.font, s.text)))
  return true
}

type LocalFontData = { family: string }
type WindowWithLocalFonts = Window & { queryLocalFonts?: () => Promise<LocalFontData[]> }

export const canListLocalFonts = () => typeof (window as WindowWithLocalFonts).queryLocalFonts === 'function'

/** PC に入っている書体の名前を一覧にする（初回はブラウザが許可を求める）。同じ書体の太さ違いは1つにまとめる */
export async function listLocalFonts(): Promise<string[]> {
  const fonts = await (window as WindowWithLocalFonts).queryLocalFonts!()
  return [...new Set(fonts.map((f) => safeFamily(f.family)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
}
