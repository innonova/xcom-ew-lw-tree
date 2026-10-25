<script setup lang="ts">
// The desktop app's updates, in Help's "This app" (features/desktop-updates.md):
// what runs, checking, and what is ready, each with what to do and, once
// clicked, what is happening ("Installing app 0.3.6: the app closes now…"),
// so nothing can be pressed twice and nothing happens unsaid.

import { checkForUpdates, installNewApp, restartIntoUpdate, updates } from '@/state/updates'

const time = (iso: string) => new Date(iso).toLocaleTimeString()
</script>

<template>
  <div v-if="updates.state" class="update-panel">
    <p>
      App {{ updates.state.shellVersion }} · site {{ updates.state.serving }}. It fetches new
      versions of the site by itself, checks they are the ones we released, and asks before it
      switches.
    </p>
    <p class="row">
      <button
        type="button"
        :disabled="updates.state.checking || updates.phase !== 'idle'"
        @click="checkForUpdates()"
      >
        {{ updates.state.checking ? 'Checking…' : 'Check for updates' }}
      </button>
      <span v-if="updates.state.checking" class="muted">asking the update server…</span>
      <span v-else-if="updates.state.unconfirmed" class="error">{{ updates.state.error }}</span>
      <span v-else-if="updates.state.error" class="error">
        The last check failed: {{ updates.state.error }}</span
      >
      <span
        v-else-if="updates.state.lastCheck && !updates.state.ready && !updates.state.shell"
        class="ok"
      >
        ✓ Up to date, as of {{ time(updates.state.lastCheck) }}.</span
      >
    </p>

    <div v-if="updates.state.ready" class="found" role="status">
      <p>
        <strong>A new site is ready:</strong> {{ updates.state.ready }}. It is used at the next
        start, or now:
      </p>
      <p class="row">
        <button
          type="button"
          class="primary"
          :disabled="updates.phase !== 'idle'"
          @click="restartIntoUpdate()"
        >
          {{ updates.phase === 'restarting' ? 'Restarting…' : 'Restart into it' }}
        </button>
        <span v-if="updates.phase === 'restarting'" class="muted"
          >the page reloads in a moment</span
        >
      </p>
    </div>

    <div v-if="updates.state.shell" class="found" role="status">
      <p>
        <strong>A new app is out:</strong> {{ updates.state.shell.version
        }}<template v-if="updates.state.shell.needed"> (the newest site needs it)</template>.
      </p>
      <p v-if="updates.phase === 'fetching-app' || updates.state.shell.fetching" class="row busy">
        <span class="spinner" aria-hidden="true" /> Downloading app
        {{ updates.state.shell.version }} and checking its signature… this can take a minute.
      </p>
      <p v-else-if="updates.phase === 'installing-app'" class="row busy">
        <span class="spinner" aria-hidden="true" /> Installing app
        {{ updates.state.shell.version }}: the app closes now and starts again by itself in about 20
        seconds.
      </p>
      <p v-else class="row">
        <button type="button" class="primary" @click="installNewApp()">
          Install it and restart
        </button>
        <span class="muted">{{
          updates.state.shell.downloaded ? 'downloaded and checked' : 'it is downloaded first'
        }}</span>
      </p>
    </div>
    <p v-if="updates.error" class="error">{{ updates.error }}</p>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.found {
  border-left: 3px solid var(--accent);
  padding: 2px 0 2px 10px;
  margin: 8px 0;
}
.found p {
  margin: 4px 0;
}
.muted {
  color: var(--muted);
}
.ok {
  color: var(--done-text);
}
.error {
  color: var(--danger, #e66);
}
.busy {
  color: var(--text);
}
.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--accent);
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
button.primary {
  background: var(--accent);
  color: #04131f;
  border: none;
  font-weight: 600;
}
button.primary:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
