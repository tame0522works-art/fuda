import { useSyncExternalStore } from 'react'

/**
 * アプリとして入れる（PWA）ための仕組み。
 * - Service Worker を登録し、電波がなくても開けるようにする（本番のビルドだけ）
 * - 新しい版が届いたら知らせ、「更新する」で切り替える（開きっぱなしでも古い版のままにしない）
 * - 対応しているブラウザ（Chrome・Edge・Android）では、画面のボタンからインストールできるようにする
 */

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

export type PwaState = { updateReady: boolean; canInstall: boolean }

let state: PwaState = { updateReady: false, canInstall: false }
const listeners = new Set<() => void>()
let waiting: ServiceWorker | null = null
let installPrompt: InstallPromptEvent | null = null
let reloadOnSwitch = false

/**
 * 開いた直後で、まだ何も操作していないうちに新しい版が届いたら、知らせずにそのまま切り替える。
 * Service Worker が入ったあとは、ブラウザの再読み込みだけでは新しい版に切り替わらないので、
 * 「再読み込みしたのに古いまま」を防ぐため。作業を始めたあとに届いたときは知らせて、押してもらう
 */
const QUIET_SWITCH_MS = 10_000
const openedAt = performance.now()
let interacted = false
for (const type of ['pointerdown', 'keydown']) {
  window.addEventListener(type, () => (interacted = true), { capture: true, once: true })
}
const canSwitchQuietly = () => !interacted && performance.now() - openedAt < QUIET_SWITCH_MS

function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}

export function startPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    // ブラウザの小さなお知らせ帯は出さず、画面の「アプリとして入れる」から入れてもらう
    e.preventDefault()
    installPrompt = e as InstallPromptEvent
    set({ canInstall: true })
  })
  window.addEventListener('appinstalled', () => {
    installPrompt = null
    set({ canInstall: false })
  })

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnSwitch) location.reload()
  })
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then((reg) => {
      const watch = (sw: ServiceWorker | null) => {
        if (!sw) return
        const check = () => {
          // 初めて入れたとき（まだ制御されていない）は知らせない。古い版から切り替わるときだけ
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = sw
            if (canSwitchQuietly()) applyUpdate()
            else set({ updateReady: true })
          }
        }
        check()
        sw.addEventListener('statechange', check)
      }
      watch(reg.waiting)
      reg.addEventListener('updatefound', () => watch(reg.installing))
      // アプリとして開きっぱなしにされても、画面に戻ってきたときに新しい版を確かめる
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {})
      })
    })
    .catch(() => {
      // 登録に失敗してもネットがあれば使えるので、画面は止めない
    })
}

/** 新しい版に切り替えて読み直す。直前の編集の自動保存（0.4 秒後）が終わるのを待ってから切り替える */
export function applyUpdate() {
  if (!waiting) return
  reloadOnSwitch = true
  const sw = waiting
  setTimeout(() => sw.postMessage({ type: 'SKIP_WAITING' }), 600)
}

export async function install() {
  if (!installPrompt) return
  await installPrompt.prompt()
  await installPrompt.userChoice
  installPrompt = null
  set({ canInstall: false })
}

/** iPhone・iPad の Safari は、ホーム画面への追加を共有メニューからしかできない */
export const needsIosHint = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone
