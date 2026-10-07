import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * 同梱フォントの CSS から、古い形式（woff）の指定を外す。
 * 対象ブラウザはどれも先に書かれた woff2 を使うので woff は読まれないが、
 * 指定が残っているとビルドに約900ファイル・19MB が余計に入るため。
 */
function woff2Only(): Plugin {
  return {
    name: 'fuda-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@fontsource') || !id.endsWith('.css')) return
      return code.replace(/,\s*url\([^)]+\.woff\) format\('woff'\)/g, '')
    },
  }
}

/**
 * 公開版に Content Security Policy を入れ、「デザインを端末の外に出さない」をブラウザに守らせる。
 * connect-src 'none' で fetch / XHR / WebSocket などの通信はすべて拒否される（送る処理を書いていない、だけに頼らない）。
 * GitHub Pages はレスポンスヘッダーを設定できないので <meta> で入れる（そのため frame-ancestors は使えない）。
 * 開発サーバーは更新の通知に WebSocket を使うので、ビルドのときだけ入れる。
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  // 同梱フォントのうち小さい分割ファイルは、ビルド時に CSS へ data: で埋め込まれる
  "font-src 'self' data:",
  "img-src 'self' data:",
  "connect-src 'none'",
  // アプリとして入れるための manifest と、電波がなくても開くための Service Worker だけは、自分のサイトから読ませる
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'fuda-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      // 文字コードの指定より後ろに置く（文字コードは先頭 1024 バイト以内で宣言する必要がある）
      handler: (html) => html.replace('<meta charset="UTF-8" />', `$&\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  }
}

/**
 * ビルドで出たファイルを列挙した sw.js を書き出す。
 * 本体（HTML・JS・CSS・アイコンなど）はインストール時にすべて取り込み、電波がなくても開けるようにする。
 * 同梱フォントは約930ファイル・16MB あり、全部取り込むとスマホには重いので、使った分だけ sw.js が残す。
 */
function serviceWorker(base: string): Plugin {
  return {
    name: 'fuda-service-worker',
    apply: 'build',
    writeBundle(options) {
      const outDir = options.dir!
      const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile() && d.name !== 'sw.js')
        .map((d) => join(d.parentPath, d.name))
      // 版の名前は、フォントも含めた全ファイルの中身から決める（どれかが変われば新しい版になる）
      const hash = createHash('sha256')
      for (const f of files.sort()) hash.update(readFileSync(f))
      const precache = files
        .filter((f) => !f.endsWith('.woff2'))
        .map((f) => base + f.slice(outDir.length + 1).replaceAll('\\', '/'))
        .sort()
      writeFileSync(
        join(outDir, 'sw.js'),
        readFileSync('sw-template.js', 'utf8')
          .replace('__VERSION__', hash.digest('hex').slice(0, 12))
          .replace('__BASE__', JSON.stringify(base))
          .replace('__PRECACHE__', JSON.stringify([base, ...precache])),
      )
    },
  }
}

const base = process.env.BASE_PATH ?? '/'

/**
 * 画面に出す版の名前（ビルドした日時〈日本時間〉と、コミットの短い ID）。
 * 古い版のまま動いていないかを利用者が確かめたり、不具合を伝えるときに添えたりするため
 */
function buildVersion(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60_000)
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())} ${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}`
  let sha = process.env.GITHUB_SHA?.slice(0, 7) ?? ''
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      // git のない所でビルドしても、日時だけは出す
    }
  }
  return sha ? `${date}（${sha}）` : date
}

// GitHub Pages ではリポジトリ名の下（/fuda/）で配信されるので、CI から BASE_PATH で渡す
export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(buildVersion()) },
  plugins: [woff2Only(), contentSecurityPolicy(), serviceWorker(base), react()],
})
