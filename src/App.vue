<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { db } from './db'
import EntryList from './components/EntryList.vue'
import JournalEditor from './components/JournalEditor.vue'
import LockedScreen from './components/LockedScreen.vue'
import PasswordChangeForm from './components/PasswordChangeForm.vue'
import RecoveryForm from './components/RecoveryForm.vue'
import RecoveryKeyView from './components/RecoveryKeyView.vue'
import SaveStatus from './components/SaveStatus.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import VaultSetup from './components/VaultSetup.vue'
import {
  changePassword,
  createVault,
  getVault,
  recoverVaultWithNewPassword,
  unlockVault,
  unlockAnyVault,
} from './services/vault.service'
import { exportEncryptedBackup, restoreEncryptedBackup } from './services/backup.service'
import { deleteNote, listNotesForVault, loadEncryptedNote, saveEncryptedNote } from './services/note.service'
import { syncVault } from './services/sync.service'
import { getSupabaseClient, isSupabaseConfigured } from './services/supabase.client'
import { useVaultStore } from './stores/vault.store'
import type { NotePayload } from './types/note'
import { createSerialQueue } from './utils/serialQueue'

interface NoteListItem {
  id: string
  payload: NotePayload
  isConflictCopy?: boolean
}

const vaultStore = useVaultStore()
const setupMode = ref(false)
const settingsOpen = ref(false)
const noteListCollapsed = ref(false)
const recoveryViewOpen = ref(false)
const recoveryMode = ref(false)
const passwordChangeOpen = ref(false)
const passwordChangeError = ref('')
const passwordChangeMessage = ref('')
const password = ref('')
const error = ref('')
const backupError = ref('')
const backupMessage = ref('')
const syncError = ref('')
const syncMessage = ref('')
const backupBusy = ref(false)
const exportingBackup = ref(false)
const saveStatus = ref<'idle' | 'unsaved' | 'saving' | 'saved' | 'failed'>('idle')
const activeVaultKey = ref<Uint8Array | null>(null)
const noteList = ref<NoteListItem[]>([])
const selectedNoteId = ref<string | null>(null)
const currentDraft = ref<NotePayload | null>(null)
const transitionPending = ref(false)
const transitionError = ref('')
const pendingVaultId = ref<string | null>(null)
const pendingVaultKey = ref<Uint8Array | null>(null)
const pendingRecoveryKey = ref('')
const remoteVaultIdToUnlock = ref<string | null>(null)
const inactivityTimer = ref<number | null>(null)
let saveTimeout: ReturnType<typeof setTimeout> | null = null
let draftVersion = 0
let draftDirty = false
const saveQueue = createSerialQueue()
const syncQueue = createSerialQueue()
const syncAuthenticated = ref(false)
const syncConnectionKnown = ref(false)
const syncConnectionFailed = ref(false)
const syncConfigured = isSupabaseConfigured()
const syncStatus = computed(() => {
  if (!syncConfigured) return 'unavailable'
  if (syncConnectionFailed.value) return 'unknown'
  if (!syncConnectionKnown.value) return 'checking'
  return syncAuthenticated.value ? 'connected' : 'disconnected'
})
const editorActionsMenu = ref<HTMLDetailsElement | null>(null)
let authSubscription: { unsubscribe: () => void } | undefined

function createEmptyNotePayload(): NotePayload {
  return {
    title: '',
    body: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [],
    revision: 0,
  }
}

function resetInactivityTimer() {
  if (!vaultStore.isUnlocked) {
    return
  }

  if (inactivityTimer.value) {
    window.clearTimeout(inactivityTimer.value)
  }

  inactivityTimer.value = window.setTimeout(() => {
    lockJournal()
  }, 5 * 60 * 1000)
}

function clearDraft() {
  draftVersion += 1
  draftDirty = false
  currentDraft.value = null
  selectedNoteId.value = null
  noteList.value = []
  saveStatus.value = 'idle'
}

function clearSaveTimeout() {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }
}

function closeEditorActionsMenu() {
  if (editorActionsMenu.value) {
    editorActionsMenu.value.open = false
  }
}

async function flushPendingDraft(): Promise<boolean> {
  clearSaveTimeout()

  while (true) {
    await saveQueue.idle()
    if (!draftDirty) {
      return true
    }

    const saved = await persistDraft()
    if (!saved) {
      return false
    }
  }
}

