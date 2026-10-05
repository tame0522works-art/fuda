import { uid } from './doc'
import type { Item } from './fields'

/**
 * tsuri の「バックアップ（JSON）」から品目だけを取り出す。
 * 外から来るファイルなので、形が違えば理由を添えて断る。会計の記録は読まない。
 */
export function itemsFromTsuriBackup(json: unknown): Item[] {
  if (typeof json !== 'object' || json === null) throw new Error('JSON の形式ではありません')
  const b = json as Record<string, unknown>
  if (b.app !== 'tsuri') throw new Error('tsuri のバックアップファイルではありません')
  if (b.format !== 1) throw new Error(`この形式（format: ${String(b.format)}）にはまだ対応していません`)
  if (!Array.isArray(b.items)) throw new Error('品目が見つかりません')
  return b.items.map((raw, i): Item => {
    const it = (raw ?? {}) as Record<string, unknown>
    if (typeof it.name !== 'string' || it.name.trim() === '') throw new Error(`${i + 1}件目の品名が読めません`)
    if (typeof it.price !== 'number' || !Number.isFinite(it.price) || it.price < 0) throw new Error(`「${it.name}」の価格が読めません`)
    return { id: uid(), name: it.name, price: it.price }
  })
}
