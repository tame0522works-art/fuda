// tsuri のバックアップから品目だけを取り出し、壊れたファイルは理由付きで断るかを確かめる
import assert from 'node:assert/strict'
import { itemsFromTsuriBackup } from '../src/tsuri.ts'

const backup = {
  app: 'tsuri', format: 1, exportedAt: '2026-10-12T02:00:00.000Z',
  items: [
    { id: 'a', name: '新刊「夏の夜」', price: 700, stock: 30, createdAt: 0 },
    { id: 'b', name: 'ポストカード', price: 100, stock: 20, createdAt: 1 },
  ],
  methods: [], entries: [{ kind: 'sale', id: 's1' }],
}
const items = itemsFromTsuriBackup(JSON.parse(JSON.stringify(backup)))
assert.deepEqual(items.map(({ name, price }) => ({ name, price })), [
  { name: '新刊「夏の夜」', price: 700 },
  { name: 'ポストカード', price: 100 },
])
// 読み込むたびに新しい id を振る（tsuri 側の id とは独立）
assert.notEqual(items[0].id, 'a')

const rejects = (input: unknown, message: RegExp) => assert.throws(() => itemsFromTsuriBackup(input), message)
rejects(null, /JSON の形式ではありません/)
rejects({ app: 'other', format: 1, items: [] }, /tsuri のバックアップファイルではありません/)
rejects({ app: 'tsuri', format: 2, items: [] }, /format: 2/)
rejects({ app: 'tsuri', format: 1 }, /品目が見つかりません/)
rejects({ app: 'tsuri', format: 1, items: [{ name: '', price: 1 }] }, /1件目の品名/)
rejects({ app: 'tsuri', format: 1, items: [{ name: '本', price: '700' }] }, /「本」の価格/)
rejects({ app: 'tsuri', format: 1, items: [{ name: '本', price: -1 }] }, /「本」の価格/)
rejects({ app: 'tsuri', format: 1, items: [null] }, /1件目の品名/)

console.log('check:tsuri OK')
