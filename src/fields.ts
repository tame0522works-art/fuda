/** 値札に差し込む頒布物。tsuri から読み込むか、ここで直接入力する */
export type Item = { id: string; name: string; price: number }

export const FIELDS = ['品名', '価格'] as const

const FIELD_PATTERN = /\{\{(品名|価格)\}\}/g

export function fillFields(text: string, item: Item | undefined): string {
  if (!item) return text
  return text.replace(FIELD_PATTERN, (_, key: string) => (key === '品名' ? item.name : item.price.toLocaleString('ja-JP')))
}
