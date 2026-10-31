<script setup lang="ts">
// Tools: the player's game install, their mods and INI settings
// (features/game-tools.md). Not a board like the others: it works on the
// game's own files. It reads which version is installed (the site follows
// it) and whether each mod is in it, keeps the mods and settings in the
// player's library folder, and puts the chosen setup into the game: a plan first,
// written only when the player says so, with the originals kept.

import { computed, ref, watch } from 'vue'
import { GAMES } from '@/model/game'
import { optionProblem, scriptFor, type ModTarget } from '@innonova/upkit/patchupk'
import {
  addModFiles,
  checkKey,
  chooseGameFolder,
  findGameFolder,
  forgetGameFolder,
  openLibrary,
  readPackage,
  removeMod,
  setOption,
  adoptHandEdits,
  setSetting,
  setWanted,
  setWantFiles,
  tools,
  type CheckStatus,
  type Mod,
  type ModFile,
} from '@/state/tools'
import { desktop } from '@/state/desktop'
import type { IniEntry } from '@/model/inifile'
import { GROUPS, type FoundSetting } from '@/model/gamesettings'
import { describe, PLAIN } from '@/model/settingformat'
import SettingRow from './SettingRow.vue'
import SoldierLooks from './SoldierLooks.vue'
import SoldierStats from './SoldierStats.vue'
import SetupBar from './SetupBar.vue'
import ItemsPanel from './ItemsPanel.vue'
import { state } from '@/state/store'

const scriptInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const added = ref<string | null>(null)

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const n = await addModFiles([...(input.files ?? [])])
  added.value =
    n === 0
      ? 'Nothing added: a mod is a PatcherGUI script (a .txt with UPK_FILE lines), a .upkmod, or a folder of mod files.'
      : null
  input.value = ''
}

const KIND_NAME = {
  lw: GAMES.lw.name,
  lwr: GAMES.lwr.name,
  ew: 'Enemy Within without Long War',
}

/** Read the tables of every package a mod patches, once the install is known. */
watch(
  () => [tools.install, tools.mods.length] as const,
  () => {
    if (!tools.install) return
    const upks = new Set(
      tools.mods.flatMap((m) => m.files.flatMap((f) => f.script?.targets.map((t) => t.upk) ?? [])),
    )
    for (const u of upks) void readPackage(u)
  },
  { immediate: true },
)

const STATUS_TEXT: Record<CheckStatus, string> = {
  installed: 'installed',
  'other-values': 'installed, with other option values than those set here',
  'not-installed': 'not installed',
  partly: 'partly installed',
  'does-not-fit': 'does not fit this install',
  checking: 'checking…',
}
/** The script in the install: the engine's check, else what its targets say. */
function scriptStatus(m: Mod, f: ModFile): { text: string; kind: 'ok' | 'bad' | 'unknown' } {
  const c = tools.checks[checkKey(m, f)]
  if (!c || c.status === 'checking') return targetStatus(f)
  if (c.status === 'does-not-fit') {
    const e = c.steps.find((s) => s.status === 'error')
    return {
      text: `${STATUS_TEXT[c.status]}: ${e?.where} (line ${e?.line}): ${e?.note}`,
      kind: 'bad',
    }
  }
  const counts =
    c.status === 'partly'
      ? ` (${c.steps.filter((s) => s.status === 'already').length} of ${c.steps.length} changes)`
      : ''
  return {
    text: STATUS_TEXT[c.status] + counts,
    kind: c.status === 'installed' || c.status === 'other-values' ? 'ok' : 'unknown',
  }
}

/** What the install says about one script's targets. */
function targetStatus(f: ModFile): { text: string; kind: 'ok' | 'bad' | 'unknown' } {
  const targets = (f.script?.targets ?? []).filter((t) => t.object)
  const upks = [...new Set(f.script?.targets.map((t) => t.upk) ?? [])]
  const where = upks.join(', ')
  const count = `${targets.length} ${targets.length === 1 ? 'object' : 'objects'} in ${where}`
  if (!tools.install) return { text: `patches ${count}`, kind: 'unknown' }
  const missingPkg = upks.filter((u) => tools.packages[u.toLowerCase()] === null)
  if (missingPkg.length)
    return { text: `${missingPkg.join(', ')} is not in the install`, kind: 'bad' }
  if (
    upks.some(
      (u) => tools.packages[u.toLowerCase()] === 'reading' || !(u.toLowerCase() in tools.packages),
    )
  )
    return { text: `patches ${count}; reading the install…`, kind: 'unknown' }
  const missing = targets.filter((t) => !found(t))
  if (missing.length)
    return {
      text: `patches ${count}; not in the install: ${missing.map((t) => t.object).join(', ')}`,
      kind: 'bad',
    }
  return { text: `patches ${count}; all of them are in the install`, kind: 'ok' }
}
function found(t: ModTarget): boolean {
  const p = tools.packages[t.upk.toLowerCase()]
  return !!p && p !== 'reading' && p.exports.has(t.object)
}

