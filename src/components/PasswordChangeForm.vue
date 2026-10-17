<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  busy: boolean
}>()

const emit = defineEmits<{
  cancel: []
  change: [currentPassword: string, nextPassword: string]
}>()

const currentPassword = ref('')
const nextPassword = ref('')
const confirmPassword = ref('')

function submit() {
  if (
    props.busy ||
    !currentPassword.value ||
    nextPassword.value.length < 8 ||
    nextPassword.value !== confirmPassword.value
  ) {
    return
  }

  emit('change', currentPassword.value, nextPassword.value)
}
</script>

<template>
  <section class="auth-panel password-change-panel" aria-labelledby="password-change-title">
    <h2 id="password-change-title">Change master password</h2>
    <form class="auth-form" @submit.prevent="submit">
      <label>
        Current master password
        <input
          v-model="currentPassword"
          type="password"
          autocomplete="current-password"
          :disabled="props.busy"
        />
      </label>

      <label>
        New master password
        <input
          v-model="nextPassword"
          type="password"
          autocomplete="new-password"
          placeholder="At least 8 characters"
          :disabled="props.busy"
        />
      </label>
      <p v-if="nextPassword && nextPassword.length < 8" class="form-hint error-text">
        The new password must be at least 8 characters.
      </p>

      <label>
        Confirm new password
        <input
          v-model="confirmPassword"
          type="password"
          autocomplete="new-password"
          placeholder="Repeat the new password"
          :disabled="props.busy"
        />
      </label>
      <p v-if="confirmPassword && nextPassword !== confirmPassword" class="form-hint error-text">
        The passwords do not match.
      </p>

      <div class="action-row">
        <button
          class="primary-btn"
          type="submit"
          :disabled="props.busy || !currentPassword || nextPassword.length < 8 || nextPassword !== confirmPassword"
        >
          {{ props.busy ? 'Updating…' : 'Update password' }}
        </button>
        <button class="secondary-btn" type="button" :disabled="props.busy" @click="emit('cancel')">Cancel</button>
      </div>
    </form>
  </section>
</template>
