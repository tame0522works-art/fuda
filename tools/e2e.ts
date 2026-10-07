// 画面操作のテスト。公開と同じ設定でビルドしたもの（CSP 入り）をローカルで配信し、
// 本物のマウス・キーボード・タッチ・ファイル選択を送って、試用で見つかった不具合が戻っていないかを確かめる。
// `npm run e2e` で実行する（先に dist-e2e へビルドしてから、このスクリプトが配信とブラウザを立ち上げる）。
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toBackup } from '../src/backup.ts'
import { starterDoc } from '../src/doc.ts'
import { Browser, sleep, type Page, type Viewport } from './cdp.ts'

const PORT = 4181
const BASE = `http://127.0.0.1:${PORT}/`
const DESKTOP: Viewport = { width: 1280, height: 800 }
const PHONE: Viewport = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, touch: true }
const FAILURES = 'e2e-failures'

// DevTools Protocol の修飾キー
const ALT = 1
const CTRL = 2
const SHIFT = 8

const KEYS: Record<string, { code: string; vk: number }> = {
  a: { code: 'KeyA', vk: 65 }, z: { code: 'KeyZ', vk: 90 },
  Escape: { code: 'Escape', vk: 27 }, Delete: { code: 'Delete', vk: 46 }, Enter: { code: 'Enter', vk: 13 },
}

/** ページの操作。座標は用紙の単位（お品書きなら px）で指定し、画面上の位置に直して本物の入力を送る */
class Ui {
  downloads: string
  constructor(readonly page: Page, downloads: string) {
    this.downloads = downloads
    // 復元などの確認（confirm）は「はい」で進める
    page.on('Page.javascriptDialogOpening', () => void page.send('Page.handleJavaScriptDialog', { accept: true }))
  }

  async open() {
    await this.page.goto(BASE)
    await this.page.waitFor(`document.querySelector('.paper canvas')`, 'エディタの表示')
    await this.page.run(`await document.fonts.ready; await new Promise(r => setTimeout(r, 600))`)
  }

  /** 端末の中の保存データ（IndexedDB の meta）を直接書き換える。時間の経過を待たずに確かめるため */
  async setMeta(key: string, value: unknown) {
    await this.page.run(`
      const db = await new Promise((ok, ng) => { const r = indexedDB.open('fuda'); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error) });
      await new Promise((ok, ng) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(${JSON.stringify(value)}, ${JSON.stringify(key)}); tx.oncomplete = ok; tx.onerror = () => ng(tx.error) });
      db.close();
    `)
  }

  banner(includes: string) {
    return this.page.run<boolean>(`return [...document.querySelectorAll('.banner')].some(b => b.textContent.includes(${JSON.stringify(includes)}))`)
  }

  /** Service Worker が入り、このページを受け持つまで待つ */
  async waitForServiceWorker() {
    await this.page.run(`await navigator.serviceWorker.ready`)
    await this.page.waitFor(`navigator.serviceWorker.controller`, 'Service Worker の受け持ち')
  }

  async reload() {
    await this.page.send('Page.reload')
    await sleep(300)
    await this.page.waitFor(`document.readyState === 'complete' && document.querySelector('.paper canvas')`, '読み直し')
    await sleep(500)
  }

  /** 用紙の座標 → 画面上の座標 */
  async at(x: number, y: number): Promise<{ x: number; y: number }> {
    return this.page.run(`
      const r = document.querySelector('.paper').getBoundingClientRect();
      const [w] = document.querySelector('.inspector .row .dim').textContent.split('×').map(Number.parseFloat);
      const k = r.width / w;
      return { x: r.left + ${x} * k, y: r.top + ${y} * k };
    `)
  }

  private mouse(type: string, p: { x: number; y: number }, extra: object = {}) {
    return this.page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', ...extra })
  }

  async clickScreen(p: { x: number; y: number }, opts: { count?: number; modifiers?: number } = {}) {
    const modifiers = opts.modifiers ?? 0
    await this.mouse('mouseMoved', p, { button: 'none', modifiers })
    for (let c = 1; c <= (opts.count ?? 1); c++) {
      await this.mouse('mousePressed', p, { clickCount: c, modifiers, buttons: 1 })
      await this.mouse('mouseReleased', p, { clickCount: c, modifiers })
    }
    await sleep(200)
  }

  async click(x: number, y: number, opts: { count?: number; modifiers?: number } = {}) {
    await this.clickScreen(await this.at(x, y), opts)
  }

