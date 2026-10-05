// 複製が「すぐ下に1行増える」位置に置かれ、ページからはみ出すときは上かずらした位置に逃げるかを確かめる
import assert from 'node:assert/strict'
import { duplicateEl, newText, type Doc } from '../src/doc.ts'

const page = { width: 1080, height: 1350, unit: 'px' as const }
const docWith = (y: number, h: number): Doc => ({ page, background: '#fff', elements: [{ ...newText(page, '新刊'), x: 120, y, w: 840, h }] })

// 下に入るなら、すぐ下に同じ x・同じ大きさで置く
{
  const doc = docWith(400, 200)
  const r = duplicateEl(doc, doc.elements[0].id)
  const copy = r.doc.elements.find((e) => e.id === r.id)!
  assert.deepEqual([copy.x, copy.y, copy.w, copy.h], [120, 600, 840, 200])
  assert.notEqual(copy.id, doc.elements[0].id)
  assert.equal(r.doc.elements.indexOf(copy), 1, '元の要素の直後（1つ手前）に入る')
}

// 下に入らなければすぐ上
{
  const doc = docWith(1100, 200)
  const r = duplicateEl(doc, doc.elements[0].id)
  assert.equal(r.doc.elements.find((e) => e.id === r.id)!.y, 900)
}

// 上下どちらにも入らない大きな要素は、少しずらして重ねる
{
  const doc = docWith(100, 1000)
  const r = duplicateEl(doc, doc.elements[0].id)
  const copy = r.doc.elements.find((e) => e.id === r.id)!
  assert.ok(copy.x > 120 && copy.y > 100)
}

console.log('check:duplicate OK')
