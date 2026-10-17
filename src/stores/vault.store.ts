import { defineStore } from 'pinia'

interface VaultUiState {
  isUnlocked: boolean
  vaultId: string | null
  recoveryKey: string | null
}

export const useVaultStore = defineStore('vault', {
  state: (): VaultUiState => ({
    isUnlocked: false,
    vaultId: null,
    recoveryKey: null,
  }),
  actions: {
    lock() {
      this.isUnlocked = false
      this.vaultId = null
      this.recoveryKey = null
    },
    unlock(vaultId: string, recoveryKey?: string) {
      this.isUnlocked = true
      this.vaultId = vaultId
      this.recoveryKey = recoveryKey ?? null
    },
  },
})
