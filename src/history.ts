/** 元に戻す・やり直し。タブ（お品書き・ポップ・値札）ごとに別々に持つ */

export type History<T> = { past: T[]; present: T; future: T[] }

const LIMIT = 100

export const initHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] })

/** coalesce=true のときは直前の状態を履歴に積まない（数値入力を1文字打つたびに1手ずつ戻るのを防ぐ） */
export function push<T>(h: History<T>, next: T, coalesce = false): History<T> {
  if (next === h.present) return h
  return { past: coalesce ? h.past : [...h.past, h.present].slice(-LIMIT), present: next, future: [] }
}

/** ドラッグ中の途中経過。履歴には積まず、離したときに commitFrom で1手にまとめる */
export const replace = <T>(h: History<T>, next: T): History<T> => ({ ...h, present: next })

export function commitFrom<T>(h: History<T>, base: T): History<T> {
  if (base === h.present) return h
  return { past: [...h.past, base].slice(-LIMIT), present: h.present, future: [] }
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}
