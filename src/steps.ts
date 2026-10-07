/**
 * 値札を作る3段階（デザイン → 品目 → 書き出す）のどこまで済んでいるか。
 * 品目が0件のまま書き出そうとして詰まることが試用で続いたので、順番と次にやることを画面に出すため。
 */

export type StepKey = 'design' | 'items' | 'export'

export type Step = { key: StepKey; label: string; status: 'done' | 'warn' | 'todo'; detail: string }

export type CardSteps = { steps: Step[]; current: StepKey }

export function cardSteps(input: { hasFields: boolean; itemCount: number; overflowCount: number }): CardSteps {
  const { hasFields, itemCount, overflowCount } = input
  const steps: Step[] = [
    {
      key: 'design',
      label: 'デザイン',
      // 差し込み欄がなくても書き出せる（全部同じ札になる）ので、止めずに注意だけ出す
      status: hasFields ? 'done' : 'warn',
      detail: hasFields ? '差し込み欄あり' : '品名欄・価格欄を置くと、品目ごとに差し込まれます',
    },
    {
      key: 'items',
      label: '品目',
      status: itemCount === 0 ? 'todo' : overflowCount > 0 ? 'warn' : 'done',
      detail: itemCount === 0 ? 'まだありません' : overflowCount > 0 ? `${itemCount} 件（はみ出し ${overflowCount} 件）` : `${itemCount} 件`,
    },
    {
      key: 'export',
      label: '書き出す',
      status: 'todo',
      detail: itemCount === 0 ? '品目を入れると書き出せます' : 'A4 に面付けした PDF を保存できます',
    },
  ]
  return { steps, current: itemCount === 0 ? 'items' : 'export' }
}

const FIELD = /\{\{(品名|価格)\}\}/

export const hasFieldText = (texts: readonly string[]) => texts.some((t) => FIELD.test(t))
