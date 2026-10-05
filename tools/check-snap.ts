// 整列ガイドの吸着が、ページと他の要素の端・中央に正しく合い、遠いときは動かさないかを確かめる
import assert from 'node:assert/strict'
import { snapMove, snapResize, type Guide } from '../src/snap.ts'

const page = { width: 1000, height: 800 }
const sorted = (g: Guide[]) => [...g].sort((a, b) => a.axis.localeCompare(b.axis) || a.at - b.at)

// ページの中央に、要素の中央が吸着する（中央 = 500。要素の中央は 497 → 3 ずらす）
{
  const r = snapMove({ x: 447, y: 100.5, w: 100, h: 50 }, [], page, 5)
  assert.equal(r.box.x, 450)
  assert.deepEqual(sorted(r.guides), [{ axis: 'x', at: 500 }])
  assert.equal(r.box.y, 100.5, '近くに何もない軸は動かさない')
}

// しきい値より遠ければ吸着しない
{
  const r = snapMove({ x: 440, y: 300, w: 100, h: 50 }, [], page, 5)
  assert.equal(r.box.x, 440)
  assert.deepEqual(r.guides, [])
}

// 他の要素の左端に揃う。複数の候補があれば一番近いものに合わせる
{
  const other = { x: 200, y: 600, w: 300, h: 100 }
  const r = snapMove({ x: 203, y: 100, w: 80, h: 40 }, [other], page, 5)
  assert.equal(r.box.x, 200)
  assert.deepEqual(r.guides, [{ axis: 'x', at: 200 }])
}

// 上下の吸着: 他の要素の下端と、この要素の上端
{
  const other = { x: 600, y: 100, w: 100, h: 100 }
  const r = snapMove({ x: 50, y: 198, w: 80, h: 40 }, [other], page, 5)
  assert.equal(r.box.y, 200)
  assert.deepEqual(r.guides, [{ axis: 'y', at: 200 }])
}

// 同じ幅の要素の真下に置くと、左端・中央・右端の3本がすべて揃って見える
{
  const other = { x: 100, y: 100, w: 200, h: 50 }
  const r = snapMove({ x: 102, y: 520, w: 200, h: 50 }, [other], page, 5)
  assert.deepEqual(sorted(r.guides), [
    { axis: 'x', at: 100 }, { axis: 'x', at: 200 }, { axis: 'x', at: 300 },
  ])
}

// 拡大縮小: 右辺だけを吸着させ、左辺（x）は動かさない
{
  const r = snapResize({ x: 100, y: 100, w: 396, h: 50 }, 'e', [], page, 5, 10)
  assert.deepEqual(r.box, { x: 100, y: 100, w: 400, h: 50 }, '右辺がページ中央 500 に合う')
  assert.deepEqual(r.guides, [{ axis: 'x', at: 500 }])
}

// 左上をつまんだら、左辺と上辺を吸着させ、右下の角は固定のまま
{
  const r = snapResize({ x: 3, y: 397, w: 197, h: 103 }, 'nw', [], page, 5, 10)
  assert.deepEqual(r.box, { x: 0, y: 400, w: 200, h: 100 })
  assert.deepEqual(sorted(r.guides), [{ axis: 'x', at: 0 }, { axis: 'y', at: 400 }])
}

// 吸着すると最小サイズを割る場合は吸着しない
{
  const other = { x: 104, y: 0, w: 20, h: 10 }
  const r = snapResize({ x: 100, y: 300, w: 8, h: 50 }, 'e', [other], page, 5, 8)
  assert.equal(r.box.w, 8)
}

console.log('check:snap OK')
