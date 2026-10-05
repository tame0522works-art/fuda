/**
 * 1ページに1枚の画像を全面に貼っただけの PDF を書き出す。
 * 必要なのはこれだけなので、PDF ライブラリは使わず仕様の最小限を自前で組む。
 * 画像は2通りの形で埋め込める:
 * - FlateDecode … 可逆圧縮した RGB。文字と図形だけのページは JPEG より小さく、文字の輪郭もにじまない
 * - DCTDecode   … JPEG をそのまま。写真を含むページは可逆圧縮の数倍小さくなる
 */

export type PdfImage = { filter: 'FlateDecode' | 'DCTDecode'; data: Uint8Array; pxWidth: number; pxHeight: number }

export type PdfPage = { widthMm: number; heightMm: number; image: PdfImage }

const mmToPt = (mm: number) => (mm * 72) / 25.4

export async function deflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  // CompressionStream の 'deflate' は zlib 形式で、PDF の FlateDecode が期待する形式と一致する
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 左上から右へ、行ごとに下へ並んだ RGB 各8bit を可逆圧縮して埋め込める形にする */
export async function flateImage(rgb: Uint8Array<ArrayBuffer>, pxWidth: number, pxHeight: number): Promise<PdfImage> {
  return { filter: 'FlateDecode', data: await deflate(rgb), pxWidth, pxHeight }
}

export async function buildPdf(pages: readonly PdfPage[]): Promise<Uint8Array<ArrayBuffer>> {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  const obj = (n: number, ...body: (string | Uint8Array)[]) => {
    offsets[n] = length
    push(`${n} 0 obj\n`)
    body.forEach(push)
    push('\nendobj\n')
  }

  push('%PDF-1.4\n')
  // 2行目に 0x80 以上のバイトを置くと、転送ソフトがバイナリとして扱ってくれる（PDF の慣例）
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  // 1: Catalog, 2: Pages, 以降はページごとに Page / 描画命令 / 画像 の3つ
  const pageObj = (i: number) => 3 + i * 3
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`)

  for (const [i, p] of pages.entries()) {
    const n = pageObj(i)
    const w = mmToPt(p.widthMm).toFixed(3)
    const h = mmToPt(p.heightMm).toFixed(3)
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`)
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`
    obj(n + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    const img = p.image
    obj(
      n + 2,
      `<< /Type /XObject /Subtype /Image /Width ${img.pxWidth} /Height ${img.pxHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${img.filter} /Length ${img.data.length} >>\nstream\n`,
      img.data,
      '\nendstream',
    )
  }

  const xref = length
  const size = offsets.length
  push(`xref\n0 ${size}\n0000000000 65535 f \n`)
  for (let n = 1; n < size; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/**
 * 写真を含むページだけ JPEG と比べ、可逆圧縮が JPEG の2倍を超えるときだけ JPEG にする。
 * 写真全面の A4 で可逆 7MB 前後・JPEG 1MB 弱と約8倍の差が出たため（README の実測）。
 * 文字と図形だけのページは可逆のほうが小さいので、そのまま可逆を使う。
 */
export const JPEG_SWITCH_RATIO = 2

export function chooseImage(flate: PdfImage, jpeg: PdfImage | undefined): PdfImage {
  return jpeg && flate.data.length > jpeg.data.length * JPEG_SWITCH_RATIO ? jpeg : flate
}
