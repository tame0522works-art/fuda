// 自前で組んだ PDF が仕様どおりの骨格になっていて、埋め込んだ画像が欠けずに戻せるかを確かめる
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { buildPdf, type PdfPage } from '../src/pdf.ts'

function page(widthMm: number, heightMm: number, pxWidth: number, pxHeight: number, seed: number): PdfPage {
  const rgb = new Uint8Array(pxWidth * pxHeight * 3)
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * seed) % 251
  return { widthMm, heightMm, pxWidth, pxHeight, rgb }
}

const pages = [page(210, 297, 40, 57, 7), page(148, 210, 30, 42, 13)]
const pdf = await buildPdf(pages)
const text = Buffer.from(pdf).toString('latin1')

assert.ok(text.startsWith('%PDF-1.4\n'))
assert.ok(text.endsWith('%%EOF\n'))

// startxref が xref 表の位置を指し、表の各行がそれぞれの「n 0 obj」の先頭を指している
const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1])
assert.ok(text.startsWith('xref\n', startxref))
const [, , countStr] = /^xref\n(\d+) (\d+)\n/.exec(text.slice(startxref))!
const count = Number(countStr)
assert.equal(count, 1 + 2 + pages.length * 3)
const table = text.slice(startxref).split('\n').slice(3, 3 + count - 1)
table.forEach((line, i) => {
  assert.equal(line.length, 19, 'xref の各行は改行込みで20バイト')
  const offset = Number(line.slice(0, 10))
  assert.ok(text.startsWith(`${i + 1} 0 obj\n`, offset), `オブジェクト ${i + 1} の位置がずれている`)
})

// 用紙サイズが mm → pt で正しく入っている（A4 = 595.276 × 841.890 pt）
assert.ok(text.includes('/MediaBox [0 0 595.276 841.890]'))
assert.ok(text.includes('/MediaBox [0 0 419.528 595.276]'))

// 画像の stream を取り出して展開すると、元の画素と完全に一致する（可逆）
const streams = [...text.matchAll(/\/Subtype \/Image \/Width (\d+) \/Height (\d+)[^>]*\/Length (\d+) >>\nstream\n/g)]
assert.equal(streams.length, pages.length)
for (const [i, m] of streams.entries()) {
  const start = m.index! + m[0].length
  const body = pdf.slice(start, start + Number(m[3]))
  const inflated = new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
  assert.deepEqual(inflated, pages[i].rgb)
  assert.equal(Number(m[1]), pages[i].pxWidth)
  assert.equal(Number(m[2]), pages[i].pxHeight)
}

if (process.argv.includes('--write')) {
  writeFileSync('check-pdf.pdf', pdf)
  console.log('check-pdf.pdf を書き出しました（PDF ビューアで開けるか目視確認用）')
}
console.log(`check:pdf OK (${pdf.length} bytes)`)
