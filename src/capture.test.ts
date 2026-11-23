import { describe, expect, it } from 'vitest'
import {
  appendPiece,
  appendRecognized,
  audioFileName,
  formatClock,
  heardAlready,
  liveTranscript,
  mergeHeard,
  pickRecordingFormat,
  roomMicConstraints,
} from './capture'

describe('録音の文字', () => {
  it('聞き直しで重なった末尾を足さない', () => {
    expect(appendRecognized('価格は980円です', '980円です。粗利が薄いです')).toBe('価格は980円です。粗利が薄いです')
  })

  it('重なりがなければそのまま続ける', () => {
    expect(appendRecognized('原価は620円です。', '広告費が重いです。')).toBe('原価は620円です。広告費が重いです。')
  })

  it('認識中の言葉を文字起こし欄へ足す', () => {
    expect(liveTranscript('価格は', '980円')).toBe('価格は980円')
    expect(liveTranscript('価格は980円です', '980円です。粗利')).toBe('価格は980円です。粗利')
    expect(liveTranscript('価格は980円です', '')).toBe('価格は980円です')
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

  it('自分の声と重なるラジオの聞き直しは足さない', () => {
    expect(heardAlready('価格は980円に決定しました。', '980円に決定しました')).toBe(true)
    expect(heardAlready('私の声です。', '本日の会議では初回価格を980円に決定しました。')).toBe(false)
  })

  it('スピーカーの音は、自分の声の次の行に足す', () => {
    expect(mergeHeard('私の声です。', '本日は980円に決定しました。')).toBe('私の声です。\n本日は980円に決定しました。')
    expect(mergeHeard('私の声です。', '声です。続きです')).toBe('私の声です。続きです')
  })

  it('ラジオを消す処理をマイクで切る', () => {
    const audio = roomMicConstraints()
    expect(audio.echoCancellation).toBe(false)
    expect(audio.noiseSuppression).toBe(false)
    expect(audio.autoGainControl).toBe(true)
  })

  it('録音形式を例外なく選ぶ', () => {
    const format = pickRecordingFormat()
    expect(format.extension.length).toBeGreaterThan(0)
  })
})
