// 自前で組んだ PDF が仕様どおりの骨格になっていて、埋め込んだ画像が欠けずに戻せるかを確かめる
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { buildPdf, chooseImage, flateImage, type PdfImage } from '../src/pdf.ts'

function rgbOf(pxWidth: number, pxHeight: number, seed: number) {
  const rgb = new Uint8Array(pxWidth * pxHeight * 3)
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * seed) % 251
  return rgb
}

const rgbs = [rgbOf(40, 57, 7), rgbOf(30, 42, 13)]
// JPEG はブラウザでしか作れないので、中身の代わりに目印のバイト列を入れ、そのまま埋め込まれるかだけを見る
const fakeJpeg: PdfImage = { filter: 'DCTDecode', data: new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]), pxWidth: 20, pxHeight: 10 }
const pages = [
  { widthMm: 210, heightMm: 297, image: await flateImage(rgbs[0], 40, 57) },
  { widthMm: 148, heightMm: 210, image: await flateImage(rgbs[1], 30, 42) },
  { widthMm: 91, heightMm: 55, image: fakeJpeg },
]
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
assert.ok(text.includes('/MediaBox [0 0 257.953 155.906]'))

// 画像の stream を取り出すと、可逆圧縮のページは展開して元の画素と完全に一致し、JPEG のページは渡したバイト列のまま入っている
const streams = [...text.matchAll(/\/Subtype \/Image \/Width (\d+) \/Height (\d+) [^>]*\/Filter \/(\w+) \/Length (\d+) >>\nstream\n/g)]
assert.equal(streams.length, pages.length)
for (const [i, m] of streams.entries()) {
  const start = m.index! + m[0].length
  const body = pdf.slice(start, start + Number(m[4]))
  assert.equal(Number(m[1]), pages[i].image.pxWidth)
  assert.equal(Number(m[2]), pages[i].image.pxHeight)
  assert.equal(m[3], pages[i].image.filter)
  if (m[3] === 'FlateDecode') {
    const inflated = new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
    assert.deepEqual(inflated, rgbs[i])
  } else {
    assert.deepEqual(body, fakeJpeg.data)
  }
}

// どちらで埋め込むか: 写真がなければ常に可逆、写真があっても可逆が JPEG の2倍以下なら可逆
{
  const img = (filter: PdfImage['filter'], size: number): PdfImage => ({ filter, data: new Uint8Array(size), pxWidth: 1, pxHeight: 1 })
  assert.equal(chooseImage(img('FlateDecode', 9000), undefined).filter, 'FlateDecode')
  assert.equal(chooseImage(img('FlateDecode', 2000), img('DCTDecode', 1000)).filter, 'FlateDecode')
  assert.equal(chooseImage(img('FlateDecode', 7_000_000), img('DCTDecode', 900_000)).filter, 'DCTDecode')
}

if (process.argv.includes('--write')) {
  writeFileSync('check-pdf.pdf', pdf)
  console.log('check-pdf.pdf を書き出しました（PDF ビューアで開けるか目視確認用）')
}
console.log(`check:pdf OK (${pdf.length} bytes)`)
