<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  backupBusy: boolean
  syncStatus: 'unavailable' | 'checking' | 'connected' | 'disconnected' | 'unknown'
}>()

const emit = defineEmits<{
  unlock: [password: string]
  create: []
  recover: []
  settings: []
}>()

const password = ref('')
const showPassword = ref(false)

function submit() {
  if (!password.value) {
    return
  }

  emit('unlock', password.value)
}

</script>

<template>
  <section class="auth-panel">
    <p class="eyebrow">Your private journal</p>
    <h1>Encrypted Journal</h1>
    <p class="muted home-intro">
      A quiet place for your thoughts. Your entries are encrypted on this
      device. Unlock them with your master password or recovery key.
    </p>
    <p
      class="sync-connection-indicator"
      :class="props.syncStatus"
      :aria-label="`Sync status: ${props.syncStatus}`"
    >
      <span class="sync-indicator-dot" aria-hidden="true"></span>
      {{
        props.syncStatus === 'connected'
          ? 'Sync account connected'
          : props.syncStatus === 'disconnected'
            ? 'Sync not connected'
            : props.syncStatus === 'unavailable'
              ? 'Sync unavailable'
              : props.syncStatus === 'unknown'
                ? 'Sync status unavailable'
                : 'Checking sync status…'
      }}
    </p>

    <form class="auth-form" @submit.prevent="submit">
      <label>
        <span>Master password</span>
        <span class="password-input-wrap">
          <input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            placeholder="Enter your journal password"
            required
            :disabled="props.backupBusy"
          />
          <button
            class="password-visibility"
            type="button"
            :aria-pressed="showPassword"
            :disabled="props.backupBusy"
            @click="showPassword = !showPassword"
          >
            {{ showPassword ? 'Hide' : 'Show' }}
          </button>
        </span>
      </label>

      <button class="primary-btn home-unlock-btn" type="submit" :disabled="props.backupBusy">
        {{ props.backupBusy ? 'Please wait…' : 'Unlock my journal' }}
      </button>
    </form>

    <p class="home-create">
      New to Encrypted Journal?
      <button class="text-button" type="button" :disabled="props.backupBusy" @click="emit('create')">
        Create a vault
      </button>
    </p>

    <div class="home-secondary-actions">
      <button class="quiet-btn" type="button" :disabled="props.backupBusy" @click="emit('recover')">
        Use recovery key
      </button>
      <button class="quiet-btn" type="button" :disabled="props.backupBusy" @click="emit('settings')">
        New browser? Restore or sync
      </button>
    </div>
  </section>
</template>
