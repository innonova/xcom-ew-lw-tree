// Operation Slingshot and Operation Progeny (features/council-operations.md):
// which missions are won, which is on the map, and when the next comes, by the
// game's own rules (XGFundingCouncil in Long War 1.0's and LWR 2.06's
// XComStrategyGame.upk).

import enumData from '../../data/enums.json'
import type { Campaign, CouncilState } from '@/save/campaign'

export type MissionState = 'won' | 'map' | 'next' | 'later' | 'lost' | 'played' | 'ended'

export interface OperationMission {
  /** The game's name without eFCM_ ("Slingshot_LowFriends"). */
  id: string
  name: string
  state: MissionState
  /** What to expect, in a sentence. */
  when?: string
  /** For a next mission with a known time: the game date (UTC). */
  at?: Date
}

export interface Operation {
  name: string
  /** The council country that asks for it. */
  country: string
  on: boolean
  missions: OperationMission[]
  /** Said under the missions: how the chain ended, or why it never started. */
  note?: string
}

const SLINGSHOT = [
  ['Slingshot_LowFriends', 'Low Friends'],
  ['Slingshot_ConfoundingLight', 'Confounding Light'],
  ['Slingshot_Gangplank', 'Gangplank'],
] as const
const PROGENY = [
  ['Progeny_Portent', 'Portent'],
  ['Progeny_Deluge', 'Deluge'],
  ['Progeny_Furies', 'Furies'],
] as const

/** XGFundingCouncil's defaults, the same in LW and LWR (no INI sets them). */
const LOWFRIENDS_START_DAY = 65
const CNFNDLIGHT_DAYS = 25
const GANGPLANK_DAYS = 2
/** m_iFirstRequestCountdown from here up: no more council missions this month. */
const NONE_THIS_MONTH = 9000
const PSI_LABS = (enumData.enums.EFacilityType as string[]).indexOf('eFacility_PsiLabs')

