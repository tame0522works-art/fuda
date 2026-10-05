import react from '@vitejs/plugin-react'
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

// GitHub Pages ではリポジトリ名の下（/fuda/）で配信されるので、CI から BASE_PATH で渡す
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [woff2Only(), react()],
})
