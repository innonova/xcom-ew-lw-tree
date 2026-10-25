<script setup lang="ts">
// The desktop app, on the website (features/desktop-app-page.md): what it adds
// to the site, shown in screenshots of it at work, the download, and who made
// what it works with. Screenshots: public/desktop/, made by scripts/site-shots.sh.

import { onMounted } from 'vue'
import { APP_DIR, findInstaller, installer } from '@/state/installer'

onMounted(findInstaller)

const shot = (name: string) => `${import.meta.env.BASE_URL}desktop/${name}.webp`

const FEATURES: { title: string; text: string; shot: string; alt: string }[] = [
  {
    title: 'Long War or LWR into the game, and out again',
    text: 'Drop the Long War installer and the LWR download in the app’s library folder: it puts either into the game from them, with your mods on top, or takes it back to plain Enemy Within. Each version keeps its own setup, so switching never drags Long War’s choices into LWR. No mod manager, nothing run but the app; every file it changes is kept first.',
    shot: 'versions',
    alt: 'The version buttons: plain Enemy Within, Long War 1.0 (in the game) and LWR from the library folder',
  },
  {
    title: 'See what it will do before it does it',
    text: 'Apply your setup and it says, step by step, what it reads and what will change, file by file, and plainly when it replaces the version in the game. Nothing is written until you say so.',
    shot: 'apply',
    alt: 'The apply console switching to LWR: unpacking the downloads, then that it replaces Long War 1.0, then the files',
  },
  {
    title: 'Game settings in plain terms',
    text: 'Soldier stats with what rookies actually roll, point costs, fatigue, the arc thrower, LWR’s options by name: no hunting through DefaultGameCore.ini.',
    shot: 'soldier-stats',
    alt: 'Soldier stats: base, rookie’s lowest, what rookies roll and point costs for each stat',
  },
  {
    title: 'Every item’s numbers',
    text: 'What an item costs to build, what it does as a weapon or armor, what carrying it does, each in its own terms and written back exactly where the file keeps it.',
    shot: 'item-card',
    alt: 'The Carapace Armor card: its build cost, armor stats and what carrying it does',
  },
  {
    title: 'Class colours on a soldier',
    text: 'Each class’s armor colour and headgear, on a soldier drawn from your own install, turning as you drag. In LWR, the colours LWR itself gives each class.',
    shot: 'class-colors',
    alt: 'The class colours table beside a 3D soldier in the Medic’s colours',
  },
  {
    title: 'The game’s own art',
    text: 'The research tree and the Foundry with the game’s pictures, and the air war’s fights drawn the way the game’s interception screen draws them.',
    shot: 'air-war',
    alt: 'An air war fight: an Interceptor and a Scout as the game’s holograms, with its Aim, Dodge and Boost buttons',
  },
]
</script>

<template>
  <section class="app-page" aria-labelledby="app-title">
    <header class="hero">
      <div>
        <h2 id="app-title">The desktop app</h2>
        <p class="lead">
          Everything this site does, and Tools: it works on your game install itself. It finds the
          game, follows your saves, puts Long War or LWR in from their own downloads, manages your
          mods and the game’s settings, and keeps the originals of every file it changes.
        </p>
        <p class="download">
          <a v-if="installer.url" class="get" :href="installer.url" download>
            Download for Windows<template v-if="installer.version">
              · {{ installer.version }}</template
            >
          </a>
          <span v-else class="muted">The installer is not on this copy of the site.</span>
          <a
            v-if="installer.release"
            :href="installer.release"
            target="_blank"
            rel="noopener"
            class="small"
            >where it came from</a
          >
          <a v-else-if="installer.url" :href="`${APP_DIR}SHA256SUMS`" target="_blank" class="small"
            >checksum</a
          >
        </p>
        <p class="small muted">
          Windows 10 or 11 and XCOM: Enemy Within (Steam). Signed by innonova GmbH; while the app is
          new to Windows, SmartScreen may still hold it back (“More info” shows the publisher, then
          “Run anyway”). It updates itself, and checks every update’s signature first. Nothing is
          uploaded.
        </p>
      </div>
      <img :src="shot('research')" alt="The research tree with the game’s own picture of a tech" />
    </header>

    <article v-for="(f, i) in FEATURES" :key="f.shot" class="feature" :class="{ flip: i % 2 }">
      <div class="text">
        <h3>{{ f.title }}</h3>
        <p>{{ f.text }}</p>
      </div>
      <img :src="shot(f.shot)" :alt="f.alt" loading="lazy" />
    </article>

    <section class="credits" aria-labelledby="credits-title">
      <h3 id="credits-title">Credits</h3>
      <p>
        <a href="https://www.nexusmods.com/xcom/mods/88" target="_blank" rel="noopener">Long War</a>
        is by Long War Studios.
        <a href="https://www.nexusmods.com/xcom/mods/686" target="_blank" rel="noopener"
          >Long War Rebalance</a
        >
        is by its own team, built on Long War. Much of what this site knows was checked against
        <a href="https://www.ufopaedia.org/" target="_blank" rel="noopener">UFOpaedia</a>. Get both
        mods from their pages: the app does not include them, it works from your downloads.
      </p>
      <p class="muted">
        An unofficial fan tool, not affiliated with or endorsed by Firaxis Games or 2K. XCOM is a
        trademark of Take-Two Interactive Software, Inc. The game’s images in these screenshots
        belong to their owners; the app reads them from your own install and ships none of them.
      </p>
    </section>
  </section>
</template>

<style scoped>
.app-page {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px 40px;
}
.app-page > * {
  max-width: 1180px;
  margin-left: auto;
  margin-right: auto;
}
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 28px;
  align-items: center;
  margin-bottom: 28px;
}
h2 {
  margin: 0 0 8px;
  font-size: 26px;
}
.lead {
  font-size: 15px;
  line-height: 1.5;
}
.download {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 16px 0 8px;
}
.get {
  display: inline-block;
  padding: 9px 18px;
  border-radius: 5px;
  background: var(--accent);
  color: #04131f;
  font-weight: 700;
  text-decoration: none;
}
img {
  width: 100%;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  display: block;
}
.feature {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: 28px;
  align-items: center;
  padding: 22px 0;
  border-top: 1px solid var(--border);
}
.feature.flip .text {
  order: 2;
}
.feature h3 {
  margin: 0 0 6px;
  font-size: 17px;
}
.feature p {
  margin: 0;
  line-height: 1.5;
}
.credits {
  border-top: 1px solid var(--border);
  padding-top: 18px;
  font-size: 13.5px;
  line-height: 1.5;
}
.credits h3 {
  font-size: 15px;
  margin: 0 0 6px;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 12.5px;
}
@media (max-width: 900px) {
  .hero,
  .feature {
    grid-template-columns: minmax(0, 1fr);
  }
  .feature.flip .text {
    order: 0;
  }
}
</style>
