// README に載せる画面の画像を撮る。開発サーバーを起動した状態で `npm run screenshots` を実行する。
// Edge（なければ Chrome）を画面なしで起動し、Chrome DevTools Protocol で操作する。
// 見本のデザインを入れ、要素を選び、確認画面を開くまでを毎回同じ手順で行うので、アプリを直したら同じ画像を撮り直せる。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newImage, newRect, newText, starterDoc, type Doc, type El, type TextEl } from '../src/doc.ts'
import type { Item } from '../src/fields.ts'

const BASE = process.argv[2] ?? 'http://localhost:5179/'
const OUT = 'docs/images'
const PORT = 9333

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

// ---- 見本のデザイン（サークル名などは架空。新刊は作者の台本「眠れない夏の夜」） ----

const menuPage = { width: 1080, height: 1350, unit: 'px' as const }
const t = (text: string, box: [number, number, number, number], size: number, extra: Partial<TextEl> = {}): El => ({
  ...newText(menuPage, text), x: box[0], y: box[1], w: box[2], h: box[3], size, color: '#2b3a55', align: 'left', weight: 400, ...extra,
})
const r = (box: [number, number, number, number], fill: string, radius = 0): El => ({
  ...newRect(menuPage), x: box[0], y: box[1], w: box[2], h: box[3], fill, radius,
})

const menu: Doc = {
  page: menuPage,
  background: '#fbf5ea',
  elements: [
    r([0, 0, 1080, 260], '#2b3a55'),
    t('お品書き', [60, 50, 960, 130], 104, { font: 'zen-maru', weight: 700, color: '#fbf5ea' }),
    t('夜更かし文庫 ／ 東ホール A-12a', [64, 180, 960, 50], 34, { color: '#d9e2f2' }),
    { ...newImage(menuPage, 'cover', 3 / 4), x: 60, y: 310, w: 420, h: 560 },
    r([520, 320, 130, 54], '#e2724b', 27),
    t('新刊', [520, 320, 130, 54], 30, { align: 'center', weight: 700, color: '#ffffff' }),
    t('眠れない夏の夜', [520, 400, 520, 90], 58, { font: 'klee', weight: 700 }),
    t('シチュエーションボイス台本集\nA5 ／ 36ページ ／ 全年齢', [520, 500, 520, 110], 28, { color: '#5a6478', lineHeight: 1.5 }),
    t('700円', [520, 640, 520, 100], 76, { font: 'zen-maru', weight: 700, color: '#e2724b' }),
    r([60, 910, 960, 3], '#2b3a55'),
    t('既刊　台本集 Vol.1', [60, 950, 700, 60], 38),
    t('500円', [760, 950, 260, 60], 38, { align: 'right', font: 'zen-maru', weight: 700 }),
    t('ポストカード（3種）', [60, 1030, 700, 60], 38),
    t('各100円', [760, 1030, 260, 60], 38, { align: 'right', font: 'zen-maru', weight: 700 }),
    t('アクリルキーホルダー', [60, 1110, 700, 60], 38),
    t('800円', [760, 1110, 260, 60], 38, { align: 'right', font: 'zen-maru', weight: 700 }),
    t('現金・QRコード決済 対応', [60, 1240, 960, 50], 30, { align: 'center', color: '#5a6478' }),
  ],
}

const items: Item[] = [
  ['新刊「眠れない夏の夜」', 700], ['既刊 台本集 Vol.1', 500], ['ポストカード（3種セット）', 300], ['アクリルキーホルダー', 800],
  ['缶バッジ', 200], ['ステッカー', 150], ['既刊 シチュエーションボイス台本集 Vol.2（特典ペーパー付き・数量限定）', 1500],
].map(([name, price], i) => ({ id: `item-${i}`, name: name as string, price: price as number }))

const card = starterDoc('card')
const docs = {
  menu,
  pop: starterDoc('pop'),
  card: { ...card, elements: card.elements.map((e) => (e.kind === 'text' && e.text.includes('品名') ? { ...e, font: 'klee' } : e)) },
}

