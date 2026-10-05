// 複数選択の操作（当たり判定・囲み選択・移動・複製・揃え・等間隔）を確かめる
import assert from 'node:assert/strict'
import { newRect, newText, type Doc, type El } from '../src/doc.ts'
import { alignEls, bboxOf, distributeEls, duplicateEls, hitTest, idsInside, moveEls, removeEls } from '../src/group.ts'

const page = { width: 1000, height: 1000, unit: 'px' as const }
const t = (id: string, x: number, y: number, w: number, h: number): El => ({ ...newText(page, id), id, x, y, w, h })
const frame: El = { ...newRect(page), id: 'frame', x: 20, y: 20, w: 960, h: 960, fill: 'transparent', stroke: '#000000', strokeWidth: 4 }
const doc: Doc = { page, background: '#ffffff', elements: [frame, t('a', 100, 100, 200, 50), t('b', 100, 300, 300, 50), t('c', 100, 700, 100, 50)] }
const at = (d: Doc, id: string) => d.elements.find((e) => e.id === id)!
const xy = (d: Doc, id: string) => [at(d, id).x, at(d, id).y]

// 塗りのない外枠は線の近くでだけ当たり、内側の何もない所では当たらない（囲み選択を始められる）
assert.equal(hitTest(doc, { x: 500, y: 600 }, 6)?.id, undefined)
assert.equal(hitTest(doc, { x: 500, y: 23 }, 6)?.id, 'frame')
assert.equal(hitTest(doc, { x: 150, y: 120 }, 6)?.id, 'a')
// 塗りのある図形は内側どこでも当たる
const filled: Doc = { ...doc, elements: [{ ...frame, fill: '#ffeeaa' }] }
assert.equal(hitTest(filled, { x: 500, y: 600 }, 6)?.id, 'frame')

// 囲み選択は、すっぽり入った要素だけ（外枠のようにはみ出すものは拾わない）
assert.deepEqual(idsInside(doc, { x: 50, y: 50, w: 500, h: 400 }), ['a', 'b'])

assert.deepEqual(bboxOf([at(doc, 'a'), at(doc, 'b')]), { x: 100, y: 100, w: 300, h: 250 })

// 移動・削除はまとめて
{
  const m = moveEls(doc, ['a', 'b'], 10, -5)
  assert.deepEqual([xy(m, 'a'), xy(m, 'b'), xy(m, 'c')], [[110, 95], [110, 295], [100, 700]])
  assert.deepEqual(removeEls(doc, ['a', 'c']).elements.map((e) => e.id), ['frame', 'b'])
}

// 複製はまとまりの高さ分だけ下へ、並びと間隔を保ったまま。それぞれ元の直後に入る
{
  const r = duplicateEls(doc, ['a', 'b'])
  assert.equal(r.ids.length, 2)
  assert.deepEqual(r.ids.map((id) => xy(r.doc, id)), [[100, 350], [100, 550]])
  assert.deepEqual(r.doc.elements.map((e) => e.id).slice(0, 3), ['frame', 'a', r.ids[0]])
}

// 揃え: 複数ならまとまりの外枠に、1つだけならページに
{
  assert.deepEqual([at(alignEls(doc, ['a', 'b'], 'right'), 'a').x], [200])
  assert.deepEqual([at(alignEls(doc, ['a', 'b'], 'hcenter'), 'a').x], [150])
  assert.deepEqual([at(alignEls(doc, ['a', 'c'], 'bottom'), 'a').y], [700])
  assert.deepEqual(xy(alignEls(doc, ['c'], 'hcenter'), 'c'), [450, 700], '1つだけならページの左右中央')
  assert.deepEqual(xy(alignEls(doc, ['c'], 'vcenter'), 'c'), [100, 475])
}

// 等間隔: 両端は動かさず、あいだの間隔をそろえる（a: 100〜150, b: 300〜350, c: 700〜750 → 間隔 250）
{
  const d = distributeEls(doc, ['c', 'a', 'b'], 'y')
  assert.deepEqual([at(d, 'a').y, at(d, 'b').y, at(d, 'c').y], [100, 400, 700])
  assert.equal(distributeEls(doc, ['a', 'b'], 'y'), doc, '2つ以下では何もしない')
}

console.log('check:group OK')