  async drag(from: [number, number], to: [number, number], modifiers = 0) {
    const a = await this.at(...from)
    const b = await this.at(...to)
    await this.mouse('mouseMoved', a, { button: 'none', modifiers })
    await this.mouse('mousePressed', a, { clickCount: 1, modifiers, buttons: 1 })
    for (let i = 1; i <= 8; i++) {
      await this.mouse('mouseMoved', { x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }, { modifiers, buttons: 1 })
    }
    await this.mouse('mouseReleased', b, { clickCount: 1, modifiers })
    await sleep(200)
  }

  async tap(x: number, y: number) {
    const p = await this.at(x, y)
    await this.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] })
    await this.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(300)
  }

  async key(key: string, modifiers = 0) {
    const k = KEYS[key]
    await this.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers })
    await this.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers })
    await sleep(200)
  }

  async type(text: string) {
    await this.page.send('Input.insertText', { text })
    await sleep(200)
  }

  /** 見えているボタンを文字で探して、本物のクリックを送る */
  async button(label: string, scope = 'body') {
    const p = await this.page.run<{ x: number; y: number } | null>(`
      const b = [...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('button, summary')]
        .find(e => e.textContent.trim() === ${JSON.stringify(label)} && e.getClientRects().length > 0 && !e.disabled);
      if (!b) return null;
      // 画面の外にあれば、利用者がスクロールするのと同じように見える所まで動かしてから押す
      b.scrollIntoView({ block: 'nearest' });
      await new Promise(r => setTimeout(r, 100));
      const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `)
    assert.ok(p, `ボタン「${label}」が見つからない`)
    await this.clickScreen(p)
  }

  text(selector: string) {
    return this.page.run<string | null>(`return document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`)
  }

  /** 右パネルの、ラベルが label の入力欄の値 */
  field(label: string) {
    return this.page.run<string | null>(`
      const f = [...document.querySelectorAll('.inspector .field')].find(f => f.querySelector('span')?.textContent.startsWith(${JSON.stringify(label)}));
      return f?.querySelector('input, select, textarea')?.value ?? null;
    `)
  }

  async heading() {
    return this.page.run<string | null>(`return document.querySelector('.inspector section:nth-child(2) h2')?.textContent ?? null`)
  }

  async setFiles(selector: string, files: string[]) {
    const { result } = await this.page.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` })
    await this.page.send('DOM.setFileInputFiles', { files, objectId: result.objectId })
    await sleep(300)
  }

  async chooseOption(selector: string, includes: string) {
    await this.page.run(`
      const s = document.querySelector(${JSON.stringify(selector)});
      const i = [...s.options].findIndex(o => o.textContent.includes(${JSON.stringify(includes)}));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, s.options[i].value);
      s.dispatchEvent(new Event('change', { bubbles: true }));
    `)
    await sleep(300)
  }

  /** ダウンロードし終えたファイルを待つ（書きかけの .crdownload は数えない） */
  async download(ext: string): Promise<Buffer> {
    const until = Date.now() + 15_000
    while (Date.now() < until) {
      const done = readdirSync(this.downloads).find((f) => f.endsWith(ext))
      if (done) return readFileSync(join(this.downloads, done))
      await sleep(200)
    }
    throw new Error(`${ext} のダウンロードが見つからない`)
  }
}

const near = (actual: number, expected: number, tol: number, msg: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual}（期待 ${expected} ± ${tol}）`)

type Scenario = { name: string; viewport?: Viewport; run: (ui: Ui) => Promise<void> }

