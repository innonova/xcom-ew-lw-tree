import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave } from '@/save/parse'
import { readCampaign, type Campaign, type CouncilState } from '@/save/campaign'
import { councilOperations, lwrChance } from '../operations'

const campaignOf = (path: string) => readCampaign(parseSave(new Uint8Array(readFileSync(path))))
const fixture = (f: string) => campaignOf(resolve(__dirname, '../../../fixtures/saves', f))
const states = (c: Campaign) =>
  councilOperations(c)!.map((o) => o.missions.map((m) => `${m.name}: ${m.state}`))

describe('the operations, read from saves', () => {
  it('a finished campaign: Slingshot played through, Progeny won (save1738)', () => {
    const [sling, prog] = councilOperations(fixture('save1738'))!
    expect(sling!.missions.map((m) => m.state)).toEqual(['won', 'won', 'played'])
    expect(sling!.note).toMatch(/does not say whether Gangplank was won/)
    expect(prog!.missions.map((m) => m.state)).toEqual(['won', 'won', 'won'])
    expect(prog!.note).toBe('Over: Furies won.')
  })

  it('in March: Low Friends on 5 May; Portent waits for April (save1760, 16 March)', () => {
    const c = fixture('save1760')
    const [sling, prog] = councilOperations(c)!
    expect(sling!.missions[0]).toMatchObject({ state: 'next', when: '5 May (in 50 days).' })
    expect(sling!.missions[1]!.when).toBe('25 days after Low Friends is won.')
    expect(prog!.missions[0]).toMatchObject({ state: 'next' })
    expect(prog!.missions[0]!.when).toBe('From April: the council mission 15–29 April.')
    expect(prog!.missions[1]!.when).toMatch(/Psi Labs built, from October/)
  })

  it('March after the month’s council mission: the next one is April’s, and that is Portent (save1761)', () => {
    const prog = councilOperations(fixture('save1761'))![1]!
    expect(prog.missions[0]!.when).toBe('It will be the next council mission, 15–29 April.')
  })

  it('LWR at its start: Portent rolled from May, surely by August (lwr-save1740)', () => {
    const c = fixture('lwr-save1740')
    expect(c.game).toBe('lwr')
    const [sling, prog] = councilOperations(c)!
    expect(sling!.missions[0]).toMatchObject({ state: 'next', when: '5 May (in 65 days).' })
    expect(prog!.missions[0]!.when).toBe(
      'Not before May; at a council mission, surely from August.',
    )
  })
})

// The sample saves (not in the repository): a campaign in July and August.
const july = resolve(__dirname, '../../../samples/savedata/save100')
const august = resolve(__dirname, '../../../samples/savedata/save1035')
describe.skipIf(!existsSync(july) || !existsSync(august))(
  'the operations in a campaign’s summer',
  () => {
    it('July: Gangplank on the map with 8 hours left; Portent won, Deluge next', () => {
      const c = campaignOf(july)
      expect(states(c)).toEqual([
        ['Low Friends: won', 'Confounding Light: won', 'Gangplank: map'],
        ['Portent: won', 'Deluge: next', 'Furies: later'],
      ])
      expect(councilOperations(c)![0]!.missions[2]!.when).toBe('On the map now, 8 hours left.')
    })

    it('August: Slingshot over; Deluge as the game decides it', () => {
      const c = campaignOf(august)
      expect(states(c)[0]).toEqual([
        'Low Friends: won',
        'Confounding Light: won',
        'Gangplank: played',
      ])
      expect(states(c)[1]).toEqual(['Portent: won', 'Deluge: next', 'Furies: later'])
    })
  },
)