// 表紙の代わりの絵（夜空と三日月）。ページの中で描いて Blob にする。乱数は種を固定して毎回同じ絵にする
const COVER_SCRIPT = `
  await document.fonts.load('700 60px "Klee One"', '眠れない夏の夜');
  const c = new OffscreenCanvas(600, 800); const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 800); g.addColorStop(0, '#1d2440'); g.addColorStop(1, '#5b4a8a');
  x.fillStyle = g; x.fillRect(0, 0, 600, 800);
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) { x.fillStyle = 'rgba(255,255,255,' + (0.3 + rnd() * 0.7) + ')'; x.beginPath(); x.arc(rnd() * 600, rnd() * 560, rnd() * 2.2 + 0.4, 0, 7); x.fill() }
  x.fillStyle = '#f6e7b0'; x.beginPath(); x.arc(420, 190, 90, 0, 7); x.fill();
  x.fillStyle = '#232a4a'; x.beginPath(); x.arc(462, 160, 84, 0, 7); x.fill();
  x.fillStyle = '#15192c'; x.beginPath(); x.moveTo(0, 800); x.lineTo(0, 640); x.quadraticCurveTo(300, 560, 600, 660); x.lineTo(600, 800); x.fill();
  x.fillStyle = '#fbf5ea'; x.font = '700 60px "Klee One", serif'; x.textAlign = 'center'; x.fillText('眠れない夏の夜', 300, 470);
  const cover = await c.convertToBlob({ type: 'image/png' });
`

