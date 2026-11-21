import { describe, expect, it } from 'vitest'
import { appendPiece, appendRecognized, audioFileName, formatClock, pickRecordingFormat } from './capture'

describe('録音の文字', () => {
  it('聞き直しで重なった末尾を足さない', () => {
    expect(appendRecognized('価格は980円です', '980円です。粗利が薄いです')).toBe('価格は980円です。粗利が薄いです')
  })

  it('重なりがなければそのまま続ける', () => {
    expect(appendRecognized('原価は620円です。', '広告費が重いです。')).toBe('原価は620円です。広告費が重いです。')
  })

  it('間が空いたら段落を分ける', () => {
    expect(appendPiece('原価は620円です。', '980円だと薄いです。', 2000)).toBe('原価は620円です。\n980円だと薄いです。')
    expect(appendPiece('原価は620円です。', '980円だと薄いです。', 400)).toBe('原価は620円です。980円だと薄いです。')
  })

  it('長い会議の時刻を出す', () => {
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(3661)).toBe('1:01:01')
  })

  it('音声ファイル名から使えない文字を除く', () => {
    expect(audioFileName('発売/会議', '2026-11-21', 'webm')).toBe('発売 会議_2026-11-21.webm')
  })

  it('録音形式を例外なく選ぶ', () => {
    const format = pickRecordingFormat()
    expect(format.extension.length).toBeGreaterThan(0)
  })
})
