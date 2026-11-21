import { describe, expect, it } from 'vitest'
import { combineRoster, emptyRoster, rememberRoster, rosterFromHistory, splitAttendees, toggleAttendee } from './roster'

describe('会議名と出席者の記憶', () => {
  it('出席者を読点で分け、同じ名前は一度だけにする', () => {
    expect(splitAttendees(' 佐藤、田中, 佐藤，鈴木 ')).toEqual(['佐藤', '田中', '鈴木'])
  })

  it('名前をタップすると、入ったり外れたりする', () => {
    expect(toggleAttendee('', '佐藤')).toBe('佐藤')
    expect(toggleAttendee('佐藤、田中', '鈴木')).toBe('佐藤、田中、鈴木')
    expect(toggleAttendee('佐藤、田中', '佐藤')).toBe('田中')
  })

  it('会議名と顔ぶれは、新しいものを先に残す', () => {
    const once = rememberRoster(emptyRoster(), { title: '発売会議', attendees: '佐藤、田中' })
    const twice = rememberRoster(once, { title: '週次', attendees: '田中' })
    expect(twice.titles).toEqual(['週次', '発売会議'])
    expect(twice.groups).toEqual(['佐藤、田中'])
    expect(twice.names.slice(0, 2)).toEqual(['田中', '佐藤'])
  })

  it('過去のまとめからも、会議名と出席者を拾う', () => {
    const history = rosterFromHistory([
      { title: '週次', attendees: '佐藤、田中' },
      { title: '発売会議', attendees: '鈴木' },
    ])
    const saved = rememberRoster(emptyRoster(), { title: '週次', attendees: '高橋' })
    const roster = combineRoster(saved, history)
    expect(roster.titles[0]).toBe('週次')
    expect(roster.titles).toContain('発売会議')
    expect(roster.names[0]).toBe('高橋')
    expect(roster.groups).toContain('佐藤、田中')
  })
})