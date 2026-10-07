// 要素と用紙の扱いを確かめる: 複製・画像を置く位置、はみ出しの判定、用紙の選択肢を選んだときの向き
import assert from 'node:assert/strict'
import { PRESETS, applyPreset, newImage, newText, presetIndexOf, starterDoc, type Doc } from '../src/doc.ts'
import { duplicateEls } from '../src/group.ts'
import { textFits } from '../src/render.ts'

const page = { width: 1080, height: 1350, unit: 'px' as const }
const docWith = (y: number, h: number): Doc => ({ page, background: '#fff', elements: [{ ...newText(page, '新刊'), x: 120, y, w: 840, h }] })

// 下に入るなら、すぐ下に同じ x・同じ大きさで置く
{
  const doc = docWith(400, 200)
  const r = duplicateEls(doc, [doc.elements[0].id])
  const copy = r.doc.elements.find((e) => e.id === r.ids[0])!
  assert.deepEqual([copy.x, copy.y, copy.w, copy.h], [120, 600, 840, 200])
  assert.notEqual(copy.id, doc.elements[0].id)
  assert.equal(r.doc.elements.indexOf(copy), 1, '元の要素の直後（1つ手前）に入る')
}

// 下に入らなければすぐ上
{
  const doc = docWith(1100, 200)
  const r = duplicateEls(doc, [doc.elements[0].id])
  assert.equal(r.doc.elements.find((e) => e.id === r.ids[0])!.y, 900)
}

// 上下どちらにも入らない大きな要素は、少しずらして重ねる
{
  const doc = docWith(100, 1000)
  const r = duplicateEls(doc, [doc.elements[0].id])
  const copy = r.doc.elements.find((e) => e.id === r.ids[0])!
  assert.ok(copy.x > 120 && copy.y > 100)
}


// 画像はドロップした点を中心に置く（横長 2:1 の画像。幅はページの6割 = 648）
{
  const img = newImage(page, 'p', 2, { x: 400, y: 500 })
  assert.deepEqual([img.x, img.y, img.w, img.h], [76, 338, 648, 324])
}

// 端に落としても、ページの内側に収める
{
  const img = newImage(page, 'p', 2, { x: 1070, y: 5 })
  assert.deepEqual([img.x, img.y], [1080 - 648, 0])
}

// 位置を渡さなければページの中央
{
  const img = newImage(page, 'p', 2)
  assert.deepEqual([img.x + img.w / 2, img.y + img.h / 2], [540, 675])
}

// はみ出しの判定は、行間の余白ではなく文字の下端で行う
{
  const el = { size: 96, lineHeight: 1.4, h: 130 }
  assert.equal(textFits(1, el), true, '96px の1行は高さ 130 の枠に収まる（下端は 96 × 1.2 = 115.2）')
  assert.equal(textFits(2, el), false, '2行（下端 96 × 2.6 = 249.6）は収まらない')
  assert.equal(textFits(1, { ...el, h: 115.2 }), true, 'ちょうど下端までなら収まる')
  assert.equal(textFits(1, { ...el, h: 115 }), false)
}

// 初めて開いたときの見本は、どれも枠に収まっている（改行の数を行数とみなす。見本の文字は枠の幅に余裕がある）
for (const tab of ['menu', 'pop', 'card'] as const) {
  for (const el of starterDoc(tab).elements) {
    if (el.kind === 'text') assert.ok(textFits(el.text.split('\n').length, el), `見本の「${el.text}」が枠からはみ出す`)
  }
}

// 用紙の選択肢: お品書きは選んだ向きのまま、印刷物は今の向きを保つ
{
  const portrait = { width: 1080, height: 1350, unit: 'px' as const }
  const fhd = PRESETS.menu.find((p) => p.label.includes('1920'))!.page
  assert.deepEqual(applyPreset(portrait, fhd), { width: 1920, height: 1080, unit: 'px' }, '縦長のお品書きから「横長 1920×1080」を選ぶと横長になる')
  assert.equal(presetIndexOf('menu', { width: 1920, height: 1080, unit: 'px' }), PRESETS.menu.findIndex((p) => p.label.includes('1920')))
  assert.equal(presetIndexOf('menu', { width: 1080, height: 1920, unit: 'px' }), -1, '縦横を入れ替えたお品書きは「横長」とは表示しない')

  const a4Landscape = { width: 297, height: 210, unit: 'mm' as const }
  const b5 = PRESETS.pop.find((p) => p.label.startsWith('B5'))!.page
  assert.deepEqual(applyPreset(a4Landscape, b5), { width: 257, height: 182, unit: 'mm' }, '横向きの A4 から B5 を選ぶと横向きの B5')
  assert.equal(presetIndexOf('pop', a4Landscape), 0, '横向きの A4 も「A4」とみなす')
}

console.log('check:doc OK')
