/**
 * バックアップを促す知らせを、いつ・どう出すかを決める。
 * デザインはブラウザの中にしかないので、失われる前にバックアップを取ってもらうため。
 */

export type BackupStatus = {
  /** バックアップしていない編集が始まった時刻。バックアップか復元をすると null に戻る */
  unbackedSince: number | null
  /** 最後にバックアップを書き出した時刻 */
  lastBackupAt: number | null
}

export const EMPTY_STATUS: BackupStatus = { unbackedSince: null, lastBackupAt: null }

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/**
 * iPhone・iPad の Safari は、ホーム画面に追加していないサイトを 7 日間開かないと、そのサイトのデータを消すことがある。
 * 次にいつ開くか分からないので、編集している最中（少し続けたところ）で知らせる
 */
export const IOS_AFTER = 10 * MINUTE
/** それ以外の端末では、バックアップしていない編集が数日続いたら知らせる */
export const STALE_AFTER = 3 * DAY

export type Reminder = { kind: 'ios' } | { kind: 'stale'; daysSinceBackup: number | null }

export function backupReminder(status: BackupStatus, now: number, iosBrowser: boolean): Reminder | null {
  if (status.unbackedSince === null) return null
  const unbackedFor = now - status.unbackedSince
  if (iosBrowser) return unbackedFor >= IOS_AFTER ? { kind: 'ios' } : null
  if (unbackedFor < STALE_AFTER) return null
  return { kind: 'stale', daysSinceBackup: status.lastBackupAt === null ? null : Math.floor((now - status.lastBackupAt) / DAY) }
}

/** 編集したとき。すでにバックアップしていない編集が続いているなら、始まりの時刻は変えない */
export const markEdited = (s: BackupStatus, now: number): BackupStatus => (s.unbackedSince === null ? { ...s, unbackedSince: now } : s)

export const markBackedUp = (s: BackupStatus, now: number): BackupStatus => ({ ...s, unbackedSince: null, lastBackupAt: now })

/** 復元した直後は、バックアップのファイルと中身が同じなので、バックアップしていない編集はない */
export const markRestored = (s: BackupStatus): BackupStatus => ({ ...s, unbackedSince: null })
