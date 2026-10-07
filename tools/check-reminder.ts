// バックアップを促す知らせが、出すべきときにだけ出るかを確かめる
import assert from 'node:assert/strict'
import { EMPTY_STATUS, IOS_AFTER, STALE_AFTER, backupReminder, markBackedUp, markEdited, markRestored } from '../src/reminder.ts'

const DAY = 24 * 60 * 60_000
const t0 = Date.UTC(2026, 9, 7, 3)

// 何も編集していなければ、どの端末でも出さない
assert.equal(backupReminder(EMPTY_STATUS, t0 + 30 * DAY, false), null)
assert.equal(backupReminder(EMPTY_STATUS, t0 + 30 * DAY, true), null)

// 編集を始めた時刻は、編集を続けても動かない（「いつから」バックアップしていないかを数えるため）
const edited = markEdited(EMPTY_STATUS, t0)
assert.equal(markEdited(edited, t0 + DAY).unbackedSince, t0)

// iPhone・iPad の Safari: 編集を少し続けたら出す
assert.equal(backupReminder(edited, t0 + IOS_AFTER - 1, true), null)
assert.deepEqual(backupReminder(edited, t0 + IOS_AFTER, true), { kind: 'ios' })

// それ以外: バックアップしていない編集が 3 日続いたら出す。一度もバックアップしていなければ日数は null
assert.equal(backupReminder(edited, t0 + STALE_AFTER - 1, false), null)
assert.deepEqual(backupReminder(edited, t0 + STALE_AFTER, false), { kind: 'stale', daysSinceBackup: null })

// バックアップすると消え、最後のバックアップから何日たったかを数えられる
const backedUp = markBackedUp(edited, t0 + 5 * DAY)
assert.equal(backupReminder(backedUp, t0 + 30 * DAY, false), null, 'その後に編集していなければ出さない')
const editedAgain = markEdited(backedUp, t0 + 6 * DAY)
assert.deepEqual(backupReminder(editedAgain, t0 + 10 * DAY, false), { kind: 'stale', daysSinceBackup: 5 })

// 復元した直後は、バックアップしていない編集はない（最後のバックアップの時刻は変えない）
const restored = markRestored(editedAgain)
assert.equal(backupReminder(restored, t0 + 30 * DAY, true), null)
assert.equal(restored.lastBackupAt, t0 + 5 * DAY)

console.log('check:reminder OK')
