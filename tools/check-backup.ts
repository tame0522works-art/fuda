// バックアップを書き出して読み戻すと、デザイン・品目・画像が欠けずに戻り、壊れたファイルは理由付きで断るかを確かめる
import assert from 'node:assert/strict'
import { parseBackup, toBackup } from '../src/backup.ts'
import { newImage, starterDoc, type Doc, type Tab } from '../src/doc.ts'

const pngBytes = new Uint8Array(300_000).map((_, i) => (i * 31) % 256) // 区切って base64 にする処理を通る大きさ
const used = new Blob([pngBytes], { type: 'image/png' })
const unused = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })

const pop = starterDoc('pop')
const docs: Record<Tab, Doc> = {
  menu: starterDoc('menu'),
  pop: { ...pop, elements: [...pop.elements, newImage(pop.page, 'img-used', 1.5)] },
  card: starterDoc('card'),
}
const items = [{ id: 'a', name: '新刊「眠れない夏の夜」', price: 700 }]

const backup = await toBackup(docs, items, new Map([['img-used', used], ['img-unused', unused]]), new Date('2026-10-05T03:00:00Z'))
assert.deepEqual(Object.keys(backup.images), ['img-used'], '使われていない画像は入れない')

// JSON 文字列を経由して読み戻す（実際のファイルと同じ経路）
const restored = parseBackup(JSON.parse(JSON.stringify(backup)))
assert.deepEqual(restored.docs, docs)
assert.deepEqual(restored.items, items)
const back = restored.images.get('img-used')!
assert.equal(back.type, 'image/png')
assert.deepEqual(new Uint8Array(await back.arrayBuffer()), pngBytes, '画像のバイト列が完全に戻る')

// 壊れたファイル・別のファイルは、理由を添えて断る
const clone = () => JSON.parse(JSON.stringify(backup))
const rejects = (mutate: (b: any) => void, message: RegExp) => {
  const b = clone()
  mutate(b)
  assert.throws(() => parseBackup(b), message)
}
assert.throws(() => parseBackup('text'), /JSON の形式ではありません/)
assert.throws(() => parseBackup({ app: 'tsuri', format: 1 }), /tsuri のバックアップです/)
rejects((b) => (b.app = 'other'), /fuda のバックアップファイルではありません/)
rejects((b) => (b.format = 2), /format: 2/)
rejects((b) => delete b.docs.card, /「値札」のデザインが見つかりません/)
rejects((b) => (b.docs.menu.page.unit = 'cm'), /「お品書き」の用紙の単位/)
rejects((b) => (b.docs.menu.elements[1].size = 'big'), /「お品書き」の2番目の要素の文字サイズ/)
rejects((b) => (b.docs.menu.elements[0].fill = 'red; x'), /「お品書き」の1番目の要素の色/)
rejects((b) => (b.docs.menu.elements[0].kind = 'script'), /種類が読めません/)
rejects((b) => (b.docs.pop.elements.at(-1).imageId = 'missing'), /画像がファイルに入っていません/)
rejects((b) => (b.docs.menu.elements[1].id = b.docs.menu.elements[0].id), /同じ id の要素/)
rejects((b) => (b.images['img-used'].type = 'image/svg+xml'), /形式が読めません/)
rejects((b) => (b.images['img-used'].base64 = '%%%'), /壊れています/)
rejects((b) => (b.items[0].price = -1), /1件目の価格/)

// 知らない項目は取り込まない（組み立て直した結果にだけ入る）
{
  const b = clone()
  b.docs.menu.elements[0].onclick = 'alert(1)'
  assert.equal('onclick' in parseBackup(b).docs.menu.elements[0], false)
}

console.log(`check:backup OK (画像 ${pngBytes.length} B → JSON ${JSON.stringify(backup).length} 文字)`)