/** A campaign in a given state, the rest as the reader leaves an empty save. */
function campaign(
  game: 'lw' | 'lwr',
  date: [number, number, number],
  council: Partial<CouncilState>,
  psiLabs = false,
): Campaign {
  const facilities: number[] = []
  facilities[17] = psiLabs ? 1 : 0
  return {
    game,
    date: { year: date[0], month: date[1], day: date[2] },
    campaignDay: 0,
    tactical: false,
    baseFacilities: facilities,
    council: {
      slingshotOn: true,
      progenyOn: true,
      nextSlingshot: 'Slingshot_LowFriends',
      lastSlingshot: 'SLINGSHOT_START',
      nextSlingshotDay: -1,
      nextProgeny: 'Progeny_Portent',
      furiesWon: false,
      countdownHours: 9999,
      past: [],
      onMap: [],
      start: { year: date[0] >= 2030 ? 2030 : 2016, month: 3, day: 1 },
      ...council,
    },
  } as unknown as Campaign
}

describe('the rules', () => {
  it('Slingshot: the next mission’s day, counted from the start; a past day is due now', () => {
    const c = campaign('lw', [2016, 6, 1], {
      nextSlingshot: 'Slingshot_ConfoundingLight',
      lastSlingshot: 'Slingshot_LowFriends',
      nextSlingshotDay: 100,
    })
    expect(councilOperations(c)![0]!.missions[1]).toMatchObject({
      state: 'next',
      when: '9 June (in 8 days).',
    })
    const late = campaign('lw', [2016, 6, 20], { ...c.council!, nextSlingshotDay: 100 })
    expect(councilOperations(late)![0]!.missions[1]!.when).toMatch(/^Due now/)
  })

  it('Slingshot: a mission lost ends the chain there', () => {
    const c = campaign('lw', [2016, 6, 1], {
      nextSlingshot: 'SLINGSHOT_END',
      lastSlingshot: 'Slingshot_ConfoundingLight',
    })
    const op = councilOperations(c)![0]!
    expect(op.missions.map((m) => m.state)).toEqual(['won', 'lost', 'ended'])
    expect(op.note).toBe('Ended: Confounding Light was failed or left to expire.')
  })

  it('Progeny lost at Deluge: found in the council’s list of past missions', () => {
    const c = campaign('lw', [2016, 11, 1], {
      nextProgeny: 'PROGENY_END',
      past: ['None', 'Progeny_Portent', 'HighwayRescue', 'Progeny_Deluge'],
    })
    expect(councilOperations(c)![1]!.missions.map((m) => m.state)).toEqual(['won', 'lost', 'ended'])
  })

  it('LW: Deluge waits for the Psi Labs, then for October', () => {
    const base = { nextProgeny: 'Progeny_Deluge', countdownHours: 100 }
    const noLabs = councilOperations(campaign('lw', [2016, 11, 2], base))![1]!
    expect(noLabs.missions[1]!.when).toMatch(/^Needs the Psi Labs built/)
    expect(noLabs.note).toBeUndefined()
    const summer = councilOperations(campaign('lw', [2016, 7, 2], base, true))![1]!
    expect(summer.missions[1]!.when).toBe('From October: the council mission 15–29 October.')
    const autumn = councilOperations(campaign('lw', [2016, 10, 2], base, true))![1]!
    expect(autumn.missions[1]).toMatchObject({
      state: 'next',
      when: 'It will be the next council mission, about 6 October (in 4 days).',
    })
  })

  it('LWR: the rolls at each council mission', () => {
    // Months from March (0): Portent from May (2), surely from August (5).
    expect([1, 2, 3, 4, 5].map((m) => lwrChance('Portent', m))).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect([4, 5, 6, 7].map((m) => lwrChance('later', m))).toEqual([0, 1 / 3, 2 / 3, 1])
    const june = councilOperations(campaign('lwr', [2030, 6, 10], { countdownHours: 48 }))![1]!
    expect(june.missions[0]!.when).toBe(
      'Perhaps the next council mission, about 12 June (in 2 days): a 50% chance, rolled at each council mission; surely from August.',
    )
  })

  it('an operation switched off says so', () => {
    const op = councilOperations(campaign('lw', [2016, 4, 1], { slingshotOn: false }))![0]!
    expect(op.on).toBe(false)
    expect(op.note).toMatch(/switched off when the campaign started/)
  })
})