const scripts = (m: Mod) => m.files.filter((f) => f.kind === 'script')
const others = (m: Mod) => m.files.filter((f) => f.kind !== 'script')
const description = (m: Mod) =>
  scripts(m).find((f) => f.script?.description)?.script?.description || m.readme || ''
const authors = (m: Mod) =>
  [
    ...new Set(
      scripts(m)
        .map((f) => f.script?.author)
        .filter(Boolean),
    ),
  ].join(', ')
const forTag = (f: ModFile) => {
  const v = scriptFor(f.path)
  return v === 'lw' ? 'for Long War' : v === 'ew' ? 'for plain Enemy Within' : ''
}
const valueOf = (m: Mod, f: ModFile, option: string) => m.values[f.path]?.[option] ?? ''
const FILE_ROLE: Record<string, string> = {
  package: 'goes into CookedPCConsole',
  config: 'a config file',
  doc: 'notes',
  other: '',
}
/** A mod's package that the install already has (LWR ships Sightlines.u, for one). */
const inCooked = (f: ModFile) =>
  f.kind === 'package' &&
  !!tools.install?.cooked.some((c) => c.toLowerCase() === f.path.split('/').pop()!.toLowerCase())
const size = (n: number) =>
  n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} kB` : `${n} B`

const hasFiles = (m: Mod) => m.files.some((f) => f.kind === 'package' || f.kind === 'config')

// INI settings: search the install's DefaultGameCore.ini.
const query = ref('')
const matches = computed<IniEntry[]>(() => {
  // Every word somewhere in the key (underscores as spaces) or its comment.
  const words = query.value.toLowerCase().replace(/_/g, ' ').split(/\s+/).filter(Boolean)
  if (!words.join('').length || words.join('').length < 2) return []
  return tools.iniEntries
    .filter((e) => {
      const hay = `${e.key.replace(/_/g, ' ')} ${e.key} ${e.help}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    .slice(0, 30)
})
const settingOf = (e: IniEntry) =>
  tools.settings.find(
    (s) => s.section === e.section && s.key === e.key && s.occurrence === e.occurrence,
  )
const entryOf = (s: { section: string; key: string; occurrence: number }) =>
  tools.iniEntries.find(
    (e) => e.section === s.section && e.key === s.key && e.occurrence === s.occurrence,
  )
function onSetting(e: { section: string; key: string; occurrence: number }, value: string) {
  void setSetting({ ...e, value }, value.trim() === '' ? null : value.trim())
}
const repeated = (e: IniEntry) =>
  tools.iniEntries.filter((x) => x.section === e.section && x.key === e.key).length > 1

// Game settings, by group, in the rules' order (model/gamesettings.ts GROUPS).
const gameGroups = computed(() => {
  const groups = new Map<string, FoundSetting[]>()
  for (const d of tools.gameSettings) groups.set(d.group, [...(groups.get(d.group) ?? []), d])
  const order = GROUPS.map((g) => g.name)
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length)
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([name, items]) => {
      const mine = items.filter((d) => d.id in tools.gameValues).length
      const help = GROUPS.find((g) => g.name === name)?.help ?? ''
      // Items count as items, not as their numbers.
      const count = name === 'Items' ? new Set(items.map((d) => d.item?.type)).size : items.length
      return { name, items, mine, help, count, open: items.length <= 30 || mine > 0 }
    })
})
/** A value in words, as its setting describes it (hand edits). */
function shownValue(d: FoundSetting, v: string): string {
  if (d.type === 'toggle') return v === 'on' ? 'on' : 'off'
  const name =
    d.type === 'color'
      ? tools.codes.colors.get(v)
      : d.type === 'headgear'
        ? tools.codes.headgear.get(v)
        : undefined
  return name ? `${v}, ${name}` : describe(d.format ?? PLAIN, v)
}

