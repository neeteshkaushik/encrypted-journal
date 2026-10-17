<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  create: [password: string]
  cancel: []
}>()

const password = ref('')
const confirmPassword = ref('')

function submit() {
  if (!password.value || password.value.length < 8) {
    return
  }

  if (password.value !== confirmPassword.value) {
    return
  }

  emit('create', password.value)
}
</script>

<template>
  <section class="auth-panel">
    <h1>Create a vault</h1>
    <p class="muted">
      Choose a strong master password. If you lose both your password and recovery key, your journal cannot be recovered.
    </p>

    <form class="auth-form" @submit.prevent="submit">
      <label>
        Master password
        <input v-model="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" />
      </label>

      <label>
        Confirm password
        <input v-model="confirmPassword" type="password" autocomplete="new-password" placeholder="Repeat your password" />
      </label>

      <div class="action-row">
        <button class="primary-btn" type="submit">Create vault</button>
        <button class="secondary-btn" type="button" @click="emit('cancel')">Cancel</button>
      </div>
    </form>
  </section>
</template>