const DAY = 86_400_000
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const dateText = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
const inDays = (from: Date, to: Date) => {
  const n = Math.round((to.getTime() - from.getTime()) / DAY)
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`
}
const hoursLeft = (halfHours: number) => {
  const h = Math.max(0, Math.round(halfHours / 2))
  return h === 1 ? '1 hour left' : `${h} hours left`
}
/** The game's month count (XGStrategyAI.GetMonth): calendar months since the start, March being 0. */
const monthIndex = (start: Date, at: Date) =>
  (at.getUTCFullYear() - start.getUTCFullYear()) * 12 + at.getUTCMonth() - start.getUTCMonth()
/** The first day of the month with that index. */
const monthStart = (start: Date, index: number) =>
  new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1))
const monthName = (start: Date, index: number) => MONTHS[monthStart(start, index).getUTCMonth()]!

/**
 * LWR's rolls, per council mission (DetermineNewFCMission): Portent when the
 * month is at least 2 + Rand(4), or past 4 + Rand(3); Deluge and Furies only
 * past 4 + Rand(3).
 */
export function lwrChance(mission: 'Portent' | 'later', month: number): number {
  const late = Math.min(Math.max(month - 4, 0), 3) / 3
  if (mission === 'later') return late
  const early = Math.min(Math.max(month - 1, 0), 4) / 4
  return 1 - (1 - early) * (1 - late)
}

export function councilOperations(c: Campaign): Operation[] | undefined {
  const k = c.council
  if (!k || !c.date) return undefined
  const fraction = (c.campaignDay ?? 0) % 1
  const now = new Date(Date.UTC(c.date.year, c.date.month - 1, c.date.day) + fraction * DAY)
  const start = k.start
    ? new Date(Date.UTC(k.start.year, k.start.month - 1, k.start.day))
    : new Date(Date.UTC(c.date.year, 2, 1))
  const onMap = (id: string) => k.onMap.find((m) => m.mission === id)
  return [slingshot(k, now, start, onMap, c.tactical), progeny(k, c, now, start, onMap)]
}

function slingshot(
  k: CouncilState,
  now: Date,
  start: Date,
  onMap: (id: string) => { halfHours: number } | undefined,
  tactical: boolean,
): Operation {
  const op: Operation = {
    name: 'Operation Slingshot',
    country: 'China',
    on: k.slingshotOn,
    missions: [],
  }
  if (!k.slingshotOn) {
    op.note = 'Not in this campaign: it was switched off when the campaign started.'
    return op
  }
  const next = SLINGSHOT.findIndex(([id]) => id === k.nextSlingshot)
  const last = SLINGSHOT.findIndex(([id]) => id === k.lastSlingshot)
  SLINGSHOT.forEach(([id, name], j) => {
    const m: OperationMission = { id, name, state: 'later' }
    if (next < 0) {
      // The chain is over: won through, or ended where it was lost.
      if (j < last) m.state = 'won'
      else if (j === last) m.state = j === 2 ? 'played' : 'lost'
      else m.state = 'ended'
    } else if (j < next) m.state = 'won'
    else if (j === next) {
      const map = onMap(id)
      if (map) {
        m.state = 'map'
        m.when = `On the map now, ${hoursLeft(map.halfHours)}.`
      } else if (k.lastSlingshot === id) {
        m.state = 'map'
        m.when = tactical ? 'Being played in this save.' : 'Under way.'
      } else {
        m.state = 'next'
        const after = j === 0 ? 0 : j === 1 ? CNFNDLIGHT_DAYS : GANGPLANK_DAYS
        if (k.nextSlingshotDay >= 0 || j === 0) {
          const day = k.nextSlingshotDay >= 0 ? k.nextSlingshotDay : LOWFRIENDS_START_DAY
          m.at = new Date(start.getTime() + day * DAY)
          m.when =
            m.at <= now
              ? 'Due now: it comes within the half hour, once no aircraft is out.'
              : `${dateText(m.at)} (${inDays(now, m.at)}).`
        } else {
          // Won within the half hour: the game's next check (every half hour) sets the day.
          m.at = new Date(now.getTime() + after * DAY)
          m.when = `About ${dateText(m.at)} (${after} days after the last one was won).`
        }
      }
    } else {
      m.when =
        j === 1
          ? `${CNFNDLIGHT_DAYS} days after Low Friends is won.`
          : `${GANGPLANK_DAYS} days after Confounding Light is won.`
    }
    op.missions.push(m)
  })
  if (next < 0)
    op.note =
      last === 2
        ? 'Over. The save does not say whether Gangplank was won: it gives no council reward.'
        : `Ended: ${SLINGSHOT[last]?.[1] ?? 'a mission'} was failed or left to expire.`
  return op
}

function progeny(
  k: CouncilState,
  c: Campaign,
  now: Date,
  start: Date,
  onMap: (id: string) => { halfHours: number } | undefined,
): Operation {
  const op: Operation = {
    name: 'Operation Progeny',
    country: 'France',
    on: k.progenyOn,
    missions: [],
  }
  if (!k.progenyOn) {
    op.note = 'Not in this campaign: it was switched off when the campaign started.'
    return op
  }
  const lwr = c.game === 'lwr'
  const psiLabs = (c.baseFacilities[PSI_LABS] ?? 0) > 0
  const next = PROGENY.findIndex(([id]) => id === k.nextProgeny)
  // Over without Furies won: the last Progeny mission that came is where it was lost.
  const lostAt =
    next < 0 && !k.furiesWon
      ? Math.max(
          ...PROGENY.map(([id]) =>
            k.past.lastIndexOf(id) >= 0 ? PROGENY.findIndex(([p]) => p === id) : -1,
          ),
        )
      : -1
  // The next council mission: within this month's countdown, else next month's window.
  const thisMonth = k.countdownHours < NONE_THIS_MONTH
  const council = thisMonth ? new Date(now.getTime() + k.countdownHours * 3_600_000) : undefined
  const nextMonth = monthIndex(start, now) + 1
  const window = (index: number) => {
    const first = monthStart(start, index)
    return `15–29 ${MONTHS[first.getUTCMonth()]}`
  }
  const councilText = council
    ? `the next council mission, about ${dateText(council)} (${inDays(now, council)})`
    : `the next council mission, ${window(nextMonth)}`
  const councilMonth = council ? monthIndex(start, council) : nextMonth

  PROGENY.forEach(([id, name], j) => {
    const m: OperationMission = { id, name, state: 'later' }
    if (next < 0) {
      if (k.furiesWon || j < lostAt) m.state = 'won'
      else if (j === lostAt) m.state = 'lost'
      else m.state = 'ended'
    } else if (j < next) m.state = 'won'
    else if (j === next) {
      const map = onMap(id)
      if (map) {
        m.state = 'map'
        m.when = `On the map now, ${hoursLeft(map.halfHours)}.`
      } else {
        m.state = 'next'
        m.when = lwr
          ? lwrNext(j, councilMonth, councilText, start)
          : lwNext(j, psiLabs, councilMonth, councilText, council, start)
        if (council && m.when.startsWith('It will be')) m.at = council
      }
    } else {
      m.when = lwr
        ? `After ${PROGENY[j - 1]![1]}, at a council mission: not before ${monthName(start, 5)}, surely from ${monthName(start, 7)}.`
        : `After ${PROGENY[j - 1]![1]}: the first council mission with the Psi Labs built, from ${monthName(start, 7)}.`
    }
    op.missions.push(m)
  })
  if (next < 0)
    op.note = k.furiesWon
      ? 'Over: Furies won.'
      : `Ended: ${PROGENY[lostAt]?.[1] ?? 'a mission'} was failed or left to expire.`
  return op
}

/** Long War 1.0: Portent from April; Deluge and Furies with the Psi Labs, from October. */
function lwNext(
  j: number,
  psiLabs: boolean,
  month: number,
  councilText: string,
  council: Date | undefined,
  start: Date,
): string {
  const from = j === 0 ? 1 : 7
  if (j > 0 && !psiLabs)
    return `Needs the Psi Labs built; then the first council mission from ${monthName(start, from)} on.`
  if (month >= from) return `It will be ${councilText}.`
  return `From ${monthName(start, from)}: the council mission 15–29 ${monthName(start, from)}.`
}

/** LWR 2.06: each council mission rolls (lwrChance). */
function lwrNext(j: number, month: number, councilText: string, start: Date): string {
  const chance = lwrChance(j === 0 ? 'Portent' : 'later', month)
  const [first, sure] = j === 0 ? [2, 5] : [5, 7]
  if (chance >= 1) return `It will be ${councilText}.`
  if (chance <= 0)
    return `Not before ${monthName(start, first)}; at a council mission, surely from ${monthName(start, sure)}.`
  return `Perhaps ${councilText}: a ${Math.round(chance * 100)}% chance, rolled at each council mission; surely from ${monthName(start, sure)}.`
}
