<script setup lang="ts">
import { ref } from 'vue'

import SyncAccount from './SyncAccount.vue'

const props = defineProps<{
  backupBusy: boolean
  exportingBackup: boolean
  syncBusy: boolean
  syncAuthenticated: boolean
  unlocked: boolean
  vaultId: string | null
}>()

const emit = defineEmits<{
  back: []
  exportBackup: []
  syncNow: []
  importBackup: [file: File]
  authenticated: [value: boolean]
  downloaded: [vaultId: string]
}>()

const backupInput = ref<HTMLInputElement | null>(null)
const copyStatus = ref<'idle' | 'copied' | 'failed'>('idle')

function selectBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) {
    emit('importBackup', file)
  }
}

async function copyVaultId() {
  if (!props.vaultId) {
    return
  }
  try {
    await navigator.clipboard.writeText(props.vaultId)
    copyStatus.value = 'copied'
  } catch {
    copyStatus.value = 'failed'
  }
}
</script>

<template>
  <main class="settings-screen">
    <header class="settings-header">
      <div>
        <p class="eyebrow">Journal preferences</p>
        <h1>Settings</h1>
        <p class="muted">Manage sync and backups. These are separate ways to keep journal data available.</p>
      </div>
      <button class="secondary-btn" type="button" @click="emit('back')">
        {{ props.unlocked ? 'Back to journal' : 'Back to unlock' }}
      </button>
    </header>

    <section v-if="props.unlocked" class="settings-section">
      <p class="eyebrow">This device</p>
      <h2>Current journal</h2>
      <p class="muted">
        Notes are encrypted and stored in this browser. Your master password unlocks them; the recovery key can restore access.
      </p>
      <div v-if="props.vaultId" class="settings-vault-id">
        <div>
          <strong>This device’s journal</strong>
          <code>{{ props.vaultId }}</code>
        </div>
        <button class="quiet-btn" type="button" @click="copyVaultId">
          {{ copyStatus === 'copied' ? 'Copied' : 'Copy ID' }}
        </button>
      </div>
      <p v-if="copyStatus === 'failed'" class="form-hint error-text" role="alert">
        Could not access the clipboard. Select and copy the journal ID manually.
      </p>
    </section>

    <section class="settings-section">
      <p class="eyebrow">Sync across browsers</p>
      <SyncAccount
        @authenticated="emit('authenticated', $event)"
        @downloaded="emit('downloaded', $event)"
      />
      <button
        v-if="props.unlocked"
        class="secondary-btn"
        type="button"
        :disabled="props.syncBusy || !props.syncAuthenticated"
        @click="emit('syncNow')"
      >
        {{ props.syncBusy ? 'Syncing…' : 'Sync now' }}
      </button>
      <p v-if="props.unlocked && !props.syncAuthenticated" class="form-hint">
        Sign in above to sync this journal.
      </p>
    </section>

    <section class="settings-section">
      <p class="eyebrow">Portable copy</p>
      <h2>Encrypted backup</h2>
      <p class="muted">
        A backup is a file you control, separate from this browser’s storage and cloud sync.
        Keep it somewhere safe; the journal master password is required to unlock a restored vault.
      </p>
      <div class="settings-actions">
        <button
          v-if="props.unlocked"
          class="secondary-btn"
          type="button"
          :disabled="props.exportingBackup || props.backupBusy"
          @click="emit('exportBackup')"
        >
          {{ props.exportingBackup ? 'Preparing backup…' : 'Export encrypted backup' }}
        </button>
        <button
          class="secondary-btn"
          type="button"
          :disabled="props.backupBusy || props.exportingBackup"
          @click="backupInput?.click()"
        >
          {{ props.backupBusy ? 'Restoring backup…' : 'Restore encrypted backup' }}
        </button>
        <input
          ref="backupInput"
          class="visually-hidden"
          type="file"
          accept=".json,application/json"
          :disabled="props.backupBusy || props.exportingBackup"
          tabindex="-1"
          aria-label="Choose an encrypted journal backup file"
          @change="selectBackup"
        />
      </div>
      <p class="form-hint">
        Restore adds a vault to this browser; it never replaces an existing vault or note.
      </p>
    </section>

    <aside class="settings-storage-note">
      <strong>About browser storage</strong>
      <span>
        Clearing this browser’s data can remove its local journal. A cloud sync account and an exported backup are separate copies.
      </span>
    </aside>
  </main>
</template>