// ---- Chrome DevTools Protocol ----

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private constructor(private ws: WebSocket, public sessionId?: string) {
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      const p = msg.id !== undefined && this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`))
      else p.resolve(msg.result)
    })
  }

  static async connect(url: string) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    return new Cdp(ws)
  }

  send(method: string, params: object = {}): Promise<any> {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params, sessionId: this.sessionId }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  /** ページの中で async 関数の本体を実行し、戻り値を受け取る */
  async run<T = unknown>(body: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true })
    if (res.exceptionDetails) throw new Error(`ページ内でエラー: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`)
    return res.result.value as T
  }

  close() {
    this.ws.close()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(cdp: Cdp, expr: string, label: string, timeout = 15_000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (await cdp.run<boolean>(`return !!(${expr})`).catch(() => false)) return
    await sleep(200)
  }
  throw new Error(`${label} を待ちきれませんでした`)
}

async function shoot(cdp: Cdp, name: string) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'))
  console.log(`  ${OUT}/${name}`)
}

async function saveDataUrl(cdp: Cdp, body: string, name: string) {
  const b64 = await cdp.run<string>(body)
  writeFileSync(join(OUT, name), Buffer.from(b64, 'base64'))
  console.log(`  ${OUT}/${name}`)
}

/** 開いたばかりのページで、書体の読み込みと描き直しが落ち着くのを待つ */
async function settle(cdp: Cdp) {
  await waitFor(cdp, `document.querySelector('.paper canvas')`, 'エディタの表示')
  await cdp.run(`await document.fonts.ready; await new Promise(r => setTimeout(r, 1500)); await document.fonts.ready`)
}

// 要素を指定してクリック（タップ）したことにする。座標は用紙の単位
const TAP = (x: number, y: number, pageWidth: number, pointerType = 'mouse') => `
  Element.prototype.setPointerCapture = function () {};
  const paper = document.querySelector('.paper'); const r = paper.getBoundingClientRect(); const k = r.width / ${pageWidth};
  const ev = (t) => new PointerEvent(t, { clientX: r.left + ${x} * k, clientY: r.top + ${y} * k, bubbles: true, pointerId: 1, pointerType: '${pointerType}', isPrimary: true, button: 0 });
  paper.dispatchEvent(ev('pointerdown')); paper.dispatchEvent(ev('pointerup'));
  await new Promise(r => setTimeout(r, 400));
`
const TAB = (label: string) => `
  [...document.querySelectorAll('.tabs button')].find(b => b.textContent === '${label}').click();
  await new Promise(r => setTimeout(r, 600));
`

async function main() {
  const exe = BROWSERS.find((p) => existsSync(p))
  if (!exe) throw new Error('Edge か Chrome が見つかりません')
  mkdirSync(OUT, { recursive: true })
  const profile = mkdtempSync(join(tmpdir(), 'fuda-shots-'))
  const browser = spawn(exe, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' })

  let cdp: Cdp | undefined
  try {
    let wsUrl = ''
    for (let i = 0; i < 50 && !wsUrl; i++) {
      wsUrl = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).then((j) => j.webSocketDebuggerUrl).catch(() => '')
      if (!wsUrl) await sleep(200)
    }
    if (!wsUrl) throw new Error('ブラウザに接続できませんでした')
    cdp = await Cdp.connect(wsUrl)
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    cdp.sessionId = sessionId
    await cdp.send('Page.enable')
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })

    const desktop = async () => {
      await cdp!.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      await cdp!.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
    }
    const open = async () => {
      await cdp!.send('Page.navigate', { url: BASE })
      await settle(cdp!)
    }

    // 見本のデザインを入れる（このブラウザ専用の一時プロファイルなので、普段のデータには触れない）
    await desktop()
    await open()
    await cdp.run(`
      ${COVER_SCRIPT}
      const db = await import('/src/db.ts');
      await db.replaceAll(${JSON.stringify(docs)}, ${JSON.stringify(items)}, new Map([['cover', cover]]));
    `)
    await open()

    console.log('撮影:')
    // 1. お品書きの編集画面（新刊のタイトルを選び、書体の欄が見えている状態）
    await cdp.run(TAP(780, 445, 1080))
    await shoot(cdp, 'editor.png')

    // 2. 書き出した PNG そのもの
    await saveDataUrl(cdp, `
      const out = await import('/src/output.ts'); const db = await import('/src/db.ts');
      const saved = await db.loadAll(); const bmp = await createImageBitmap(saved.images.get('cover'));
      const blob = await out.exportPng(saved.docs.menu, new Map([['cover', bmp]]));
      const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(s);
    `, 'oshinagaki.png')

    // 3. 値札（品目の一覧・はみ出しの印・A4 の面付け）
    await cdp.run(`${TAB('値札')} document.querySelector('.panel').scrollTop = 0`)
    await shoot(cdp, 'nefuda.png')

    // 4. 値札の書き出し前の確認画面
    await cdp.run(`
      HTMLAnchorElement.prototype.click = function () {};
      [...document.querySelectorAll('header button')].find(b => b.textContent.includes('書き出す')).click();
    `)
    await waitFor(cdp, `document.querySelector('dialog[open] canvas')`, '確認画面')
    await sleep(500)
    await shoot(cdp, 'export-preview.png')

    // 5. 値札の PDF の1ページ目（確認画面に出しているのと同じ画像）
    await saveDataUrl(cdp, `
      const c = document.querySelector('dialog[open] canvas');
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      document.querySelector('dialog[open] footer button').click();
      return btoa(s);
    `, 'nefuda-sheet.png')

    // 6. スマホ（指で操作する端末として表示し、お品書きの新刊のタイトルを選んだ状態）
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await open()
    await cdp.run(`${TAB('お品書き')} ${TAP(780, 445, 1080, 'touch')}`)
    await shoot(cdp, 'mobile.png')
  } finally {
    // Windows の Edge は起動用のプロセスと本体が別なので、起動用を kill しても本体が残る。
    // DevTools Protocol で本体に閉じるよう頼み、プロファイルを手放すまで待ってから消す
    if (cdp) {
      cdp.sessionId = undefined
      await Promise.race([cdp.send('Browser.close').catch(() => {}), sleep(3000)])
      cdp.close()
    }
    browser.kill()
    let removed = false
    for (let i = 0; i < 20 && !removed; i++) {
      try {
        rmSync(profile, { recursive: true, force: true })
        removed = true
      } catch {
        await sleep(500)
      }
    }
    if (!removed) console.warn(`一時プロファイルを消せませんでした（残しても問題ありません）: ${profile}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