async function lockJournal() {
  if (!vaultStore.isUnlocked || transitionPending.value) {
    return
  }

  transitionPending.value = true
  transitionError.value = ''
  try {
    if (!(await flushPendingDraft())) {
      transitionError.value = 'Your changes could not be saved. The journal remains unlocked; try locking again to retry.'
      return
    }

    if (inactivityTimer.value) {
      window.clearTimeout(inactivityTimer.value)
      inactivityTimer.value = null
    }
    activeVaultKey.value = null
    password.value = ''
    clearDraft()
    vaultStore.lock()
  } finally {
    transitionPending.value = false
    if (vaultStore.isUnlocked) {
      resetInactivityTimer()
    }
  }
}

async function loadNotesForActiveVault() {
  const vaultId = vaultStore.vaultId
  if (!vaultId || !activeVaultKey.value) {
    return
  }

  const storedNotes = await listNotesForVault(vaultId)
  const syncStates = await db.syncNoteStates.where('vaultId').equals(vaultId).toArray()
  const conflictCopyIds = new Set(
    syncStates.filter((state) => state.conflictCopyFromChangeId).map((state) => state.noteId),
  )
  const decryptedNotes = await Promise.all(
    storedNotes.map(async (record) => {
      const payload = await loadEncryptedNote(vaultId, record.noteId, activeVaultKey.value as Uint8Array)
      return { id: record.noteId, payload, isConflictCopy: conflictCopyIds.has(record.noteId) }
    }),
  )

  decryptedNotes.sort((a, b) => b.payload.createdAt.localeCompare(a.payload.createdAt))
  noteList.value = decryptedNotes

  if (!selectedNoteId.value && decryptedNotes.length) {
    selectedNoteId.value = decryptedNotes[0].id
    currentDraft.value = decryptedNotes[0].payload
    draftDirty = false
  }
}

function handleSyncAuthenticationChange(authenticated: boolean) {
  if (syncAuthenticated.value === authenticated) {
    return
  }
  syncAuthenticated.value = authenticated
  if (authenticated && vaultStore.vaultId && activeVaultKey.value) {
    void runAutomaticSync(vaultStore.vaultId, activeVaultKey.value)
  } else if (!authenticated) {
    syncError.value = ''
  }
}

async function runAutomaticSync(vaultId: string, vaultKey: Uint8Array) {
  if (!syncAuthenticated.value) {
    return
  }

  const selectedId = selectedNoteId.value
  const versionAtSync = draftVersion
  syncError.value = ''
  syncMessage.value = ''

  try {
    const result = await syncQueue.enqueue(async () => {
      if (
        !syncAuthenticated.value ||
        vaultStore.vaultId !== vaultId ||
        activeVaultKey.value !== vaultKey
      ) {
        return null
      }
      return syncVault(vaultId, vaultKey)
    })
    if (!result || vaultStore.vaultId !== vaultId) {
      return
    }

    await loadNotesForActiveVault()
    if (draftVersion === versionAtSync && !draftDirty) {
      const selected = noteList.value.find((note) => note.id === selectedId)
      if (selected) {
        currentDraft.value = selected.payload
      }
    }
    if (result.warning) {
      syncMessage.value = result.warning
    }
  } catch (cause) {
    syncError.value = cause instanceof Error ? cause.message : 'Unable to sync this vault.'
  }
}

async function handleUnlock(passwordValue: string) {
  try {
    const remoteVaultId = remoteVaultIdToUnlock.value
    const unlocked = remoteVaultId
      ? await (async () => {
          const vault = await getVault(remoteVaultId)
          if (!vault) {
            throw new Error('Downloaded vault not found')
          }
          return { vault, vaultKey: await unlockVault(remoteVaultId, passwordValue) }
        })()
      : await unlockAnyVault(passwordValue)
    const { vault, vaultKey } = unlocked
    vaultStore.unlock(vault.vaultId)
    activeVaultKey.value = vaultKey
    remoteVaultIdToUnlock.value = null
    await loadNotesForActiveVault()
    if (!currentDraft.value && noteList.value.length) {
      currentDraft.value = noteList.value[0].payload
      selectedNoteId.value = noteList.value[0].id
    }
    error.value = ''
    transitionError.value = ''
    saveStatus.value = 'saved'
    resetInactivityTimer()
    if (syncAuthenticated.value) {
      void runAutomaticSync(vault.vaultId, vaultKey)
    }
  } catch {
    error.value = 'Unable to unlock this vault. Please check your password and try again.'
  }
}

