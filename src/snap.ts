/**
 * ドラッグ中の要素を、ページの端・中央と、他の要素の端・中央に吸着させる。
 * 吸着した線は整列ガイドとして画面に出す。
 */

export type Box = { x: number; y: number; w: number; h: number }
export type Guide = { axis: 'x' | 'y'; at: number }
type Axis = Guide['axis']

const lines = (b: Box, axis: Axis) => (axis === 'x' ? [b.x, b.x + b.w / 2, b.x + b.w] : [b.y, b.y + b.h / 2, b.y + b.h])

function targetsOf(others: readonly Box[], page: { width: number; height: number }, axis: Axis): number[] {
  const size = axis === 'x' ? page.width : page.height
  return [0, size / 2, size, ...others.flatMap((o) => lines(o, axis))]
}

/** edges のどれかを targets のどれかに合わせるための最小のずらし量。threshold を超えるなら null */
function nearest(edges: readonly number[], targets: readonly number[], threshold: number): number | null {
  let best: number | null = null
  for (const e of edges) {
    for (const t of targets) {
      const d = t - e
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d
    }
  }
  return best
}

// 吸着後に「ちょうど揃っている」とみなす誤差。浮動小数点の端数で線が出たり消えたりしないように
const EPS = 1e-6

function guidesFor(edges: readonly number[], targets: readonly number[], axis: Axis): Guide[] {
  const hit = new Set<number>()
  for (const t of targets) if (edges.some((e) => Math.abs(e - t) < EPS)) hit.add(t)
  return [...hit].map((at) => ({ axis, at }))
}

export function snapMove(box: Box, others: readonly Box[], page: { width: number; height: number }, threshold: number) {
  const tx = targetsOf(others, page, 'x')
  const ty = targetsOf(others, page, 'y')
  const dx = nearest(lines(box, 'x'), tx, threshold) ?? 0
  const dy = nearest(lines(box, 'y'), ty, threshold) ?? 0
  const out = { ...box, x: box.x + dx, y: box.y + dy }
  return { box: out, guides: [...guidesFor(lines(out, 'x'), tx, 'x'), ...guidesFor(lines(out, 'y'), ty, 'y')] }
}

/**
 * 拡大縮小では、つまんでいる辺だけを吸着させる（反対側の辺は動かさない）。
 * mode は 'e' 'nw' のように、動かす辺の方角を含む文字列。
 */
export function snapResize(
  box: Box, mode: string, others: readonly Box[], page: { width: number; height: number }, threshold: number, min: number,
) {
  const out = { ...box }
  const guides: Guide[] = []
  for (const axis of ['x', 'y'] as const) {
    const [lo, hi] = axis === 'x' ? ['w', 'e'] : ['n', 's']
    const pos = axis === 'x' ? 'x' : 'y'
    const len = axis === 'x' ? 'w' : 'h'
    const targets = targetsOf(others, page, axis)
    if (mode.includes(hi)) {
      const edge = out[pos] + out[len]
      const d = nearest([edge], targets, threshold)
      if (d !== null && out[len] + d >= min) out[len] += d
      guides.push(...guidesFor([out[pos] + out[len]], targets, axis))
    } else if (mode.includes(lo)) {
      const d = nearest([out[pos]], targets, threshold)
      if (d !== null && out[len] - d >= min) {
        out[pos] += d
        out[len] -= d
      }
      guides.push(...guidesFor([out[pos]], targets, axis))
    }
  }
  return { box: out, guides }
}
