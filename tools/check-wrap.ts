// 折り返しが禁則を守り、英数字の並びを途中で折らないかを確かめる。
// 幅は「全角1文字=1、半角1文字=0.5」のダミーで測り、ブラウザなしで動かす
import assert from 'node:assert/strict'
import { wrapText } from '../src/wrap.ts'

const measure = (s: string) => [...s].reduce((w, c) => w + (/[\x20-\x7e]/.test(c) ? 0.5 : 1), 0)
const wrap = (text: string, width: number) => wrapText(text, width, measure)

// 収まるならそのまま。改行は段落として保つ
assert.deepEqual(wrap('お品書き', 10), ['お品書き'])
assert.deepEqual(wrap('新刊\n700円', 10), ['新刊', '700円'])
assert.deepEqual(wrap('', 10), [''])

// 日本語は1文字単位で詰める
assert.deepEqual(wrap('あいうえおかきくけこ', 4), ['あいうえ', 'おかきく', 'けこ'])

// 行頭禁則: 句点・閉じ括弧は前の行にぶら下げる（連続していてもまとめて）
assert.deepEqual(wrap('あいうえ。かき', 4), ['あいうえ。', 'かき'])
assert.deepEqual(wrap('あいうえ」。かき', 4), ['あいうえ」。', 'かき'])
assert.deepEqual(wrap('あいうえっ', 4), ['あいうえっ'])

// 行末禁則: 開き括弧は次の行へ送る
assert.deepEqual(wrap('あいう「えお」', 4), ['あいう', '「えお」'])

// 英数字の並びは途中で折らない（価格や巻数が割れない）
assert.deepEqual(wrap('価格は1200円', 4), ['価格は', '1200円'])
assert.deepEqual(wrap('新刊Vol2', 3), ['新刊', 'Vol2'])
// 1語が行より長いときだけは折る（無限に伸びないように）
assert.deepEqual(wrap('ABCDEFGHIJ', 2), ['ABCD', 'EFGH', 'IJ'])

console.log('check:wrap OK')
