/// <reference lib="webworker" />
/**
 * 書き出しの Worker。300dpi の描画・圧縮・PDF 作りを画面とは別の裏側で行い、書き出し中も画面を止めない。
 * 描く処理そのものは画面側と同じ output.ts を使う（どちらで描いても同じ結果になるように）。
 */
import type { ExportRequest, ExportResponse } from './exporter'
import { exportCardsPdf, exportPng, exportPopPdf } from './output'

const scope = self as unknown as DedicatedWorkerGlobalScope & { fonts?: FontFaceSet }
const post = (msg: ExportResponse, transfer: Transferable[] = []) => scope.postMessage(msg, transfer)

// 同じ書体を何度も登録しないよう、登録済みのものを覚えておく
const registered = new Set<string>()

scope.onmessage = async (e: MessageEvent<ExportRequest>) => {
  const { id, job, images, faces } = e.data
  // Worker の中で canvas と書体を扱えないブラウザでは、画面側で書き出してもらう
  if (typeof OffscreenCanvas === 'undefined' || !scope.fonts || typeof FontFace === 'undefined') {
    post({ id, type: 'unsupported' })
    return
  }
  try {
    // 同梱フォントは画面側の CSS で読み込んでいて Worker からは見えないので、同じ読み込み先を登録し直す
    for (const f of faces) {
      const key = JSON.stringify(f)
      if (registered.has(key)) continue
      scope.fonts.add(new FontFace(f.family, f.src, { weight: f.weight, style: f.style, unicodeRange: f.unicodeRange }))
      registered.add(key)
    }
    const imageMap = new Map(images)
    const onProgress = (done: number, total: number) => post({ id, type: 'progress', done, total })
    if (job.kind === 'png') {
      post({ id, type: 'done', blob: await exportPng(job.doc, imageMap), pages: [] })
    } else {
      const pdf =
        job.kind === 'pop'
          ? await exportPopPdf(job.doc, imageMap, { preview: true })
          : await exportCardsPdf(job.card, job.items, imageMap, { preview: true, onProgress })
      // 確認画面用の画像は写さずに渡す（大きいので）
      post({ id, type: 'done', blob: pdf.blob, pages: pdf.pages }, pdf.pages.map((p) => p.bitmap))
    }
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
