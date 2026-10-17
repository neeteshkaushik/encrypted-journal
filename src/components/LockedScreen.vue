<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  unlock: [password: string]
  create: []
}>()

const password = ref('')

function submit() {
  if (!password.value.trim()) {
    return
  }

  emit('unlock', password.value)
}
</script>

<template>
  <section class="auth-panel">
    <h1>Encrypted Journal</h1>
    <p class="muted">Your journal is locked. Enter your master password to continue.</p>

    <form class="auth-form" @submit.prevent="submit">
      <label>
        Master password
        <input v-model="password" type="password" autocomplete="current-password" placeholder="Enter password" />
      </label>

      <div class="action-row">
        <button class="primary-btn" type="submit">Unlock</button>
        <button class="secondary-btn" type="button" @click="emit('create')">Create new vault</button>
      </div>
    </form>
  </section>
</template>
