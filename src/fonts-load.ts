// 同梱フォントの @font-face。どれも文字のまとまりごとに分割された woff2 で、実際に使う文字の分だけ読み込まれる。
// CSS の @import ではなくここから読み込むのは、vite.config.ts の woff 除去を各ファイルに効かせるため
import '@fontsource/zen-maru-gothic/400.css'
import '@fontsource/zen-maru-gothic/700.css'
import '@fontsource/dela-gothic-one/400.css'
import '@fontsource/klee-one/400.css'
import '@fontsource/klee-one/600.css'
import '@fontsource/yomogi/400.css'
import '@fontsource/dotgothic16/400.css'
import '@fontsource/rocknroll-one/400.css'
