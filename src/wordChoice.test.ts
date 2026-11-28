import { describe, expect, it } from 'vitest'
import { SAMPLE_TRANSCRIPT } from './sample'
import { chooseWords } from './wordChoice'

describe('前後の文から語を選ぶ', () => {
  it('道路の文脈では重大を渋滞にする', () => {
    expect(chooseWords('首都高の重大を確認しました。')).toBe('首都高の渋滞を確認しました。')
  })

  it('問題の文脈では渋滞なを重大なにする', () => {
    expect(chooseWords('渋滞な問題だと確認しました。')).toBe('重大な問題だと確認しました。')
  })

  it('正しい語は並べたまま残す', () => {
    const text = '首都高は渋滞、その影響は重大です。'
    expect(chooseWords(text)).toBe(text)
  })

  it('病院の文脈では重体を渋滞にしない', () => {
    const text = '病院へ搬送され、重体です。'
    expect(chooseWords(text)).toBe(text)
  })

  it('価格の文脈では初会を初回にする', () => {
    expect(chooseWords('初会価格を980円に決定しました。')).toBe('初回価格を980円に決定しました。')
    expect(chooseWords('初回価格は980円です。')).toBe('初回価格は980円です。')
  })

  it('案が続く高校は広告にする', () => {
    expect(chooseWords('田中が高校案を出します。')).toBe('田中が広告案を出します。')
    expect(chooseWords('高校生が参加します。')).toBe('高校生が参加します。')
  })

  it('前の文が歌会なら単価を短歌にする', () => {
    expect(chooseWords('来月は歌会です。単価を一首詠みます。')).toBe('来月は歌会です。短歌を一首詠みます。')
    expect(chooseWords('歌会で詠んだ、単価を誌面に載せます。')).toBe('歌会で詠んだ、短歌を誌面に載せます。')
  })

  it('隣の文が円でも、歌の文の短歌は残す', () => {
    const text = '短歌を一首紹介します。会場費は500円です。'
    expect(chooseWords(text)).toBe(text)
    expect(chooseWords('印刷費は1枚10円です。短歌を歌会で詠みます。')).toBe('印刷費は1枚10円です。短歌を歌会で詠みます。')
  })

  it('同じ文の値段なら短歌を単価にし、歌の隣でも単価は残す', () => {
    expect(chooseWords('この部品の短歌は980円です。')).toBe('この部品の単価は980円です。')
    expect(chooseWords('部品の単価は40円です。歌会の案内は別紙です。')).toBe('部品の単価は40円です。歌会の案内は別紙です。')
  })

  it('前の文の道路で重大を渋滞にし、病院の次の重大は重体にする', () => {
    expect(chooseWords('首都高を通りました。重大を確認しました。')).toBe('首都高を通りました。渋滞を確認しました。')
    expect(chooseWords('病院へ搬送しました。重大です。')).toBe('病院へ搬送しました。重体です。')
  })

  it('例文と、一度選んだ文は変えない', () => {
    expect(chooseWords(SAMPLE_TRANSCRIPT)).toBe(SAMPLE_TRANSCRIPT)
    const fixed = chooseWords('首都高の重大を確認しました。')
    expect(chooseWords(fixed)).toBe(fixed)
  })
})
