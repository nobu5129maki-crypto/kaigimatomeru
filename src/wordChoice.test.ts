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

  it('例文と、一度選んだ文は変えない', () => {
    expect(chooseWords(SAMPLE_TRANSCRIPT)).toBe(SAMPLE_TRANSCRIPT)
    const fixed = chooseWords('首都高の重大を確認しました。')
    expect(chooseWords(fixed)).toBe(fixed)
  })
})
