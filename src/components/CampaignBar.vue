<script setup lang="ts">
// One line about the loaded campaign: where it stands and how fast it researches.

import { computed, ref } from 'vue'
import { difficultyName } from '@/save/campaign'
import {
  blockedContinents,
  countryName,
  EXPERTISE,
  WE_HAVE_WAYS,
  type Bonus,
} from '@/model/bonuses'
import { pointsPerHour, projectEtaDays } from '@/model/research'
import { campaignStats } from '@/model/stats'
import { councilOperations, type MissionState } from '@/model/operations'
import {
  bonuses,
  campaign,
  credits,
  showTech,
  state,
  techById,
  techs,
  game,
  bonusIds,
} from '@/state/store'
import { categoryFor } from '@/model/airwar'
import { monthlyEconomy } from '@/model/economy'
import enumData from '../../data/enums.json'

const emit = defineEmits<{ find: [hit: { view: 'research'; id: number }] }>()
/** The tech being researched, on the tree from wherever the player is. */
function showProject(id: number | undefined) {
  if (id === undefined) return
  showTech(id)
  emit('find', { view: 'research', id })
}

const ITEM_TYPES: string[] = (enumData as { enums: Record<string, string[]> }).enums.EItemType!
const ITEM = {
  alloys: ITEM_TYPES.indexOf('eItem_AlienAlloys'),
  elerium: ITEM_TYPES.indexOf('eItem_Elerium115'),
  meld: ITEM_TYPES.indexOf('eItem_Meld'),
  fragments: ITEM_TYPES.indexOf('eItem_WeaponFragment'),
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const info = computed(() => {
  const c = campaign.value
  if (!c) return undefined
  const done = techs.value.filter((t) => c.researched[t.id]).length
  // Long War 1.0's lab bonuses add up (+60 %); LWR's are factors that multiply (× 1.43).
  const bonus =
    game.value.research === 'lwr'
      ? `×${(Math.round((c.labBonus ?? 1) * (c.adjacentLabBonus ?? 1) * 100) / 100).toFixed(2)} labs`
      : Math.round(((c.labBonus ?? 0) + (c.adjacentLabBonus ?? 0)) * 100)
        ? `+${Math.round(((c.labBonus ?? 0) + (c.adjacentLabBonus ?? 0)) * 100)}% labs`
        : ''
  const project = c.project ? techById.value.get(c.project.tech) : undefined
  const days = projectEtaDays(c, game.value.research, bonusIds.value)
  return {
    date: c.date ? `${c.date.day} ${MONTHS[c.date.month - 1]} ${c.date.year}` : undefined,
    difficulty: difficultyName(c.difficulty, game.value.difficulties),
    game: c.gameNumber,
    done,
    total: techs.value.length,
    scientists: c.scientists,
    bonus,
    rate: pointsPerHour(c, game.value.research, bonusIds.value),
    project: project?.name,
    projectId: project?.id,
    days,
    tactical: c.tactical,
    ironman: c.ironman,
    start: countryName(c.startCountry),
    cash: c.cash,
    engineers: c.engineers,
    // Materials in stores (EItemType slots, as on the grey market).
    materials: [
      { key: 'alloys', name: 'Alien Alloys', n: c.stock[ITEM.alloys] },
      { key: 'elerium', name: 'Elerium', n: c.stock[ITEM.elerium] },
      { key: 'meld', name: 'Meld', n: c.stock[ITEM.meld] },
      { key: 'fragments', name: 'Weapon Fragments', n: c.stock[ITEM.fragments] },
    ].filter((m) => m.n !== undefined),
  }
})

/** The month's funding and upkeep, by the version's own rules (Long War 1.0's; null for LWR). */
const economy = computed(() => {
  const c = campaign.value
  if (!c) return null
  const active = bonuses.value?.all ?? []
  const bonus = (id: number) => active.find((b) => b.bonus_id === id)?.value ?? 0
  return monthlyEconomy(c, game.value.id === 'lwr' ? 'lwr' : 'lw', bonus)
})
const money = (n: number) => `§${Math.abs(n).toLocaleString('en-US')}`
const signed = (n: number) => `${n < 0 ? '−' : '+'}${money(n)}`
const upkeepText = (lines: { name: string; count: number; each: number }[]) =>
  lines
    .map((l) =>
      l.count > 1 ? `${l.count} ${l.name} × ${money(l.each)}` : `${l.name} ${money(l.each)}`,
    )
    .join(', ')

// Long War's hidden counters and the usual figures, opened from the bar.
const showStats = ref(false)
const stats = computed(() => (campaign.value ? campaignStats(campaign.value) : undefined))

// Operation Slingshot and Operation Progeny (features/council-operations.md).
const showOps = ref(false)
const operations = computed(() => (campaign.value ? councilOperations(campaign.value) : undefined))
const STATE: Record<MissionState, [mark: string, label: string]> = {
  won: ['✓', 'won'],
  map: ['●', 'on the map'],
  next: ['→', 'next'],
  later: ['·', 'later'],
  lost: ['✗', 'lost'],
  played: ['✓', 'played'],
  ended: ['–', 'not coming'],
}

// The campaign's bonuses, opened from the bar.
const showBonuses = ref(false)

// Our figures against the game's, per save loaded (this campaign first).
const showChecks = ref(false)
const checks = computed(() => state.checks)
const mismatches = computed(
  () => checks.value.filter((k) => k.etaMatch === false || k.creditMatch === false).length,
)
const pct = (v: number | undefined) => (v === undefined ? '–' : `${Math.round(v * 100)}%`)
const groups = computed(() => {
  const b = bonuses.value
  if (!b) return []
  return [
    { title: 'Starting bonus', items: b.starting ? [b.starting] : [] },
    { title: 'Country bonuses (satellite coverage)', items: researchFirst(b.countries) },
    {
      title: 'Continent bonuses (every council country covered)',
      items: researchFirst(b.continents),
    },
  ].filter((g) => g.items.length)
})
const JAI_VIDWAN = 46
const blocked = computed(() =>
  campaign.value ? blockedContinents(campaign.value, game.value.bonuses) : [],
)
const lostNames = computed(() =>
  (stats.value?.lost ?? []).map((id) => countryName(id) ?? `#${id}`).join(', '),
)
const affectsResearch = (b: Bonus) => b.bonus_id === EXPERTISE || b.bonus_id === WE_HAVE_WAYS
/** How a bonus reaches the research numbers, if it does. */
const researchTag = (b: Bonus) =>
  affectsResearch(b) ? 'in estimates' : b.bonus_id === JAI_VIDWAN ? "in the save's lab bonus" : ''
const researchFirst = (items: Bonus[]) =>
  [...items].sort((a, b) => Number(!researchTag(a)) - Number(!researchTag(b)))
const where = (b: Bonus) => (b.type === 'continent' ? b.continent : b.country)
</script>

<template>
  <div v-if="info" class="campaign">
    <span v-if="info.date"
      ><strong>{{ info.date }}</strong></span
    >
    <span
      >Campaign {{ info.game }}<template v-if="info.difficulty">, {{ info.difficulty }}</template
      ><template v-if="info.ironman">, Ironman</template></span
    >
    <span
      ><strong>{{ info.done }}</strong> of {{ info.total }} researched</span
    >
    <span
      v-if="info.scientists !== undefined"
      :title="info.rate ? `${Math.round(info.rate)} research points per hour` : undefined"
    >
      {{ info.scientists }} scientists<template v-if="info.bonus"> {{ info.bonus }}</template
      ><template v-if="info.engineers !== undefined">, {{ info.engineers }} engineers</template>
    </span>
    <span
      v-if="info.cash !== undefined || info.materials.length"
      class="stores-anchor"
      tabindex="0"
      aria-label="Money and materials: hover or focus for the details"
    >
      <span class="stores">
        <span v-if="info.cash !== undefined" class="cash"
          >§{{ info.cash.toLocaleString('en-US') }}</span
        >
        <span v-for="m in info.materials" :key="m.key" class="res" :class="`res-${m.key}`">{{
          m.n!.toLocaleString('en-US')
        }}</span>
      </span>
      <!-- Everything in stores by its full name, and what a month brings in and costs. -->
      <span class="stores-card" role="tooltip">
        <span class="card-h">In stores</span>
        <span class="lines">
          <template v-if="info.cash !== undefined">
            <span class="cash">Credits</span
            ><span class="n">§{{ info.cash.toLocaleString('en-US') }}</span>
          </template>
          <template v-for="m in info.materials" :key="m.key">
            <span class="res" :class="`res-${m.key}`">{{ m.name }}</span
            ><span class="n">{{ m.n!.toLocaleString('en-US') }}</span>
          </template>
        </span>
        <template v-if="economy">
          <span class="card-h">Each month, as things stand</span>
          <span class="lines">
            <span
              >Funding <span class="sub">from {{ economy.paying }} council countries</span></span
            ><span class="n plus">{{ signed(economy.funding) }}</span>
            <template v-if="economy.wealth">
              <span
                >Wealth of Nations <span class="sub">+{{ economy.wealth.percent }}%</span></span
              ><span class="n plus">{{ signed(economy.wealth.adds) }}</span>
            </template>
            <template v-if="economy.facilities.length">
              <span
                >Facility upkeep <span class="sub">{{ upkeepText(economy.facilities) }}</span></span
              ><span class="n minus">{{
                signed(-economy.facilities.reduce((n, f) => n + f.total, 0))
              }}</span>
            </template>
            <span
              >Aircraft upkeep
              <span class="sub"
                >{{ upkeepText(economy.craft)
                }}<template v-if="economy.craftDiscount">
                  (Air Superiority −{{ economy.craftDiscount }}%)</template
                ></span
              ></span
            ><span class="n minus">{{
              signed(-economy.craft.reduce((n, f) => n + f.total, 0))
            }}</span>
            <span class="net">Net at the month's end</span
            ><span class="n net" :class="economy.net < 0 ? 'minus' : 'plus'">{{
              signed(economy.net)
            }}</span>
          </span>
          <span class="card-note"
            >By Long War's own rules, from this save; a country that leaves or a facility built
            changes it.</span
          >
        </template>
        <span v-else-if="campaign && !campaign.countries" class="card-note"
          >Load the save again to see the month's funding and upkeep (it was read by an older
          version of the site).</span
        >
        <span v-else-if="game.id === 'lwr'" class="card-note"
          >LWR pays its funding and upkeep daily, partly by rules in its own code; the app does not
          work them out.</span
        >
      </span>
    </span>
    <span v-if="info.project">
      Researching
      <button
        type="button"
        class="link"
        title="Show it on the research tree"
        @click="showProject(info.projectId)"
      >
        {{ info.project }}
      </button>
      <template v-if="info.days"
        >, {{ info.days }} {{ info.days === 1 ? 'day' : 'days' }} left</template
      >
    </span>
    <span v-else>No research in progress</span>
    <span v-if="info.start" class="bonus-anchor">
      Started in {{ info.start }}
      <button
        type="button"
        class="link"
        :aria-expanded="showBonuses"
        @click="showBonuses = !showBonuses"
      >
        {{ bonuses?.all.length === 1 ? '1 bonus' : `${bonuses?.all.length ?? 0} bonuses` }}
      </button>
      <div v-if="showBonuses" class="bonuses" role="dialog" aria-label="Campaign bonuses">
        <button type="button" class="close" aria-label="Close" @click="showBonuses = false">
          ×
        </button>
        <section v-for="g in groups" :key="g.title">
          <h3>{{ g.title }}</h3>
          <ul>
            <li v-for="b in g.items" :key="`${b.type}:${b.bonus_id}:${where(b)}`">
              <strong>{{ b.name }}</strong> <span class="where">{{ where(b) }}</span>
              <span v-if="researchTag(b)" class="research">{{ researchTag(b) }}</span>
              <div class="desc">{{ b.description }}</div>
            </li>
          </ul>
        </section>
        <section v-if="blocked.length">
          <h3>Blocked until a country is retaken</h3>
          <ul>
            <li v-for="x in blocked" :key="x.bonus.bonus_id">
              <strong>{{ x.bonus.name }}</strong> <span class="where">{{ x.bonus.continent }}</span>
              <div class="desc">
                {{ x.lost.join(', ') }} left the council. The continent cannot be fully covered
                until {{ x.lost.length === 1 ? 'it is' : 'they are' }} retaken by assaulting the
                alien base there.
              </div>
            </li>
          </ul>
        </section>
        <p class="foot">
          A country's bonus counts while it has a satellite, except the starting country's. Values
          come from the loaded DefaultGameCore.ini.
        </p>
      </div>
    </span>
    <span v-if="stats" class="bonus-anchor">
      <button type="button" class="link" :aria-expanded="showStats" @click="showStats = !showStats">
        Stats
      </button>
      <div v-if="showStats" class="bonuses stats" role="dialog" aria-label="Campaign statistics">
        <button type="button" class="close" aria-label="Close" @click="showStats = false">×</button>
        <h3>The aliens (Long War's hidden counters)</h3>
        <dl>
          <dt>Alien research</dt>
          <dd>
            {{ stats.alienResearch ?? '–' }}
            <span class="where"
              >days + bonus research above zero<template v-if="stats.alienResearch !== undefined">
                · UFO category {{ categoryFor(stats.alienResearch, game.air.category) }}</template
              ></span
            >
          </dd>
          <dt>Alien resources</dt>
          <dd>{{ stats.alienResources ?? '–' }}</dd>
          <dt>XCOM threat this month</dt>
          <dd>{{ stats.xcomThreat ?? '–' }}</dd>
          <dt>Alien bonus research</dt>
          <dd>
            {{ stats.alienBonusResearch ?? '–' }}
            <span v-if="(stats.alienBonusResearch ?? 0) < 0" class="where">
              still making up the starting deficit
            </span>
          </dd>
        </dl>
        <h3>XCOM</h3>
        <dl>
          <dt>Day of the campaign</dt>
          <dd>{{ stats.days ?? '–' }}</dd>
          <dt>Missions won</dt>
          <dd>{{ stats.missionsWon ?? '–' }} of {{ stats.missions ?? '–' }}</dd>
          <dt>Aliens killed</dt>
          <dd>{{ stats.aliensKilled ?? '–' }}</dd>
          <dt>UFOs shot down</dt>
          <dd>{{ stats.ufosShotDown ?? '–' }}</dd>
          <dt>Soldiers lost</dt>
          <dd>{{ stats.soldiersLost ?? 0 }}</dd>
          <dt>Satellites</dt>
          <dd>{{ stats.satellites === 1 ? '1 country' : `${stats.satellites} countries` }}</dd>
          <dt>Countries lost</dt>
          <dd>{{ lostNames || 'none' }}</dd>
          <dt>Research credits</dt>
          <dd>
            <template v-if="credits?.held.size">
              {{
                [...credits.held]
                  .map((c) =>
                    c === 'All' ? `All research (${Math.round(credits!.all * 100)}%)` : c,
                  )
                  .sort()
                  .join(', ')
              }}
              <span class="where">{{ Math.round(credits.each * 100) }}% off each</span>
            </template>
            <template v-else>none yet</template>
          </dd>
          <dt>Foundry projects done</dt>
          <dd>{{ stats.foundryDone }}</dd>
        </dl>
        <p class="foot">
          The game does not show the alien counters. Long War keeps them in reused end-of-campaign
          statistics; what each one means is read from how they move across 1,700 saves: resources
          rise each month and fall with every XCOM success, threat resets monthly and grows with
          XCOM's successes, bonus research starts at −90 and climbs. The game stores no alien
          research total; the figure above follows the INI's description of it.
        </p>
      </div>
    </span>
    <span v-if="operations" class="bonus-anchor">
      <button type="button" class="link" :aria-expanded="showOps" @click="showOps = !showOps">
        Operations
      </button>
      <div
        v-if="showOps"
        class="bonuses ops"
        role="dialog"
        aria-label="Operation Slingshot and Operation Progeny"
      >
        <button type="button" class="close" aria-label="Close" @click="showOps = false">×</button>
        <template v-for="op in operations" :key="op.name">
          <h3>
            {{ op.name }} <span class="where">· {{ op.country }}</span>
          </h3>
          <ol v-if="op.on">
            <li v-for="m in op.missions" :key="m.id" :class="m.state">
              <span class="mark" aria-hidden="true">{{ STATE[m.state][0] }}</span>
              <strong>{{ m.name }}</strong>
              <span class="state">{{ STATE[m.state][1] }}</span>
              <div v-if="m.when" class="desc">{{ m.when }}</div>
            </li>
          </ol>
          <p v-if="op.note" class="desc note">{{ op.note }}</p>
        </template>
        <p class="foot">
          From the save and the game's own script. A mission failed or left to expire ends its
          operation for the campaign. Slingshot keeps its own calendar; Progeny's missions take the
          place of an ordinary council mission, whose time the game has already drawn.
        </p>
      </div>
    </span>
    <span class="bonus-anchor">
      <button
        type="button"
        class="link"
        :class="{ warn: mismatches }"
        :aria-expanded="showChecks"
        @click="showChecks = !showChecks"
      >
        {{
          mismatches === 1
            ? '1 check differs'
            : mismatches
              ? `${mismatches} checks differ`
              : 'Checks'
        }}
      </button>
      <div
        v-if="showChecks"
        class="bonuses checks"
        role="dialog"
        aria-label="Checks against the game"
      >
        <button type="button" class="close" aria-label="Close" @click="showChecks = false">
          ×
        </button>
        <h3>Our figures against the game's, per save</h3>
        <table>
          <thead>
            <tr>
              <th>Save</th>
              <th>Project</th>
              <th>Days: game / ours</th>
              <th>Credit: actual / ours</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="k in checks" :key="`${k.fileName}:${k.saveNumber}`">
              <td>
                {{ k.fileName }}
                <div class="sub">{{ k.date }}</div>
                <div v-if="k.changes" class="sub">{{ k.changes }}</div>
              </td>
              <td>
                {{ k.project }}
                <div v-for="n in k.notes" :key="n" class="sub">{{ n }}</div>
              </td>
              <td :class="{ bad: k.etaMatch === false, good: k.etaMatch }">
                {{ k.gameDays ?? '–' }} / {{ k.formulaDays ?? '–' }}
              </td>
              <td :class="{ bad: k.creditMatch === false, good: k.creditMatch }">
                {{ pct(k.actualReduction) }} / {{ pct(k.expectedCredit) }}
              </td>
            </tr>
          </tbody>
        </table>
        <p class="foot">
          Every save loaded is checked: the game's ETA for the current project against ours, and
          what the project costs against the research credit we expect. A credited project's cost is
          fixed when it starts, so a credit difference can also mean a bonus changed since.
        </p>
        <button v-if="checks.length" type="button" class="clear-log" @click="state.checks = []">
          Clear log
        </button>
      </div>
    </span>
    <span v-if="info.tactical" class="note"
      >Mid-mission save: research as of the mission's start</span
    >
    <span class="legend">
      <i class="sw researched"></i>researched <i class="sw researching"></i>researching
      <i class="sw available"></i>available <i class="sw locked"></i>locked · ≈ estimate
    </span>
  </div>
</template>

<style scoped>
.stores {
  display: inline-flex;
  gap: 10px;
  font-variant-numeric: tabular-nums;
}
.stores .cash {
  color: var(--cash);
  font-weight: 600;
}
/* The money and materials: their details on hover or focus. */
.stores-anchor {
  position: relative;
  cursor: default;
  outline: none;
  border-radius: 3px;
}
.stores-anchor:focus-visible {
  box-shadow: 0 0 0 2px var(--accent);
}
.stores-card {
  display: none;
  position: absolute;
  z-index: 20;
  top: calc(100% + 8px);
  left: -10px;
  width: 400px;
  padding: 10px 14px 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
  font-size: 13px;
  white-space: normal;
}
.stores-anchor:hover .stores-card,
.stores-anchor:focus-within .stores-card {
  display: block;
}
.card-h {
  display: block;
  margin: 6px 0 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.lines {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 3px 16px;
}
.lines .n {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.lines .cash {
  color: var(--cash);
}
.plus {
  color: var(--done-text);
}
.minus {
  color: #ff9a8a;
}
.lines .net {
  border-top: 1px solid var(--border);
  padding-top: 3px;
  font-weight: 600;
}
.stores-card .sub {
  color: var(--muted);
  font-size: 12px;
}
.card-note {
  display: block;
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--muted);
}

.bonus-anchor {
  position: relative;
}
.stats dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 14px;
  margin: 0 0 6px;
  font-size: 13px;
}
.stats dt {
  color: var(--muted);
}
.stats dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.clear-log {
  margin-top: 8px;
}
.link.warn {
  color: #ff9b6b;
}
.checks {
  width: 560px;
}
.checks table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.checks th {
  text-align: left;
  font-weight: 600;
  color: var(--muted);
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
}
.checks td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
  font-variant-numeric: tabular-nums;
}
.checks .sub {
  font-size: 11px;
  color: var(--muted);
}
.checks .good {
  color: var(--done-text);
}
.checks .bad {
  color: #ff8a8a;
  font-weight: 600;
}
.bonuses {
  position: absolute;
  z-index: 20;
  top: calc(100% + 8px);
  left: 0;
  width: 420px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 12px 14px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
}
.bonuses .close {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 0 7px;
}
.bonuses h3 {
  margin: 8px 0 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.bonuses ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.bonuses li {
  padding: 4px 0;
}
.where {
  color: var(--muted);
  font-size: 12px;
}
.research {
  margin-left: 6px;
  font-size: 10px;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 3px;
  padding: 0 4px;
}
.desc {
  font-size: 12.5px;
  color: var(--muted);
}
.ops {
  width: 460px;
}
.ops ol {
  margin: 0;
  padding: 0;
  list-style: none;
}
.ops li {
  display: grid;
  grid-template-columns: 16px auto 1fr;
  column-gap: 6px;
  align-items: baseline;
  padding: 3px 0;
}
.ops li .desc {
  grid-column: 2 / -1;
}
.ops .mark {
  color: var(--muted);
  text-align: center;
}
.ops .state {
  font-size: 12px;
  color: var(--muted);
}
.ops .won .mark,
.ops .won .state,
.ops .played .mark {
  color: var(--done-text);
}
.ops .map .mark,
.ops .map .state,
.ops .next .mark {
  color: var(--accent);
}
.ops .lost .mark,
.ops .lost .state {
  color: #ff8a8a;
}
.ops .ended strong {
  color: var(--muted);
  font-weight: 400;
}
.ops .note {
  margin: 4px 0 2px;
}
.bonuses .foot {
  margin: 10px 0 0;
  font-size: 11.5px;
  color: var(--muted);
}
.campaign {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 20px;
  padding: 7px 16px;
  font-size: 13px;
  background: var(--lane-alt);
  border-bottom: 1px solid var(--border);
}
.link {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
  text-decoration: underline dotted;
}
.note {
  color: var(--progress);
}
.legend {
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
}
.sw {
  display: inline-block;
  width: 11px;
  height: 11px;
  margin: 0 4px -1px 8px;
  border-radius: 3px;
  border: 1.5px solid var(--node-border);
  background: var(--node);
}
.sw.researched {
  background: var(--done);
  border-color: var(--done-border);
}
.sw.researching {
  border-color: var(--progress);
}
.sw.available {
  border-color: var(--available);
}
.sw.locked {
  background: var(--locked);
}
</style>
