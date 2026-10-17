<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  backupBusy: boolean
}>()

const emit = defineEmits<{
  unlock: [password: string]
  create: []
  importBackup: [file: File]
  recover: []
}>()

const password = ref('')
const backupInput = ref<HTMLInputElement | null>(null)

function submit() {
  if (!password.value.trim()) {
    return
  }

  emit('unlock', password.value)
}

function openBackupPicker() {
  backupInput.value?.click()
}

function selectBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''

  if (file) {
    emit('importBackup', file)
  }
}
</script>

<template>
  <section class="auth-panel">
    <h1>Encrypted Journal</h1>
    <p class="muted">Your journal is locked. Enter your master password to continue.</p>

    <form class="auth-form" @submit.prevent="submit">
      <label>
        Master password
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          placeholder="Enter password"
          :disabled="props.backupBusy"
        />
      </label>

      <div class="action-row">
        <button class="primary-btn" type="submit" :disabled="props.backupBusy">Unlock</button>
        <button class="secondary-btn" type="button" :disabled="props.backupBusy" @click="emit('create')">
          Create new vault
        </button>
      </div>
    </form>

    <div class="backup-import">
      <p class="muted">Restore an encrypted backup from another browser profile.</p>
      <button class="secondary-btn" type="button" :disabled="props.backupBusy" @click="openBackupPicker">
        {{ props.backupBusy ? 'Restoring backup…' : 'Restore from backup' }}
      </button>
      <input
        ref="backupInput"
        class="visually-hidden"
        type="file"
        accept=".json,application/json"
        :disabled="props.backupBusy"
        tabindex="-1"
        aria-label="Choose an encrypted journal backup file"
        @change="selectBackup"
      />
    </div>
    <button class="text-button" type="button" :disabled="props.backupBusy" @click="emit('recover')">
      Forgot your password? Recover with your key
    </button>
  </section>
</template>
