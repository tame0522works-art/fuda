// 行頭に来てはいけない文字（句読点・閉じ括弧・小書きの仮名など）。行からはみ出しても前の行の末尾にぶら下げる
const NO_LINE_START = new Set('、。，．,.・：；？！?!ー〜～）)」』】〕〉》］]｝}ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々')
// 行末に来てはいけない文字（開き括弧）。次の行の頭へ送る
const NO_LINE_END = new Set('（(「『【〔〈《［[｛{')

const isWordChar = (c: string) => /[A-Za-z0-9]/.test(c)

/**
 * 日本語は単語の区切りがないので1文字ずつ詰め、禁則だけ守る。
 * 英数字の並び（"700" や "Vol2"）は途中で折らない。
 * measure は文字列の幅を maxWidth と同じ単位で返す関数（ブラウザでは canvas、検証ではダミー）。
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const chars = [...para]
    const start = out.length
    let line = ''
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i]
      if (line === '' || measure(line + c) <= maxWidth) {
        line += c
        continue
      }
      if (NO_LINE_START.has(c)) {
        line += c
        while (i + 1 < chars.length && NO_LINE_START.has(chars[i + 1])) line += chars[++i]
        out.push(line)
        line = ''
        continue
      }
      let carry = ''
      const lineChars = [...line]
      if (isWordChar(c)) {
        let j = lineChars.length
        while (j > 0 && isWordChar(lineChars[j - 1])) j--
        // 行全体が1語なら折るしかない
        if (j > 0) carry = lineChars.splice(j).join('')
      }
      while (lineChars.length > 1 && NO_LINE_END.has(lineChars[lineChars.length - 1])) {
        carry = lineChars.pop()! + carry
      }
      out.push(lineChars.join(''))
      line = carry + c
    }
    // 段落末の句点をぶら下げた直後は line が空なので、空行を足さない（空の段落そのものは1行として残す）
    if (line !== '' || out.length === start) out.push(line)
  }
  return out
}
