<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { listVaults } from '../services/vault.service'

interface VaultOption {
  vaultId: string
  createdAt: string
}

const props = defineProps<{
  busy: boolean
}>()

const emit = defineEmits<{
  cancel: []
  recover: [vaultId: string, recoveryKey: string, newPassword: string]
}>()

const vaults = ref<VaultOption[]>([])
const selectedVaultId = ref('')
const recoveryKey = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const loadError = ref('')

onMounted(async () => {
  try {
    const records = await listVaults()
    vaults.value = records.map(({ vaultId, createdAt }) => ({ vaultId, createdAt }))
    selectedVaultId.value = vaults.value[0]?.vaultId ?? ''
  } catch {
    loadError.value = 'Unable to load local vaults. Please try again.'
  }
})

function submit() {
  if (
    props.busy ||
    !selectedVaultId.value ||
    !/^[0-9a-fA-F]{64}$/.test(recoveryKey.value) ||
    newPassword.value.length < 8 ||
    newPassword.value !== confirmPassword.value
  ) {
    return
  }

  emit('recover', selectedVaultId.value, recoveryKey.value, newPassword.value)
}
</script>

<template>
  <section class="auth-panel">
    <h1>Recover your vault</h1>
    <p class="muted">
      Enter the recovery key saved when you created this vault. Recovery will set a new master password.
    </p>

    <p v-if="loadError" class="error-message" role="alert">{{ loadError }}</p>
    <template v-if="loadError || !vaults.length">
      <p v-if="!loadError" class="muted">No local vaults are available to recover.</p>
      <button class="secondary-btn" type="button" :disabled="props.busy" @click="emit('cancel')">Back</button>
    </template>

    <form v-if="!loadError && vaults.length" class="auth-form" @submit.prevent="submit">
      <label>
        Vault
        <select v-model="selectedVaultId" :disabled="props.busy">
          <option v-for="vault in vaults" :key="vault.vaultId" :value="vault.vaultId">
            Vault created {{ new Date(vault.createdAt).toLocaleDateString() }}
          </option>
        </select>
      </label>

      <label>
        Recovery key
        <input
          v-model="recoveryKey"
          type="password"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          maxlength="64"
          placeholder="64-character recovery key"
          :disabled="props.busy"
        />
      </label>
      <p v-if="recoveryKey && !/^[0-9a-fA-F]{64}$/.test(recoveryKey)" class="form-hint error-text">
        Enter the 64-character hexadecimal recovery key.
      </p>

      <label>
        New master password
        <input
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          placeholder="At least 8 characters"
          :disabled="props.busy"
        />
      </label>
      <p v-if="newPassword && newPassword.length < 8" class="form-hint error-text">
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
      <p v-if="confirmPassword && newPassword !== confirmPassword" class="form-hint error-text">
        The passwords do not match.
      </p>

      <div class="action-row">
        <button
          class="primary-btn"
          type="submit"
          :disabled="props.busy || !selectedVaultId || !/^[0-9a-fA-F]{64}$/.test(recoveryKey) || newPassword.length < 8 || newPassword !== confirmPassword"
        >
          {{ props.busy ? 'Recovering…' : 'Recover vault' }}
        </button>
        <button class="secondary-btn" type="button" :disabled="props.busy" @click="emit('cancel')">Cancel</button>
      </div>
    </form>
  </section>
</template>