function handleRemoteVaultDownloaded(vaultId: string) {
  remoteVaultIdToUnlock.value = vaultId
  syncMessage.value = `Vault ${vaultId} downloaded. Lock this vault and unlock the downloaded vault to continue.`
}

async function handleCreateVault(passwordValue: string) {
  try {
    const result = await createVault(passwordValue)
    pendingVaultId.value = result.vault.vaultId
    pendingVaultKey.value = result.vaultKey
    pendingRecoveryKey.value = Array.from(result.recoveryKey)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    recoveryViewOpen.value = true
    setupMode.value = false
    error.value = ''
    saveStatus.value = 'idle'
  } catch {
    error.value = 'Unable to create the vault. Please try a different password.'
  }
}

async function handleImportBackup(file: File) {
  backupBusy.value = true
  backupError.value = ''
  backupMessage.value = ''
  error.value = ''
  try {
    const result = await restoreEncryptedBackup(await file.text())
    backupMessage.value = `Backup restored (${result.noteCount} ${result.noteCount === 1 ? 'note' : 'notes'}). Unlock with the original master password.`
  } catch (cause) {
    backupError.value = cause instanceof Error ? cause.message : 'Unable to restore this backup.'
  } finally {
    backupBusy.value = false
  }
}

async function handleRecovery(vaultId: string, recoveryKeyHex: string, newPassword: string) {
  backupBusy.value = true
  backupError.value = ''
  backupMessage.value = ''
  error.value = ''
  try {
    const { vaultKey } = await recoverVaultWithNewPassword(vaultId, recoveryKeyHex, newPassword)
    recoveryMode.value = false
    vaultStore.unlock(vaultId)
    activeVaultKey.value = vaultKey
    selectedNoteId.value = null
    currentDraft.value = null
    noteList.value = []
    draftDirty = false
    transitionError.value = ''
    try {
      await loadNotesForActiveVault()
      if (!currentDraft.value) {
        currentDraft.value = noteList.value[0]?.payload ?? null
        selectedNoteId.value = noteList.value[0]?.id ?? null
      }
      saveStatus.value = noteList.value.length ? 'saved' : 'idle'
    } catch {
      transitionError.value = 'Your password was updated, but the journal could not be loaded. Lock and unlock again to retry.'
      saveStatus.value = 'failed'
    }
    resetInactivityTimer()
    if (syncAuthenticated.value) {
      void runAutomaticSync(vaultId, vaultKey)
    }
  } catch {
    backupError.value = 'Unable to recover this vault. Check the recovery key and try again.'
  } finally {
    backupBusy.value = false
  }
}

async function handlePasswordChange(currentPassword: string, nextPassword: string) {
  if (!vaultStore.vaultId || transitionPending.value) {
    return
  }

  transitionPending.value = true
  passwordChangeError.value = ''
  passwordChangeMessage.value = ''
  try {
    if (!(await flushPendingDraft())) {
      passwordChangeError.value = 'Your changes could not be saved. The password was not changed; try again.'
      return
    }

    await changePassword(vaultStore.vaultId, currentPassword, nextPassword)
    passwordChangeOpen.value = false
    passwordChangeMessage.value = 'Master password updated.'
    if (syncAuthenticated.value && activeVaultKey.value) {
      void runAutomaticSync(vaultStore.vaultId, activeVaultKey.value)
    }
  } catch {
    passwordChangeError.value = 'Unable to change the password. Check your current password and try again.'
  } finally {
    transitionPending.value = false
  }
}

