// 書き出しにかかる時間とファイルサイズを測る。README に載せる数値はここで出したものだけを使う
import { newImage, resizePage, starterDoc, type Doc } from '../doc'
import type { Item } from '../fields'
import { PRINT_DPI, exportCardsPdf, exportPng, exportPopPdf } from '../output'
import { drawDoc, type Images } from '../render'

const RUNS = 5

type Row = { label: string; output: string; ms: number; min: number; max: number; bytes: number }

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function measure(label: string, output: string, fn: () => Promise<Blob>): Promise<Row> {
  await fn() // 1回目はフォントの読み込みや JIT の影響が大きいので数えない
  const times: number[] = []
  let bytes = 0
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now()
    const blob = await fn()
    times.push(performance.now() - t0)
    bytes = blob.size
  }
  return { label, output, ms: median(times), min: Math.min(...times), max: Math.max(...times), bytes }
}

/** 同じページを JPEG にした場合の大きさ。可逆圧縮を選んだ代わりにどれだけ大きくなるかの目安 */
async function jpegSize(doc: Doc, images: Images): Promise<number> {
  const k = PRINT_DPI / 25.4
  const canvas = new OffscreenCanvas(Math.round(doc.page.width * k), Math.round(doc.page.height * k))
  drawDoc(canvas.getContext('2d')!, doc, k, images)
  return (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).size
}

const NAMES = ['新刊「眠れない夏の夜」', '既刊 台本集 Vol.2', 'ポストカード', 'アクリルキーホルダー', '缶バッジ', 'ステッカー', 'クリアファイル', '無料配布ペーパー']
const itemsOf = (n: number): Item[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i), name: NAMES[i % NAMES.length], price: 100 * ((i % 8) + 1) }))

const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`)
const msText = (r: Row) => `${Math.round(r.ms)} ms（${Math.round(r.min)}〜${Math.round(r.max)}）`

async function run(photo: File | undefined) {
  const status = document.getElementById('status')!
  const rows: Row[] = []
  const notes: string[] = []
  const none: Images = new Map()
  const menu = starterDoc('menu')
  const popA4 = starterDoc('pop')
  const popA5 = resizePage(popA4, { width: 148, height: 210, unit: 'mm' })
  const card = starterDoc('card')

  const step = async (label: string, output: string, fn: () => Promise<Blob>) => {
    status.textContent = `${label} を計測中…`
    rows.push(await measure(label, output, fn))
  }

  await step('お品書き（見本）', 'PNG 1080×1350', () => exportPng(menu, none))
  await step('ポップ A4（見本）', `PDF ${PRINT_DPI}dpi 1ページ`, () => exportPopPdf(popA4, none))
  await step('ポップ A5（見本を縮小）', `PDF ${PRINT_DPI}dpi 1ページ`, () => exportPopPdf(popA5, none))
  await step('値札 名刺 10品目', 'PDF A4 1枚', () => exportCardsPdf(card, itemsOf(10), none))
  await step('値札 名刺 50品目', 'PDF A4 5枚', () => exportCardsPdf(card, itemsOf(50), none))
  notes.push(`参考: ポップ A4（見本）を JPEG（品質0.92）にした場合 ${kb(await jpegSize(popA4, none))}`)

  if (photo) {
    const bitmap = await createImageBitmap(photo)
    const images: Images = new Map([['photo', bitmap]])
    const bg = { ...newImage(popA4.page, 'photo', bitmap.width / bitmap.height), x: 0, y: 0, w: popA4.page.width, h: popA4.page.height }
    const withPhoto: Doc = { ...popA4, elements: [bg, ...popA4.elements] }
    await step(`ポップ A4（写真 ${bitmap.width}×${bitmap.height} を全面）`, `PDF ${PRINT_DPI}dpi 1ページ`, () => exportPopPdf(withPhoto, images))
    notes.push(`参考: 写真を全面に敷いたポップ A4 を JPEG（品質0.92）にした場合 ${kb(await jpegSize(withPhoto, images))}`)
  }

  const ua = navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? navigator.userAgent
  const lines = [
    `計測日: ${new Date().toISOString().slice(0, 10)} ／ ${ua} ／ 論理コア ${navigator.hardwareConcurrency}`,
    `各条件で1回空打ちしたあと${RUNS}回測った中央値（カッコ内は最小〜最大）`,
    '',
    '| 対象 | 出力 | 時間 | サイズ |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.label} | ${r.output} | ${msText(r)} | ${kb(r.bytes)} |`),
    '',
    ...notes,
  ]
  document.getElementById('out')!.textContent = lines.join('\n')
  status.textContent = '完了'
}

document.getElementById('run')!.addEventListener('click', () => {
  const photo = (document.getElementById('photo') as HTMLInputElement).files?.[0]
  run(photo).catch((e: unknown) => {
    document.getElementById('status')!.textContent = `失敗: ${(e as Error).message}`
  })
})
