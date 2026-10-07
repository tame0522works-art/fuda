// 値札の手順の表示が、今の状態に合っているかを確かめる
import assert from 'node:assert/strict'
import { starterDoc } from '../src/doc.ts'
import { cardSteps, hasFieldText } from '../src/steps.ts'

const status = (s: ReturnType<typeof cardSteps>) => s.steps.map((x) => `${x.key}:${x.status}`)

// 見本のデザインには差し込み欄がある
const texts = starterDoc('card').elements.flatMap((e) => (e.kind === 'text' ? [e.text] : []))
assert.equal(hasFieldText(texts), true)
assert.equal(hasFieldText(['新刊', '700円']), false)

// 品目が0件なら、次にやるのは「品目」
{
  const s = cardSteps({ hasFields: true, itemCount: 0, overflowCount: 0 })
  assert.deepEqual(status(s), ['design:done', 'items:todo', 'export:todo'])
  assert.equal(s.current, 'items')
  assert.equal(s.steps[2].detail, '品目を入れると書き出せます')
}

// 品目があれば、次は「書き出す」
{
  const s = cardSteps({ hasFields: true, itemCount: 7, overflowCount: 0 })
  assert.deepEqual(status(s), ['design:done', 'items:done', 'export:todo'])
  assert.equal(s.current, 'export')
  assert.equal(s.steps[1].detail, '7 件')
}

// はみ出す品目があれば注意を出すが、書き出しは止めない
{
  const s = cardSteps({ hasFields: true, itemCount: 7, overflowCount: 1 })
  assert.equal(s.steps[1].status, 'warn')
  assert.equal(s.steps[1].detail, '7 件（はみ出し 1 件）')
  assert.equal(s.current, 'export')
}

// 差し込み欄がなければ注意を出す（全部同じ札になる）が、書き出しは止めない
{
  const s = cardSteps({ hasFields: false, itemCount: 3, overflowCount: 0 })
  assert.equal(s.steps[0].status, 'warn')
  assert.equal(s.current, 'export')
}

console.log('check:steps OK')