const iniNote = computed(() =>
  tools.install?.ini && state.ini
    ? `${tools.install.ini} loaded: the site's costs are this install's.`
    : tools.install?.kind === 'ew'
      ? ''
      : tools.iniEntries.length
        ? 'DefaultGameCore.ini has no research costs (TechBalance lines) for the site to use.'
        : 'No DefaultGameCore.ini found in Config.',
)
</script>

<template>
  <section class="tools" aria-label="Tools">
    <header class="top">
      <h2>Tools</h2>
      <p class="lead">
        The game install, its mods and settings. This works on the game's own files rather than on a
        campaign. Nothing is uploaded, and nothing in the game changes until a setup is applied and
        its plan confirmed.
      </p>
    </header>
    <SetupBar v-if="tools.library" />

    <section class="block" aria-labelledby="folder-h">
      <h3 id="folder-h">Game folder</h3>
      <p v-if="tools.status === 'reading'" class="muted">Reading the game's files…</p>
      <template v-else-if="tools.status === 'off'">
        <p>
          <button type="button" class="primary" @click="findGameFolder">Find the game</button>
          <button type="button" @click="chooseGameFolder">Choose the folder…</button>
        </p>
        <p v-if="tools.looked.length" class="muted small">
          Steam's records did not lead to the game. Looked in:
          <template v-for="l in tools.looked" :key="l"
            ><br /><code>{{ l }}</code></template
          >
        </p>
        <p class="muted small">
          The app finds the game the way installers do, from what Steam told Windows. Or choose its
          folder: <code>XCom-Enemy-Unknown</code>, or its <code>XEW</code>.
        </p>
      </template>
      <template v-else>
        <dl v-if="tools.install" class="facts">
          <dt>Folder</dt>
          <dd>
            <code>{{ tools.install.path }}</code>
          </dd>
          <dt>Installed</dt>
          <dd>
            <strong>{{ KIND_NAME[tools.install.kind] }}</strong>
            <span v-if="tools.install.kind === 'ew'" class="muted">
              · this site models Long War only. Long War is installed into
              <code>XEW\XComGame</code>; if it is there, choose the game folder or its
              <code>XEW</code>.</span
            >
            <span v-else class="muted"> · the site now shows this version</span>
          </dd>
          <dt v-if="iniNote">INI</dt>
          <dd v-if="iniNote">{{ iniNote }}</dd>
        </dl>
        <p>
          <button type="button" @click="chooseGameFolder">Choose another folder…</button>
          <button type="button" class="link" @click="forgetGameFolder">Forget it</button>
        </p>
      </template>
      <p v-if="tools.error" class="error">{{ tools.error }}</p>
    </section>

    <section v-if="tools.install && desktop?.bases" class="block" aria-labelledby="base-h">
      <h3 id="base-h">Long War and LWR downloads</h3>
      <p class="muted small">
        The app puts Long War or LWR into the game itself, from their own downloads in the library
        folder, and takes them out again. The version chosen at the top goes in, under its own
        setup, when applied.
      </p>
      <ul v-if="tools.bases.length" class="files small">
        <li v-for="b in tools.bases" :key="b.id">
          <strong>{{ b.name }}</strong> <span class="muted">from</span> <code>{{ b.source }}</code>
        </li>
      </ul>
      <p v-else class="small">
        No Long War or LWR download in the library folder yet. The Long War installer (<code
          >Long War EW 1.0 for PC-88-1-0.exe</code
        >) and the LWR download (its zip, or the folder unpacked) go in
        <code>{{ tools.library ?? 'the library folder' }}</code
        >, the folder that holds <code>Mods</code> (in <code>Mods</code> works too, but not for an
        unpacked LWR folder, which there would count as a mod); the app finds them when it is back
        in front.
      </p>
      <p v-if="tools.library">
        <button type="button" @click="openLibrary">Open the library folder</button>
      </p>
    </section>

    <section class="block" aria-labelledby="mods-h">
      <h3 id="mods-h">Mods</h3>
      <p v-if="tools.library" class="muted small">
        Mods live in the library folder, <code>{{ tools.library }}</code
        >: each folder in its <code>Mods</code> is one mod, and so is a PatcherGUI script, or a
        <code>.upkmod</code> (a mod as changes to the game's code, compiled when it goes in), on its
        own there. They are copied in by hand or added here; the choices, each version its own, are kept
        beside them in <code>settings.json</code>. A ticked script goes into the game, with its
        options, when the setup is applied.
      </p>
      <p v-else class="error small">
        This version of the app keeps no library folder: update the app (Help, This app).
      </p>
      <p v-if="tools.library">
        <button type="button" @click="scriptInput?.click()">Add mod scripts</button>
        <button type="button" @click="folderInput?.click()">Add a mod folder</button>
        <button type="button" @click="openLibrary">Open the folder</button>
        <input ref="scriptInput" type="file" multiple accept=".txt,.upkmod" hidden @change="onPick" />
        <input
          ref="folderInput"
          type="file"
          webkitdirectory
          hidden
          aria-label="Mod folder"
          @change="onPick"
        />
      </p>
      <p v-if="added" class="error">{{ added }}</p>
      <p v-if="!tools.mods.length" class="muted">No mods yet.</p>

      <article v-for="m in tools.mods" :key="m.id" class="mod" :aria-label="m.name">
        <header class="mod-head">
          <h4>{{ m.name }}</h4>
          <span v-if="authors(m)" class="muted small">by {{ authors(m) }}</span>
          <button
            type="button"
            class="remove"
            :aria-label="`Remove ${m.name}`"
            title="Remove from the library (its files go to the recycle bin)"
            @click="removeMod(m.id)"
          >
            ×
          </button>
        </header>
        <details v-if="description(m)" class="desc">
          <summary>{{ description(m).split('\n')[0] }}</summary>
          <p>{{ description(m).split('\n').slice(1).join('\n') }}</p>
        </details>

        <div v-for="f in scripts(m)" :key="f.path" class="script">
          <p class="script-head">
            <label class="want" :title="`Have ${f.path} in the game`">
              <input
                type="checkbox"
                :checked="!!m.wanted?.[f.path]"
                :aria-label="`Install ${f.path}`"
                @change="setWanted(m.id, f.path, ($event.target as HTMLInputElement).checked)"
              />
              <code>{{ f.path }}</code>
            </label>
            <span v-if="forTag(f)" class="tag">{{ forTag(f) }}</span>
            <span class="status" :class="scriptStatus(m, f).kind">{{
              scriptStatus(m, f).text
            }}</span>
          </p>
          <table v-if="f.script?.options.length" class="options">
            <tbody>
              <tr v-for="o in f.script.options" :key="o.name">
                <th>
                  <label :for="`${m.id}-${f.path}-${o.name}`">{{ o.name }}</label>
                </th>
                <td class="input">
                  <input
                    :id="`${m.id}-${f.path}-${o.name}`"
                    :value="valueOf(m, f, o.name)"
                    :placeholder="o.value"
                    class="num"
                    @change="
                      setOption(m.id, f.path, o.name, ($event.target as HTMLInputElement).value)
                    "
                  />
                  <span
                    v-if="valueOf(m, f, o.name) && optionProblem(o.kind, valueOf(m, f, o.name))"
                    class="error small"
                    >{{ optionProblem(o.kind, valueOf(m, f, o.name)) }}</span
                  >
                </td>
                <td class="help small">
                  {{ o.help }}
                  <span class="muted">(script's value: {{ o.value }})</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <label v-if="hasFiles(m)" class="want files-want">
          <input
            type="checkbox"
            :checked="!!m.wantFiles"
            :aria-label="`Put ${m.name}'s files into the game`"
            @change="setWantFiles(m.id, ($event.target as HTMLInputElement).checked)"
          />
          Put its files into the game
          <span class="muted small"
            >(packages the game lacks into CookedPCConsole, INI files into Config, their lines
            merged into the game's own)</span
          >
        </label>
        <ul v-if="others(m).length" class="files small">
          <li v-for="f in others(m)" :key="f.path">
            <code>{{ f.path }}</code> <span class="muted">{{ size(f.size) }}</span>
            <span v-if="inCooked(f)" class="present"> · already in the game's CookedPCConsole</span>
            <span v-else-if="FILE_ROLE[f.kind]" class="muted"> · {{ FILE_ROLE[f.kind] }}</span>
          </li>
        </ul>
      </article>
    </section>

    <section v-if="tools.gameSettings.length" class="block wide" aria-labelledby="game-h">
      <h3 id="game-h">Game settings</h3>
      <p class="muted small">
        Soldiers, rookies, the arc thrower, class colors and more, from the game's
        DefaultGameCore.ini. Each shows its value now; changed ones are marked, with
        {{ tools.gameSettingsFrom }} beside them. Changes are written when the setup is applied, and
        kept for the next install of this version.
      </p>
      <div v-if="tools.handEdits.length" class="hand" role="region" aria-label="Edits by hand">
        <p>
          <strong
            >The game's file differs from {{ tools.gameSettingsFrom }} in
            {{ tools.handEdits.length }} setting{{
              tools.handEdits.length === 1 ? '' : 's'
            }}</strong
          >, edited by hand or by another tool:
        </p>
        <ul class="small">
          <li v-for="c in tools.handEdits" :key="c.def.id">
            {{ c.def.group }}: {{ c.def.name }}
            <span class="muted">{{ shownValue(c.def, c.own) }} →</span>
            {{ shownValue(c.def, c.now) }}
          </li>
        </ul>
        <p>
          <button type="button" class="primary" @click="adoptHandEdits">
            Keep them as settings
          </button>
          <span class="muted small"> so they come back after a reinstall</span>
        </p>
      </div>
      <details
        v-for="g in gameGroups"
        :key="g.name"
        class="group"
        :open="g.open"
        :aria-label="g.name"
      >
        <summary>
          {{ g.name }}
          <span class="muted small"
            >{{ g.count }}<template v-if="g.mine"> · {{ g.mine }} changed</template></span
          >
        </summary>
        <p v-if="g.help" class="group-help small">{{ g.help }}</p>
        <SoldierLooks v-if="g.name === 'Class colors'" :items="g.items" />
        <SoldierStats v-else-if="g.name === 'Soldier stats'" :items="g.items" />
        <ItemsPanel v-else-if="g.name === 'Items'" :items="g.items" />
        <div v-else class="rows">
          <SettingRow v-for="d in g.items" :key="d.id" :def="d" />
        </div>
      </details>
    </section>

    <section class="block" aria-labelledby="settings-h">
      <h3 id="settings-h">Any line of DefaultGameCore.ini</h3>
      <p class="muted small">
        For everything else: values in the game's DefaultGameCore.ini, found by searching, with the
        file's own comment on each; values set here are written when the setup is applied.
      </p>
      <ul v-if="tools.settings.length" class="settings">
        <li v-for="s in tools.settings" :key="`${s.section}/${s.key}/${s.occurrence}`">
          <code>{{ s.key }}</code>
          <span v-if="s.occurrence" class="muted small"> (no. {{ s.occurrence + 1 }})</span>
          <input
            class="num wide"
            :value="s.value"
            :aria-label="`Value for ${s.key}`"
            @change="onSetting(s, ($event.target as HTMLInputElement).value)"
          />
          <span class="muted small">
            <template v-if="entryOf(s)">in the game now: {{ entryOf(s)!.value }}</template>
            <template v-else-if="tools.install">not in this install's file</template>
            <template v-if="entryOf(s)?.help"> · {{ entryOf(s)!.help }}</template>
          </span>
          <button
            type="button"
            class="remove"
            :aria-label="`Drop the value for ${s.key}`"
            @click="setSetting(s, null)"
          >
            ×
          </button>
        </li>
      </ul>
      <p v-if="tools.iniEntries.length">
        <input
          v-model="query"
          type="search"
          class="search"
          placeholder="Find a setting: NUM_STARTING_SOLDIERS, psi, mobility…"
          aria-label="Find a setting"
        />
      </p>
      <p v-else class="muted small">Pick the game folder to find its settings.</p>
      <table v-if="matches.length" class="options">
        <tbody>
          <tr v-for="e in matches" :key="`${e.section}/${e.key}/${e.occurrence}`">
            <th>
              {{ e.key }}<span v-if="repeated(e)" class="muted"> ({{ e.occurrence + 1 }})</span>
            </th>
            <td class="input">
              <input
                class="num wide"
                :value="settingOf(e)?.value ?? ''"
                :placeholder="e.value.length > 24 ? e.value.slice(0, 24) + '…' : e.value"
                :aria-label="`Set ${e.key}`"
                @change="onSetting(e, ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td class="help small">
              {{ e.help }} <span class="muted">({{ e.section }}; now {{ e.value }})</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<style scoped>
.hand {
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 6px 10px;
  margin: 8px 0;
}
.hand ul {
  margin: 4px 0;
  padding-left: 18px;
}
details.group {
  margin: 6px 0;
}
details.group summary {
  cursor: pointer;
  font-size: 13.5px;
  font-weight: 600;
}
.group-help {
  margin: 4px 0 6px;
  color: var(--muted);
}
/* Name, editor, what is particular to it: rows line up across a group. */
.rows {
  display: grid;
  grid-template-columns: minmax(170px, 17rem) 300px minmax(0, 1fr);
  margin: 4px 0 8px;
}
@media (max-width: 1000px) {
  .rows {
    grid-template-columns: minmax(140px, 14rem) minmax(0, 1fr);
  }
}
.undo {
  border: none;
  background: none;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
  padding: 0 2px;
}
tr.mine th {
  color: var(--accent);
}
ul.changes {
  max-height: 340px;
  overflow-y: auto;
}
.tools {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 32px;
  /* Anything placed absolutely inside stays inside the scroller, not the page. */
  position: relative;
}
/* The page scrolls at the window's edge; its text keeps a readable width,
   the game settings (the soldier beside the class table) a wider one. */
.tools > * {
  max-width: 980px;
}
.tools > .wide {
  max-width: 1400px;
}
/* The setup bar runs the page's width. */
.tools > .setup-bar {
  max-width: none;
}
.top h2 {
  margin: 0;
  font-size: 18px;
}
.lead {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13.5px;
}
.block {
  margin-top: 20px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}
h3 {
  margin: 0 0 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
}
p {
  margin: 6px 0;
  font-size: 13.5px;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 12px;
}
.error {
  color: var(--progress);
}
code {
  font-size: 12px;
  background: var(--node);
  padding: 1px 4px;
  border-radius: 3px;
}
button {
  font-size: 13px;
  padding: 4px 10px;
  margin-right: 6px;
}
button.primary {
  background: var(--accent);
  color: #04131f;
  border: none;
  font-weight: 600;
}
button.link {
  background: none;
  border: none;
  color: var(--accent);
  text-decoration: underline;
  padding: 0;
}
.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 14px;
  margin: 6px 0 10px;
  font-size: 13.5px;
}
.facts dt {
  color: var(--muted);
}
.facts dd {
  margin: 0;
}
.mod {
  border: 1px solid var(--border);
  border-left: 3px solid var(--node-border);
  border-radius: 4px;
  background: var(--panel);
  padding: 8px 12px;
  margin: 10px 0;
}
.mod-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
h4 {
  margin: 0;
  font-size: 14.5px;
}
.remove {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
}
.desc {
  font-size: 12.5px;
  margin: 4px 0;
}
.desc summary {
  cursor: pointer;
  color: var(--muted);
}
.desc p {
  white-space: pre-line;
  font-size: 12.5px;
  color: var(--muted);
}
.script {
  margin-top: 6px;
}
.script-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin: 4px 0;
}
.tag {
  font-size: 11px;
  color: var(--foundry);
}
.status {
  font-size: 12px;
}
.status.ok {
  color: var(--done-text);
}
.status.bad {
  color: var(--progress);
}
.status.unknown {
  color: var(--muted);
}
.options {
  border-collapse: collapse;
  margin: 4px 0 2px;
  width: 100%;
}
.options th {
  text-align: left;
  font-weight: 600;
  font-size: 12.5px;
  padding: 3px 10px 3px 0;
  white-space: nowrap;
  vertical-align: top;
}
.options td {
  padding: 3px 10px 3px 0;
  vertical-align: top;
}
.options td.input {
  white-space: nowrap;
}
.num {
  width: 70px;
  background: var(--node);
  color: var(--text);
  border: 1px solid var(--node-border);
  border-radius: 4px;
  padding: 2px 6px;
  font: inherit;
  font-size: 13px;
}
.help {
  color: var(--text);
  line-height: 1.4;
}
.files {
  list-style: none;
  padding: 0;
  margin: 6px 0 0;
}
.present {
  color: var(--done-text);
}
.want {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.files-want {
  margin-top: 6px;
  font-size: 13px;
}
.num.wide {
  width: 120px;
}
.search {
  width: min(460px, 100%);
  background: var(--node);
  color: var(--text);
  border: 1px solid var(--node-border);
  border-radius: 4px;
  padding: 4px 8px;
  font: inherit;
  font-size: 13px;
}
.settings {
  list-style: none;
  padding: 0;
  margin: 6px 0;
}
.settings li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  padding: 2px 0;
  font-size: 13px;
}
.settings .remove {
  margin-left: 0;
}
.plan {
  border: 1px solid var(--node-border);
  border-radius: 4px;
  background: var(--panel);
  padding: 8px 12px;
  font-size: 13.5px;
}
.plan ul {
  margin: 4px 0;
  padding-left: 18px;
}
.problems {
  list-style: none;
  padding: 0;
}
.log {
  margin: 8px 0 0;
  padding-left: 18px;
  color: var(--done-text);
}
.files li {
  padding: 1px 0;
}
</style>