async function handleExportBackup() {
  if (!vaultStore.vaultId || transitionPending.value) {
    return
  }

  transitionPending.value = true
  exportingBackup.value = true
  transitionError.value = ''
  try {
    if (!(await flushPendingDraft())) {
      transitionError.value = 'Your changes could not be saved. The backup was not created; try exporting again.'
      return
    }

    const backup = await exportEncryptedBackup(vaultStore.vaultId)
    const file = new Blob([backup], { type: 'application/json' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = `encrypted-journal-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch (cause) {
    transitionError.value = cause instanceof Error ? cause.message : 'Unable to export this backup.'
  } finally {
    transitionPending.value = false
    exportingBackup.value = false
  }
}

async function handleSync() {
  const vaultId = vaultStore.vaultId
  const vaultKey = activeVaultKey.value
  if (!vaultId || !vaultKey || transitionPending.value) {
    return
  }

  transitionPending.value = true
  syncError.value = ''
  syncMessage.value = ''
  try {
    if (!(await flushPendingDraft())) {
      syncError.value = 'Your changes could not be saved. Sync was not started; try again.'
      return
    }

    const selectedId = selectedNoteId.value
    const result = await syncQueue.enqueue(() => syncVault(vaultId, vaultKey))
    await loadNotesForActiveVault()
    const selected = noteList.value.find((note) => note.id === selectedId) ?? noteList.value[0]
    selectedNoteId.value = selected?.id ?? null
    currentDraft.value = selected?.payload ?? null
    draftDirty = false
    saveStatus.value = selected ? 'saved' : 'idle'

    syncMessage.value = result.warning ?? ''
  } catch (cause) {
    syncError.value = cause instanceof Error ? cause.message : 'Unable to sync this vault.'
  } finally {
    transitionPending.value = false
  }
}

function confirmRecoveryKey() {
  if (!pendingVaultId.value || !pendingVaultKey.value) {
    return
  }

  vaultStore.unlock(pendingVaultId.value)
  activeVaultKey.value = pendingVaultKey.value
  selectedNoteId.value = crypto.randomUUID()
  currentDraft.value = createEmptyNotePayload()
  draftDirty = false
  noteList.value = []
  recoveryViewOpen.value = false
  resetInactivityTimer()
  if (syncAuthenticated.value) {
    void runAutomaticSync(pendingVaultId.value, pendingVaultKey.value)
  }
}

async function selectNote(noteId: string) {
  if (!noteList.value.length || transitionPending.value) {
    return
  }

  const match = noteList.value.find((note) => note.id === noteId)
  if (!match) {
    return
  }

  if (noteId === selectedNoteId.value) {
    return
  }

  transitionPending.value = true
  transitionError.value = ''
  try {
    if (!(await flushPendingDraft())) {
      transitionError.value = 'Your changes could not be saved. The current note remains open; try selecting again to retry.'
      return
    }

    draftVersion += 1
    draftDirty = false
    selectedNoteId.value = noteId
    currentDraft.value = match.payload
    saveStatus.value = 'saved'
    resetInactivityTimer()
  } finally {
    transitionPending.value = false
  }
}

async function createNewNote() {
  if (transitionPending.value) {
    return
  }

  transitionPending.value = true
  transitionError.value = ''
  try {
    if (!(await flushPendingDraft())) {
      transitionError.value = 'Your changes could not be saved. The current note remains open; try creating a note again to retry.'
      return
    }

    draftVersion += 1
    draftDirty = false
    const nextId = crypto.randomUUID()
    const payload = createEmptyNotePayload()
    noteList.value = [{ id: nextId, payload }, ...noteList.value]
    selectedNoteId.value = nextId
    currentDraft.value = payload
    saveStatus.value = 'idle'
    resetInactivityTimer()
  } finally {
    transitionPending.value = false
  }
}

function persistDraft(): Promise<boolean> {
  const vaultId = vaultStore.vaultId
  const vaultKey = activeVaultKey.value
  const draftAtSave = currentDraft.value
  const noteId = selectedNoteId.value

  if (!vaultId || !vaultKey || !draftAtSave || !noteId || !draftDirty) {
    return Promise.resolve(false)
  }

  const versionAtSave = draftVersion
  const payload: NotePayload = {
    ...draftAtSave,
    title: draftAtSave.title || 'Untitled note',
    body: draftAtSave.body || '',
    updatedAt: new Date().toISOString(),
    revision: (draftAtSave.revision ?? 0) + 1,
  }

  return saveQueue.enqueue(async () => {
    if (draftVersion === versionAtSave) {
      saveStatus.value = 'saving'
    }

    try {
      const saved = await saveEncryptedNote(vaultId, vaultKey, payload, noteId)
      if (vaultStore.vaultId === vaultId) {
        const nextEntry = {
          id: saved.noteId,
          payload,
          isConflictCopy: noteList.value.find((item) => item.id === saved.noteId)?.isConflictCopy,
        }
        const existingIndex = noteList.value.findIndex((item) => item.id === saved.noteId)
        noteList.value =
          existingIndex === -1
            ? [nextEntry, ...noteList.value]
            : noteList.value.map((item, index) => (index === existingIndex ? nextEntry : item))
      }

      if (selectedNoteId.value === noteId && draftVersion === versionAtSave) {
        currentDraft.value = payload
        draftDirty = false
        saveStatus.value = 'saved'
      }
      if (syncAuthenticated.value) {
        void runAutomaticSync(vaultId, vaultKey)
      }
      return true
    } catch {
      if (selectedNoteId.value === noteId && draftVersion === versionAtSave) {
        saveStatus.value = 'failed'
      }
      return false
    }
  })
}

function handleDraftChange(nextPayload: NotePayload) {
  currentDraft.value = nextPayload
  if (!vaultStore.isUnlocked || !activeVaultKey.value) {
    return
  }

  draftVersion += 1
  draftDirty = true
  transitionError.value = ''
  saveStatus.value = 'unsaved'

  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }

  saveTimeout = setTimeout(() => {
    saveTimeout = null
    void persistDraft()
  }, 700)

  resetInactivityTimer()
}

async function handleDelete() {
  if (!selectedNoteId.value || !vaultStore.vaultId || transitionPending.value) {
    return
  }

  transitionPending.value = true
  transitionError.value = ''
  try {
    if (!(await flushPendingDraft())) {
      transitionError.value = 'Your changes could not be saved. The current note was not deleted; try deleting again to retry.'
      return
    }

    const noteId = selectedNoteId.value
    if (!noteId) {
      return
    }

    await deleteNote(noteId)
    noteList.value = noteList.value.filter((note) => note.id !== noteId)
    selectedNoteId.value = noteList.value[0]?.id ?? null
    currentDraft.value = noteList.value[0]?.payload ?? null
    draftVersion += 1
    draftDirty = false
    saveStatus.value = currentDraft.value ? 'saved' : 'idle'
    if (syncAuthenticated.value && activeVaultKey.value) {
      void runAutomaticSync(vaultStore.vaultId, activeVaultKey.value)
    }
  } catch {
    saveStatus.value = 'failed'
  } finally {
    transitionPending.value = false
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', resetInactivityTimer)
  window.addEventListener('keydown', resetInactivityTimer)

  if (syncConfigured) {
    const supabase = getSupabaseClient()
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) {
        throw sessionError
      }
      syncConnectionFailed.value = false
      syncConnectionKnown.value = true
      handleSyncAuthenticationChange(!!data.session?.user)
    }).catch((cause: unknown) => {
      syncConnectionFailed.value = true
      syncError.value = cause instanceof Error ? cause.message : 'Unable to check sync account status.'
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      syncConnectionFailed.value = false
      syncConnectionKnown.value = true
      handleSyncAuthenticationChange(!!session?.user)
    })
    authSubscription = data.subscription
  } else {
    syncConnectionKnown.value = true
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', resetInactivityTimer)
  window.removeEventListener('keydown', resetInactivityTimer)
  authSubscription?.unsubscribe()
})
</script>

<template>
  <main class="app-shell">
    <div v-if="settingsOpen" class="settings-wrap">
      <SettingsPanel
        :backup-busy="backupBusy"
        :exporting-backup="exportingBackup"
        :sync-busy="transitionPending"
        :sync-authenticated="syncAuthenticated"
        :unlocked="vaultStore.isUnlocked"
        :vault-id="vaultStore.vaultId"
        @back="settingsOpen = false"
        @export-backup="handleExportBackup"
        @sync-now="handleSync"
        @import-backup="handleImportBackup"
        @authenticated="handleSyncAuthenticationChange"
        @downloaded="handleRemoteVaultDownloaded"
      />
      <p v-if="backupError" class="error-message" role="alert">{{ backupError }}</p>
      <p v-if="backupMessage" class="success-message" role="status">{{ backupMessage }}</p>
      <p v-if="syncError" class="error-message" role="alert">{{ syncError }}</p>
      <p v-if="syncMessage" class="success-message" role="status">{{ syncMessage }}</p>
    </div>
    <div v-else-if="!vaultStore.isUnlocked" class="locked-wrap">
      <RecoveryKeyView v-if="recoveryViewOpen" :recovery-key="pendingRecoveryKey" @confirm="confirmRecoveryKey" />
      <RecoveryForm
        v-else-if="recoveryMode"
        :busy="backupBusy"
        @cancel="recoveryMode = false"
        @recover="handleRecovery"
      />
      <LockedScreen
        v-else-if="!setupMode"
        :backup-busy="backupBusy"
        :sync-status="syncStatus"
        @unlock="handleUnlock"
        @create="setupMode = true"
        @recover="recoveryMode = true"
        @settings="settingsOpen = true"
      />
      <VaultSetup v-else @create="handleCreateVault" @cancel="setupMode = false" />
      <p v-if="error" class="error-message">{{ error }}</p>
      <p v-if="backupError" class="error-message" role="alert">{{ backupError }}</p>
      <p v-if="backupMessage" class="success-message" role="status">{{ backupMessage }}</p>
    </div>

    <div v-else class="journal-layout" :class="{ 'note-list-collapsed': noteListCollapsed }">
      <EntryList
        v-if="!noteListCollapsed"
        :notes="noteList"
        :selected-note-id="selectedNoteId"
        :disabled="transitionPending"
        @select="selectNote"
        @create="createNewNote"
      />
      <div class="editor-panel">
        <div class="editor-header">
          <div class="editor-heading">
            <button
              class="quiet-btn"
              type="button"
              :aria-expanded="!noteListCollapsed"
              :aria-label="noteListCollapsed ? 'Show note list' : 'Hide note list'"
              @click="noteListCollapsed = !noteListCollapsed"
            >
              {{ noteListCollapsed ? 'Show notes' : 'Hide notes' }}
            </button>
            <h2>Journal</h2>
            <span
              class="sync-connection-indicator journal-sync-indicator"
              :class="syncStatus"
              :aria-label="`Sync status: ${syncStatus}`"
              :title="syncStatus === 'connected' ? 'Sync account connected' : syncStatus === 'disconnected' ? 'Sync account not connected' : syncStatus === 'unavailable' ? 'Sync is not configured for this app' : syncStatus === 'unknown' ? 'Sync connection status unavailable' : 'Checking sync connection'"
            >
              <span class="sync-indicator-dot" aria-hidden="true"></span>
              {{
                syncStatus === 'connected'
                  ? 'Sync connected'
                  : syncStatus === 'disconnected'
                    ? 'Sync off'
                    : syncStatus === 'unavailable'
                      ? 'Sync unavailable'
                      : syncStatus === 'unknown'
                        ? 'Sync status unavailable'
                        : 'Checking sync'
              }}
            </span>
            <button v-if="noteListCollapsed" class="quiet-btn new-note-action" type="button" :disabled="transitionPending" @click="createNewNote">
              New note
            </button>
          </div>
          <div class="editor-header-actions">
            <SaveStatus :status="saveStatus" />
            <details ref="editorActionsMenu" class="editor-actions-menu">
              <summary aria-label="More journal actions">More</summary>
              <div class="editor-actions-popover">
                <button class="quiet-btn" type="button" @click="settingsOpen = true; closeEditorActionsMenu()">
                  Settings
                </button>
                <button class="quiet-btn" type="button" :disabled="transitionPending" @click="passwordChangeOpen = !passwordChangeOpen; closeEditorActionsMenu()">
                  {{ passwordChangeOpen ? 'Close password form' : 'Change password' }}
                </button>
                <button class="quiet-btn" type="button" :disabled="transitionPending" @click="closeEditorActionsMenu(); lockJournal()">
                  Lock journal
                </button>
                <button class="quiet-btn danger-quiet-btn" type="button" :disabled="transitionPending" @click="closeEditorActionsMenu(); handleDelete()">
                  Delete note
                </button>
              </div>
            </details>
          </div>
        </div>
        <p v-if="transitionError" class="error-message" role="alert">{{ transitionError }}</p>
        <p v-if="syncError" class="error-message" role="alert">{{ syncError }}</p>
        <p v-if="syncMessage" class="success-message" role="status">{{ syncMessage }}</p>
        <p v-if="passwordChangeError" class="error-message" role="alert">{{ passwordChangeError }}</p>
        <p v-if="passwordChangeMessage" class="success-message" role="status">{{ passwordChangeMessage }}</p>
        <PasswordChangeForm
          v-if="passwordChangeOpen"
          :busy="transitionPending"
          @cancel="passwordChangeOpen = false"
          @change="handlePasswordChange"
        />

        <JournalEditor
          :draft="currentDraft"
          :disabled="transitionPending"
          @update-draft="handleDraftChange"
        />
      </div>
    </div>
  </main>
</template>