const scenarios: Scenario[] = [
  {
    name: '起動すると見本が出て、外部への送信は CSP で止まる',
    async run(ui) {
      const errors: string[] = []
      ui.page.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.text))
      await ui.open()
      assert.match((await ui.page.run<string>(`return document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`)), /connect-src 'none'/)
      const sent = await ui.page.run<string>(`return fetch('https://example.com/collect', { method: 'POST', body: 'x' }).then(() => 'sent', () => 'blocked')`)
      assert.equal(sent, 'blocked', '外部への送信が拒否される')
      await ui.key('a', CTRL)
      assert.equal(await ui.heading(), '8 個を選択中')
      assert.deepEqual(errors, [], 'ページ内でエラーが出ない')
    },
  },
  {
    name: 'クリックで選び、ドラッグで動かし、元に戻すで戻る',
    async run(ui) {
      await ui.open()
      await ui.click(540, 500)
      assert.deepEqual([await ui.field('左'), await ui.field('上')], ['120', '400'])
      // Alt を押しながら動かすと吸着しない
      await ui.drag([540, 500], [640, 560], ALT)
      near(Number(await ui.field('左')), 220, 3, '右へ動く')
      near(Number(await ui.field('上')), 460, 3, '下へ動く')
      await ui.key('z', CTRL)
      assert.deepEqual([await ui.field('左'), await ui.field('上')], ['120', '400'], 'ドラッグ1回が元に戻す1回で戻る')
    },
  },
  {
    name: '外枠の内側の余白から囲むと、中の要素だけをまとめて選べる',
    async run(ui) {
      await ui.open()
      await ui.click(540, 1110)
      assert.equal(await ui.page.run(`return document.querySelectorAll('.selection').length`), 0, '外枠の内側の余白では何も選ばれない')
      await ui.drag([100, 380], [990, 900])
      assert.equal(await ui.heading(), '2 個を選択中')
      await ui.click(540, 43, { modifiers: SHIFT })
      assert.equal(await ui.heading(), '3 個を選択中', 'Shift+クリックで外枠（線の上）を足せる')
    },
  },
  {
    name: 'ダブルクリックでその場で書き換え、元に戻すは1回で済む',
    async run(ui) {
      await ui.open()
      await ui.click(540, 155, { count: 2 })
      assert.equal(await ui.page.run(`return document.activeElement?.className`), 'text-edit', '文字の上に入力欄が開く')
      await ui.type('（新刊あり）')
      await ui.key('Escape')
      assert.equal(await ui.page.run(`return document.querySelector('.inspector textarea')?.value`), 'お品書き（新刊あり）')
      await ui.key('z', CTRL)
      assert.equal(await ui.page.run(`return document.querySelector('.inspector textarea')?.value`), 'お品書き')
    },
  },
  {
    name: '縦長から「横長 1920×1080」に変えると横長になり、外枠は新しい用紙いっぱいに広がる',
    async run(ui) {
      await ui.open()
      await ui.chooseOption('.inspector select', '1920')
      assert.equal(await ui.text('.inspector .row .dim'), '1920×1080 px')
      await ui.click(960, 33)
      assert.equal(await ui.heading(), '図形')
      assert.deepEqual([await ui.field('幅'), await ui.field('高さ')], ['1856', '1016'])
    },
  },
  {
    name: 'PNG は確認画面を出してから保存し、ファイルとして保存される',
    async run(ui) {
      await ui.open()
      await ui.key('a', CTRL)
      await ui.button('PNG 画像を書き出す')
      await ui.page.waitFor(`document.querySelector('dialog[open]')`, '確認画面')
      assert.match((await ui.text('dialog[open] header .dim'))!, /1080×1350 px/)
      // 確認画面の間は、裏のページのショートカットが効かない
      await ui.key('Delete')
      await ui.button('閉じる', 'dialog[open]')
      assert.equal(await ui.page.run(`return !!document.querySelector('dialog')`), false)
      assert.equal(await ui.heading(), '8 個を選択中', '確認画面で Delete を押しても要素は消えない')
      await ui.button('PNG 画像を書き出す')
      await ui.page.waitFor(`document.querySelector('dialog[open]')`, '確認画面')
      await ui.button('保存する', 'dialog[open]')
      const png = await ui.download('.png')
      assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG')
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1080, 1350], '保存した PNG の大きさ')
    },
  },
  {
    name: '値札: 品目がまだなくても、差し込み欄のままプレビューでき、保存はさせない',
    async run(ui) {
      await ui.open()
      await ui.button('値札')
      await ui.button('A4 に面付けした PDFを書き出す')
      await ui.page.waitFor(`document.querySelector('dialog[open] canvas')`, '確認画面')
      assert.match((await ui.text('dialog[open] .msg'))!, /品目がまだないので、差し込み欄のまま/)
      const buttons = await ui.page.run<string[]>(`return [...document.querySelectorAll('dialog[open] footer button')].map(b => b.textContent)`)
      assert.deepEqual(buttons, ['閉じる', '品目を追加する'], '見本のときは保存・共有を出さず、品目を足しに行ける')
      assert.equal(await ui.page.run(`return document.activeElement?.textContent`), '閉じる')
      await ui.button('品目を追加する', 'dialog[open]')
      assert.equal(await ui.page.run(`return !!document.querySelector('dialog')`), false, '確認画面は閉じる')
      assert.equal(await ui.page.run(`return document.querySelectorAll('.item-list li').length`), 1, '品目が1件増える')
      assert.equal(await ui.page.run(`return document.activeElement?.classList.contains('name')`), true, '足した品目の品名を入力できる')
    },
  },
  {
    name: '値札: 品目を足すと面付けされ、長い品名には印が付き、PDF が保存される',
    async run(ui) {
      await ui.open()
      await ui.button('値札')
      await ui.button('品目を追加')
      await ui.button('品目を追加')
      const name = await ui.page.run<{ x: number; y: number }>(`
        const r = document.querySelectorAll('.item-list .name')[1].getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 };
      `)
      await ui.clickScreen(name)
      await ui.key('a', CTRL)
      await ui.type('既刊 シチュエーションボイス台本集 Vol.2（特典ペーパー付き・数量限定）')
      await ui.page.waitFor(`document.querySelector('.item-list .warn')`, 'はみ出しの印')
      await ui.button('A4 に面付けした PDFを書き出す')
      await ui.page.waitFor(`document.querySelector('dialog[open] canvas')`, '確認画面')
      assert.match((await ui.text('dialog[open] header .dim'))!, /× 1ページ/)
      await ui.button('保存する', 'dialog[open]')
      const pdf = await ui.download('.pdf')
      assert.equal(pdf.subarray(0, 8).toString('latin1'), '%PDF-1.4')
      assert.match(pdf.toString('latin1'), /\/Count 1 /)
    },
  },
  {
    name: 'スマホ幅でも値札の品目を足せて、入力欄がページの裏に隠れず、A4 の PDF を保存できる',
    viewport: PHONE,
    async run(ui) {
      await ui.open()
      await ui.button('値札')
      await ui.button('品目を追加')
      const place = await ui.page.run<{ input: number; stage: number; vh: number }>(`
        const i = document.activeElement.getBoundingClientRect(); const st = document.querySelector('.stage').getBoundingClientRect();
        return { input: i.top, stage: st.bottom, vh: innerHeight };
      `)
      assert.equal(await ui.page.run(`return document.activeElement?.classList.contains('name')`), true, '足した品目の品名を入力できる')
      assert.ok(place.input >= place.stage && place.input < place.vh, `入力欄が見えている（入力欄 ${place.input} / ページの下端 ${place.stage} / 画面 ${place.vh}）`)
      // 入力欄が、画面上部に残しているページの裏に来るまでスクロールしてから、その入力欄へ移る（Tab で移ったときと同じ）
      const hidden = await ui.page.run<{ before: number; after: number; stage: number }>(`
        const input = document.querySelector('.item-list .name');
        const stage = document.querySelector('.stage').getBoundingClientRect().bottom;
        window.scrollBy(0, input.getBoundingClientRect().top - stage / 2);
        await new Promise(r => setTimeout(r, 100));
        const before = input.getBoundingClientRect().top;
        input.blur(); input.focus();
        await new Promise(r => setTimeout(r, 300));
        return { before, after: input.getBoundingClientRect().top, stage };
      `)
      assert.ok(hidden.before < hidden.stage, `入力欄がページの裏に来ている（${hidden.before} < ${hidden.stage}）`)
      assert.ok(hidden.after >= hidden.stage, `入力欄へ移ると、ページの裏から出てくる（${hidden.after} ≥ ${hidden.stage}）`)
      await ui.button('A4 に面付けした PDFを書き出す')
      await ui.page.waitFor(`document.querySelector('dialog[open] canvas')`, '確認画面')
      await ui.button('保存する', 'dialog[open]')
      const pdf = await ui.download('.pdf')
      assert.equal(pdf.subarray(0, 8).toString('latin1'), '%PDF-1.4')
    },
  },
  {
    name: 'バックアップのファイルから復元でき、書き出したバックアップにも反映される',
    async run(ui) {
      await ui.open()
      const menu = starterDoc('menu')
      const docs = {
        menu: { ...menu, elements: menu.elements.map((e) => (e.kind === 'text' && e.text === 'お品書き' ? { ...e, text: 'E2E のお品書き' } : e)) },
        pop: starterDoc('pop'),
        card: starterDoc('card'),
      }
      const file = join(ui.downloads, 'restore-me.json')
      writeFileSync(file, JSON.stringify(await toBackup(docs, [{ id: 'i', name: '新刊', price: 700 }], new Map())))
      await ui.setFiles('header input[type=file]', [file])
      await ui.page.waitFor(`document.querySelector('.banner.ok')?.textContent.includes('バックアップから戻しました')`, '復元の知らせ')
      await ui.click(540, 155)
      assert.equal(await ui.page.run(`return document.querySelector('.inspector textarea')?.value`), 'E2E のお品書き')
      rmSync(file)
      await ui.button('バックアップ')
      const saved = JSON.parse((await ui.download('.json')).toString('utf8'))
      assert.equal(saved.app, 'fuda')
      assert.ok(saved.docs.menu.elements.some((e: { text?: string }) => e.text === 'E2E のお品書き'))
      assert.deepEqual(saved.items.map((i: { name: string }) => i.name), ['新刊'])
    },
  },
  {
    name: 'スマホ幅では画面からはみ出さず、タップで選べる',
    viewport: PHONE,
    async run(ui) {
      await ui.open()
      const layout = await ui.page.run<{ docW: number; innerW: number; more: boolean; hint: boolean }>(`
        return {
          docW: document.documentElement.scrollWidth, innerW: innerWidth,
          more: getComputedStyle(document.querySelector('.more')).display !== 'none',
          hint: getComputedStyle(document.querySelector('.tool-hint')).display !== 'none',
        };
      `)
      assert.equal(layout.docW, layout.innerW, '横にはみ出さない')
      assert.equal(layout.more, true, 'バックアップ・復元は「その他」にまとまる')
      assert.equal(layout.hint, false, 'ドラッグで画像を入れる案内は出さない')
      await ui.tap(540, 500)
      assert.ok(await ui.page.run(`return !!document.querySelector('.quick-actions')`), 'タップで選ぶと、そばにボタンが出る')
      const docW = await ui.page.run<number>(`return document.documentElement.scrollWidth`)
      assert.equal(docW, layout.innerW, '選んで右パネルが変わっても、横にはみ出さない')
    },
  },
  {
    name: 'バックアップしていない編集が3日続くとバックアップを促し、取ると消える',
    async run(ui) {
      await ui.open()
      await ui.drag([540, 500], [600, 520], ALT)
      await sleep(600)
      assert.equal(await ui.banner('バックアップを取って'), false, '編集してすぐには出さない')
      await ui.setMeta('backup', { unbackedSince: Date.now() - 3 * 24 * 60 * 60_000 - 60_000, lastBackupAt: null })
      await ui.reload()
      assert.equal(await ui.banner('まだバックアップを取っていません'), true, '3日たつと知らせる')
      await ui.button('バックアップ', '.banner')
      const saved = JSON.parse((await ui.download('.json')).toString('utf8'))
      assert.equal(saved.app, 'fuda')
      assert.equal(await ui.banner('バックアップを取って'), false, 'バックアップを取ると消える')
      await ui.reload()
      assert.equal(await ui.banner('バックアップを取って'), false, '開き直しても出ない')
    },
  },
  {
    name: 'iPhone の Safari では、編集を続けると「7日間で消えることがある」と知らせる',
    async run(ui) {
      await ui.page.send('Emulation.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      })
      await ui.open()
      await ui.setMeta('backup', { unbackedSince: Date.now() - 11 * 60_000, lastBackupAt: null })
      await ui.reload()
      assert.equal(await ui.banner('Safari では、7日間開かないと'), true)
      await ui.button('あとで', '.banner')
      assert.equal(await ui.banner('Safari では、7日間開かないと'), false, '「あとで」で閉じる')
    },
  },
  {
    name: 'アプリとして入れられる（manifest にエラーがなく、インストールできない理由がない）',
    async run(ui) {
      await ui.open()
      await ui.waitForServiceWorker()
      const { errors, data } = await ui.page.send('Page.getAppManifest')
      assert.deepEqual(errors, [], 'manifest の読み込みエラーがない')
      assert.equal(JSON.parse(data).short_name, 'fuda')
      const inst = await ui.page.send('Page.getInstallabilityErrors')
      // テストごとに保存データを分けるため、シークレットウィンドウ相当の環境で開いている。そこではどのサイトもインストールできないので、その理由だけは除く
      const reasons = inst.installabilityErrors.map((e: { errorId: string }) => e.errorId).filter((id: string) => id !== 'in-incognito')
      assert.deepEqual(reasons, [], `インストールできない理由がない: ${JSON.stringify(inst.installabilityErrors)}`)
    },
  },
  {
    name: '「新しい版があります」が出たまま再読み込みしても、古い版のままにならない',
    async run(ui) {
      await ui.open()
      await ui.waitForServiceWorker()
      // 作業中（何か操作したあと）に新しい版が届くと、知らせを出して待機させる
      await ui.key('Escape')
      const swPath = join('dist-e2e', 'sw.js')
      const original = readFileSync(swPath, 'utf8')
      const newCache = original.match(/const CACHE = '(fuda-[0-9a-f]{12})'/)![1].replace(/[0-9a-f]{12}$/, (v) => [...v].reverse().join(''))
      writeFileSync(swPath, original.replace(/const CACHE = 'fuda-[0-9a-f]{12}'/, `const CACHE = '${newCache}'`))
      try {
        await ui.page.run(`await (await navigator.serviceWorker.ready).update()`)
        await ui.page.waitFor(`[...document.querySelectorAll('.banner')].some(b => b.textContent.includes('新しい版があります'))`, '新しい版の知らせ')
        // ここで「更新する」を押さずに再読み込みする。ブラウザの再読み込みだけでは待機中の版に切り替わらないので、
        // 開き直した直後（まだ操作していない）に fuda が自分で切り替える
        await ui.reload()
        await ui.page.waitFor(`caches.keys().then(k => k.includes('${newCache}') && !k.some(n => /^fuda-[0-9a-f]{12}$/.test(n) && n !== '${newCache}'))`, '新しい版への切り替え', 20_000)
        await ui.page.waitFor(`document.querySelector('.paper canvas')`, '読み直し')
        await sleep(800)
        assert.equal(await ui.banner('新しい版があります'), false, '切り替わったので知らせは出ない')
      } finally {
        writeFileSync(swPath, original)
      }
    },
  },
  {
    name: '新しい版が届くと知らせが出て、「更新する」で切り替わり、作ったデザインは残る',
    async run(ui) {
      await ui.open()
      await ui.waitForServiceWorker()
      await ui.click(540, 155, { count: 2 })
      await ui.type('（更新前）')
      await ui.key('Escape')
      await sleep(600)
      // 配信している sw.js の版の名前だけを書き換えて、新しい版が出たことにする（長さは変えない）
      const swPath = join('dist-e2e', 'sw.js')
      const original = readFileSync(swPath, 'utf8')
      const before = await ui.page.run<string>(`return navigator.serviceWorker.controller.scriptURL`)
      writeFileSync(swPath, original.replace(/const CACHE = 'fuda-([0-9a-f]{12})'/, (_, v: string) => `const CACHE = 'fuda-${[...v].reverse().join('')}'`))
      try {
        await ui.page.run(`await (await navigator.serviceWorker.ready).update()`)
        await ui.page.waitFor(`[...document.querySelectorAll('.banner')].some(b => b.textContent.includes('新しい版があります'))`, '新しい版の知らせ')
        const navigated = new Promise((r) => ui.page.on('Page.frameNavigated', r))
        await ui.button('更新する')
        await Promise.race([navigated, sleep(5000)])
        await ui.page.waitFor(`document.querySelector('.paper canvas')`, '読み直し')
        await sleep(500)
        assert.equal(await ui.page.run(`return [...document.querySelectorAll('.banner')].some(b => b.textContent.includes('新しい版があります'))`), false, '切り替わったら知らせは消える')
        assert.equal(await ui.page.run<string>(`return navigator.serviceWorker.controller.scriptURL`), before)
        await ui.click(540, 155)
        assert.equal(await ui.page.run(`return document.querySelector('.inspector textarea')?.value`), 'お品書き（更新前）', '更新しても作ったデザインは残る')
      } finally {
        writeFileSync(swPath, original)
      }
    },
  },
  {
    name: '電波がないときに、まだ使っていない書体を選ぶと知らせ、電波が戻ってから開き直すと使える',
    async run(ui) {
      await ui.open()
      await ui.waitForServiceWorker()
      await stopServer()
      await ui.reload()
      await ui.click(540, 155)
      await ui.chooseOption('.inspector .field:has(.font-sample) select', 'DotGothic16')
      await ui.page.waitFor(`[...document.querySelectorAll('.banner')].some(b => b.textContent.includes('電波がないため'))`, '読み込めなかった知らせ')
      assert.match((await ui.text('.inspector .field:has(.font-sample) .msg.error'))!, /電波がないため「DotGothic16（レトロ）」を読み込めませんでした/)

      await startServer()
      await ui.button('開き直す', '.banner')
      await sleep(1200)
      await ui.page.waitFor(`document.querySelector('.paper canvas')`, '開き直し')
      await ui.page.waitFor(`document.fonts.check('700 16px "DotGothic16"', 'お品書き')`, '書体の読み込み')
      await sleep(300)
      assert.equal(await ui.banner('電波がないため'), false, '読み込めたら知らせは消える')
    },
  },
  {
    name: '電波がなくても開け、一度使った同梱フォントも使える',
    async run(ui) {
      await ui.open()
      await ui.waitForServiceWorker()
      await ui.click(540, 155)
      await ui.page.run(`
        const s = [...document.querySelectorAll('.inspector .field')].find(f => f.querySelector('span')?.textContent === '書体').querySelector('select');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'zen-maru');
        s.dispatchEvent(new Event('change', { bubbles: true }));
      `)
      await ui.page.waitFor(`document.fonts.check('700 16px "Zen Maru Gothic"', 'お品書き')`, '同梱フォントの読み込み')
      await ui.page.waitFor(`caches.open('fuda-fonts').then(c => c.keys()).then(k => k.length > 0)`, 'フォントのキャッシュ')
      await sleep(600)

      await stopServer()
      assert.equal(await fetch(BASE).then(() => 'up', () => 'down'), 'down', '配信が止まっている')
      await ui.reload()
      const offline = await ui.page.run<{ title: string; fontLoaded: boolean }>(`
        const faces = await document.fonts.load('700 16px "Zen Maru Gothic"', 'お品書き');
        return { title: document.title, fontLoaded: faces.length > 0 && faces.every(f => f.status === 'loaded') };
      `)
      assert.equal(offline.title, 'fuda', '電波がなくても開ける')
      assert.equal(offline.fontLoaded, true, '一度使った同梱フォントは電波がなくても読める')
      await ui.click(540, 155)
      assert.equal(await ui.field('書体'), 'zen-maru', '作ったデザインも残っている')
    },
  },
]

