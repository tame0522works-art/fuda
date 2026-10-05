// 要素を足す位置を確かめる: 複製は「すぐ下に1行増える」位置、画像はドロップした点を中心にしてページ内に収める
import assert from 'node:assert/strict'
import { newImage, newText, type Doc } from '../src/doc.ts'
import { duplicateEls } from '../src/group.ts'
import { textFits } from '../src/render.ts'
import { starterDoc } from '../src/doc.ts'

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

console.log('check:doc OK')
