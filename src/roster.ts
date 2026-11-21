export type Roster = {
  titles: string[]
  groups: string[]
  names: string[]
}

const TITLE_LIMIT = 8
const GROUP_LIMIT = 6
const NAME_LIMIT = 24

export function emptyRoster(): Roster {
  return { titles: [], groups: [], names: [] }
}

export function splitAttendees(value: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const part of value.split(/[、,，]/)) {
    const name = part.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

export function joinAttendees(names: string[]): string {
  return names.join('、')
}

export function toggleAttendee(current: string, name: string): string {
  const names = splitAttendees(current)
  const index = names.indexOf(name)
  if (index >= 0) names.splice(index, 1)
  else names.push(name)
  return joinAttendees(names)
}

function pushUnique(list: string[], value: string, limit: number): string[] {
  const next = value.trim()
  if (!next) return list
  return [next, ...list.filter((item) => item !== next)].slice(0, limit)
}

function addOnce(list: string[], value: string, limit: number): string[] {
  const next = value.trim()
  if (!next || list.includes(next)) return list
  return [next, ...list].slice(0, limit)
}

export function rememberRoster(roster: Roster, input: { title: string; attendees: string }): Roster {
  const people = splitAttendees(input.attendees)
  let names = roster.names
  for (const name of people) names = addOnce(names, name, NAME_LIMIT)
  return {
    titles: pushUnique(roster.titles, input.title, TITLE_LIMIT),
    groups: people.length > 1 ? pushUnique(roster.groups, joinAttendees(people), GROUP_LIMIT) : roster.groups,
    names,
  }
}

export function rosterFromHistory(items: { title: string; attendees: string }[]): Roster {
  let roster = emptyRoster()
  for (const item of [...items].reverse()) roster = rememberRoster(roster, item)
  return roster
}

export function combineRoster(saved: Roster, history: Roster): Roster {
  let roster = history
  for (const title of [...saved.titles].reverse()) roster = rememberRoster(roster, { title, attendees: '' })
  for (const group of [...saved.groups].reverse()) roster = rememberRoster(roster, { title: '', attendees: group })
  for (const name of [...saved.names].reverse()) roster = rememberRoster(roster, { title: '', attendees: name })
  return roster
}
