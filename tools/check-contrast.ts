// 画面の色の組み合わせが、ダーク（基本）とライトの両方で読める濃さ（WCAG のコントラスト比 4.5 以上）かを確かめる。
// 色は src/index.css の :root（ダーク）と prefers-color-scheme: light の中の変数から読む
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/index.css', 'utf8')

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]))
}
const dark = tokens(/:root\s*\{([^}]*)\}/.exec(css)![1])
const lightBlock = /prefers-color-scheme:\s*light\)\s*\{\s*:root[^{]*\{([^}]*)\}/.exec(css)
assert.ok(lightBlock, 'ライトの色が見つからない')
const light = { ...dark, ...tokens(lightBlock[1]) }

/** 相対輝度（WCAG 2） */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// [何の文字か, 文字の色, 背景の色]（変数名で書く）
const PAIRS: [string, string, string][] = [
  ['本文の文字', 'ink', 'bg'],
  ['パネルの文字', 'ink', 'panel'],
  ['作業台の上の文字', 'ink', 'stage'],
  ['補足の文字', 'ink-dim', 'bg'],
  ['パネルの補足の文字', 'ink-dim', 'panel'],
  ['主ボタンの文字', 'accent-ink', 'accent'],
  ['エラー・削除の文字', 'warn', 'panel'],
  ['背景の上のエラーの文字', 'warn', 'bg'],
  ['はみ出しの知らせ・手順の警告の印', 'on-status', 'warn'],
  ['手順の完了の印', 'on-status', 'ok'],
]

const failures: string[] = []
for (const [name, theme] of [
  ['ダーク', dark],
  ['ライト', light],
] as const) {
  for (const [label, fg, bg] of PAIRS) {
    assert.ok(theme[fg] && theme[bg], `${name}に --${fg} か --${bg} がない`)
    const r = ratio(theme[fg], theme[bg])
    if (r < 4.5) failures.push(`${name}の${label}: ${r.toFixed(2)}（--${fg} ${theme[fg]} / --${bg} ${theme[bg]}）`)
  }
}
assert.deepEqual(failures, [], `コントラスト比が 4.5 に届かない組み合わせがあります:\n${failures.join('\n')}`)

console.log('check:contrast OK')