let server: ChildProcess | null = null

async function startServer() {
  if (server) return
  // vite の preview で dist-e2e を配信する（npx を介さず、どの OS でも同じ起動のしかたにする）
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist-e2e', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    if (await fetch(BASE).then((r) => r.ok, () => false)) return
    await sleep(100)
  }
  stopServer()
  throw new Error('テスト用のサーバーが起動しませんでした')
}

/** 電波がない状態を作るため、配信そのものを止める（ブラウザの「オフライン」は Service Worker の通信には効かないことがある） */
async function stopServer() {
  if (!server) return
  const s = server
  server = null
  const exited = new Promise((r) => s.once('exit', r))
  s.kill()
  await exited
}

async function main() {
  const only = process.argv[2]
  await startServer()
  const browser = await Browser.launch(9334)
  let failed = 0
  try {
    for (const s of scenarios.filter((s) => !only || s.name.includes(only))) {
      await startServer()
      const downloads = mkdtempSync(join(tmpdir(), 'fuda-e2e-dl-'))
      const page = await browser.newPage(s.viewport ?? DESKTOP, { downloadPath: downloads })
      const ui = new Ui(page, downloads)
      const t0 = Date.now()
      try {
        await s.run(ui)
        console.log(`  ✓ ${s.name}（${((Date.now() - t0) / 1000).toFixed(1)}秒）`)
      } catch (e) {
        failed++
        console.log(`  ✗ ${s.name}\n      ${e instanceof Error ? e.message : String(e)}`)
        mkdirSync(FAILURES, { recursive: true })
        const { data } = await page.send('Page.captureScreenshot', { format: 'png' }).catch(() => ({ data: '' }))
        if (data) writeFileSync(join(FAILURES, `${scenarios.indexOf(s) + 1}.png`), Buffer.from(data, 'base64'))
      } finally {
        await page.send('Page.close').catch(() => {})
        rmSync(downloads, { recursive: true, force: true })
      }
    }
  } finally {
    await browser.close()
    await stopServer()
  }
  if (failed > 0) {
    console.log(`\n${failed} 件失敗しました（失敗時の画面: ${FAILURES}/）`)
    process.exit(1)
  }
  console.log('\ne2e OK')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
