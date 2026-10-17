<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ recoveryKey: string }>()
const emit = defineEmits<{ confirm: [] }>()

const isSaved = ref(false)

async function copyKey() {
  try {
    await navigator.clipboard.writeText(props.recoveryKey)
  } catch {
    // Clipboard access can fail in some browser contexts; the key is still visible on screen.
  }
}
</script>

<template>
  <section class="auth-panel recovery-panel">
    <p class="eyebrow">Recovery key</p>
    <h1>Save this key</h1>
    <p class="muted">
      This key lets you recover your journal if you forget your master password. Store it somewhere safe and offline.
    </p>

    <div class="recovery-box">
      <code>{{ props.recoveryKey }}</code>
    </div>

    <div class="recovery-actions">
      <button type="button" class="secondary-btn" @click="copyKey">Copy key</button>
    </div>

    <label class="save-check">
      <input v-model="isSaved" type="checkbox" />
      I have saved this recovery key in a safe place.
    </label>

    <button class="primary-btn full-width" type="button" :disabled="!isSaved" @click="emit('confirm')">
      Continue to journal
    </button>
  </section>
</template>
