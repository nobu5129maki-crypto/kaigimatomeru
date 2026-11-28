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

  it('専門知識の公布は豊富にし、法律の公布は残す', () => {
    expect(chooseWords('公布な専門知識を持っています。')).toBe('豊富な専門知識を持っています。')
    expect(chooseWords('豊富な経験があります。')).toBe('豊富な経験があります。')
    expect(chooseWords('法律は本日公布されました。')).toBe('法律は本日公布されました。')
  })

  it('発見された自体は遺体にし、問題自体は残す', () => {
    expect(chooseWords('現場で自体が発見されました。')).toBe('現場で遺体が発見されました。')
    expect(chooseWords('問題自体は残っています。')).toBe('問題自体は残っています。')
    expect(chooseWords('会議自体は続行します。')).toBe('会議自体は続行します。')
    expect(chooseWords('発見自体は問題です。')).toBe('発見自体は問題です。')
  })

  it('学校の女子制度は女子生徒にし、改正する制度は残す', () => {
    expect(chooseWords('高校の授業に女子制度が参加します。')).toBe('高校の授業に女子生徒が参加します。')
    expect(chooseWords('先生が話しました。女子制度が来ます。')).toBe('先生が話しました。女子生徒が来ます。')
    expect(chooseWords('新しい女子制度を改正します。')).toBe('新しい女子制度を改正します。')
  })

  it('会見の報道時は報道陣にし、時刻の報道時は残す', () => {
    expect(chooseWords('会見には報道時が集まりました。')).toBe('会見には報道陣が集まりました。')
    expect(chooseWords('報道時の時刻を確認します。')).toBe('報道時の時刻を確認します。')
  })

  it('講座の公主は講師にし、王朝の公主は残す', () => {
    expect(chooseWords('講座の公主が説明します。')).toBe('講座の講師が説明します。')
    expect(chooseWords('講師が講義をします。')).toBe('講師が講義をします。')
    expect(chooseWords('王朝の公主が登場します。')).toBe('王朝の公主が登場します。')
  })

  it('講座のアダムセは受講生にする', () => {
    expect(chooseWords('この講座のアダムセは30人です。')).toBe('この講座の受講生は30人です。')
    expect(chooseWords('講座ではアダムセです。')).toBe('講座では受講生です。')
    expect(chooseWords('受講生は30人です。')).toBe('受講生は30人です。')
    const fixed = chooseWords('この講座のアダムセは30人です。')
    expect(chooseWords(fixed)).toBe(fixed)
  })

  it('同じ話の取り違えをまとめて直す', () => {
    const text = [
      '公布な専門知識を紹介します。',
      '現場で自体が発見されました。問題自体は残します。',
      '高校の授業に女子制度が参加します。',
      '会見には報道時が集まりました。',
      '講座の公主が説明します。',
      'この講座のアダムセは30人です。',
    ].join('')
    const fixed = [
      '豊富な専門知識を紹介します。',
      '現場で遺体が発見されました。問題自体は残します。',
      '高校の授業に女子生徒が参加します。',
      '会見には報道陣が集まりました。',
      '講座の講師が説明します。',
      'この講座の受講生は30人です。',
    ].join('')
    expect(chooseWords(text)).toBe(fixed)
    expect(chooseWords(fixed)).toBe(fixed)
  })

  it('例文と、一度選んだ文は変えない', () => {
    expect(chooseWords(SAMPLE_TRANSCRIPT)).toBe(SAMPLE_TRANSCRIPT)
    const fixed = chooseWords('首都高の重大を確認しました。')
    expect(chooseWords(fixed)).toBe(fixed)
  })
})
