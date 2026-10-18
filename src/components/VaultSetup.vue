<script setup lang="ts">
import { computed, ref } from 'vue'

const emit = defineEmits<{
  create: [password: string]
  cancel: []
}>()

const password = ref('')
const confirmPassword = ref('')
const passwordValid = computed(() => password.value.length >= 8)
const passwordsMatch = computed(() => password.value === confirmPassword.value)
const canCreateVault = computed(() => passwordValid.value && passwordsMatch.value)

function submit() {
  if (!canCreateVault.value) {
    return
  }

  emit('create', password.value)
}
</script>

<template>
  <section class="auth-panel">
    <h1>Create a vault</h1>
    <p class="muted">
      This password unlocks your journal on this device. Choose one you can
      remember; if you lose both it and your recovery key, your journal cannot
      be recovered.
    </p>
    <p class="setup-note">
      After setup, save your recovery key somewhere safe. Sync is optional and
      uses a separate account; it never replaces your journal password.
    </p>

    <form class="auth-form" @submit.prevent="submit">
      <label>
        Master password
        <input
          v-model="password"
          type="password"
          autocomplete="new-password"
          placeholder="At least 8 characters"
          minlength="8"
          required
        />
      </label>
      <p v-if="password && !passwordValid" class="form-hint">Use at least 8 characters.</p>

      <label>
        Confirm password
        <input
          v-model="confirmPassword"
          type="password"
          autocomplete="new-password"
          placeholder="Enter it again"
          required
        />
      </label>
      <p v-if="confirmPassword && !passwordsMatch" class="form-hint error-text">These passwords do not match.</p>

      <div class="action-row">
        <button class="primary-btn" type="submit" :disabled="!canCreateVault">Create vault</button>
        <button class="secondary-btn" type="button" @click="emit('cancel')">Cancel</button>
      </div>
    </form>
  </section>
</template>
