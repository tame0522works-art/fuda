// 値札の面付けが、一般的な名刺用紙と同じ面数になり、用紙の中央に並ぶかを確かめる
import assert from 'node:assert/strict'
import { A4, SHEET_MARGIN, layoutSheet, sheetCount } from '../src/sheet.ts'

const meishi = layoutSheet({ width: 91, height: 55 })!
assert.equal(meishi.cols, 2)
assert.equal(meishi.rows, 5)
assert.equal(meishi.perSheet, 10, '名刺サイズは市販の名刺用紙と同じ10面')
// 左右・上下の余白が等しい（中央寄せ）
assert.ok(Math.abs(meishi.area.x0 - (A4.width - meishi.area.x1)) < 1e-9)
assert.ok(Math.abs(meishi.area.y0 - (A4.height - meishi.area.y1)) < 1e-9)
// どの面も外周の余白より内側にある
for (const s of meishi.slots) {
  assert.ok(s.x >= SHEET_MARGIN && s.y >= SHEET_MARGIN)
  assert.ok(s.x + 91 <= A4.width - SHEET_MARGIN + 1e-9 && s.y + 55 <= A4.height - SHEET_MARGIN + 1e-9)
}

assert.equal(layoutSheet({ width: 55, height: 91 })!.perSheet, 9, '名刺縦は3列×3行')
assert.equal(layoutSheet({ width: 74, height: 52 })!.perSheet, 10, 'A8 は2列×5行')
// ちょうど割り切れる寸法でも、浮動小数点の誤差で1列減らない
assert.equal(layoutSheet({ width: 95, height: 92.333333333 })!.cols, 2)
// 用紙に入らない大きさは null
assert.equal(layoutSheet({ width: 200, height: 50 }), null)

assert.equal(sheetCount(0, meishi), 1)
assert.equal(sheetCount(10, meishi), 1)
assert.equal(sheetCount(11, meishi), 2)

console.log('check:sheet OK')
