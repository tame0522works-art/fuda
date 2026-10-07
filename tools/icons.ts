// public/icon.svg から、アプリとして入れたときのアイコン（PNG）を作る。`npm run icons` で作り直せる。
// - icon-192.png / icon-512.png … Chrome などのインストール用
// - icon-maskable-512.png … Android が丸や角丸に切り抜く用。切り抜かれても欠けないよう、絵を中央の 80% に収める
// - apple-touch-icon.png … iPhone のホーム画面用（180px。角丸は iPhone 側で付く）
import { readFileSync, writeFileSync } from 'node:fs'
import { Browser } from './cdp.ts'

const BG = '#1d2430'
const svg = readFileSync('public/icon.svg', 'utf8')

const OUTPUTS = [
  { file: 'public/icon-192.png', size: 192, inset: 0, fill: false },
  { file: 'public/icon-512.png', size: 512, inset: 0, fill: false },
  { file: 'public/icon-maskable-512.png', size: 512, inset: 0.1, fill: true },
  { file: 'public/apple-touch-icon.png', size: 180, inset: 0.08, fill: true },
]

const browser = await Browser.launch(9335)
try {
  const page = await browser.newPage({ width: 600, height: 600 })
  for (const o of OUTPUTS) {
    const b64 = await page.run<string>(`
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg)});
      await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = ${o.size};
      const x = c.getContext('2d');
      if (${o.fill}) { x.fillStyle = '${BG}'; x.fillRect(0, 0, ${o.size}, ${o.size}); }
      const pad = ${o.size} * ${o.inset};
      x.drawImage(img, pad, pad, ${o.size} - pad * 2, ${o.size} - pad * 2);
      return c.toDataURL('image/png').split(',')[1];
    `)
    writeFileSync(o.file, Buffer.from(b64, 'base64'))
    console.log(`  ${o.file}`)
  }
} finally {
  await browser.close()
}
