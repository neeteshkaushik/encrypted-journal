<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import EntryList from './components/EntryList.vue'
import JournalEditor from './components/JournalEditor.vue'
import LockedScreen from './components/LockedScreen.vue'
import RecoveryKeyView from './components/RecoveryKeyView.vue'
import SaveStatus from './components/SaveStatus.vue'
import VaultSetup from './components/VaultSetup.vue'
import { createVault, unlockAnyVault } from './services/vault.service'
import { deleteNote, listNotesForVault, loadEncryptedNote, saveEncryptedNote } from './services/note.service'
import { useVaultStore } from './stores/vault.store'
import type { NotePayload } from './types/note'

interface NoteListItem {
  id: string
  payload: NotePayload
}

const vaultStore = useVaultStore()
const setupMode = ref(false)
const recoveryViewOpen = ref(false)
const password = ref('')
const error = ref('')
const saveStatus = ref<'idle' | 'unsaved' | 'saving' | 'saved' | 'failed'>('idle')
const activeVaultKey = ref<Uint8Array | null>(null)
const noteList = ref<NoteListItem[]>([])
const selectedNoteId = ref<string | null>(null)
const currentDraft = ref<NotePayload | null>(null)
const pendingVaultId = ref<string | null>(null)
const pendingVaultKey = ref<Uint8Array | null>(null)
const pendingRecoveryKey = ref('')
const inactivityTimer = ref<number | null>(null)
let saveTimeout: ReturnType<typeof setTimeout> | null = null
let draftVersion = 0

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
  currentDraft.value = null
  selectedNoteId.value = null
  noteList.value = []
  saveStatus.value = 'idle'
}

function lockJournal() {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }

  activeVaultKey.value = null
  password.value = ''
  clearDraft()
  vaultStore.lock()
}

async function loadNotesForActiveVault() {
  const vaultId = vaultStore.vaultId
  if (!vaultId || !activeVaultKey.value) {
    return
  }

  const storedNotes = await listNotesForVault(vaultId)
  const decryptedNotes = await Promise.all(
    storedNotes.map(async (record) => {
      const payload = await loadEncryptedNote(vaultId, record.noteId, activeVaultKey.value as Uint8Array)
      return { id: record.noteId, payload }
    }),
  )

  noteList.value = decryptedNotes

  if (!selectedNoteId.value && decryptedNotes.length) {
    selectedNoteId.value = decryptedNotes[0].id
    currentDraft.value = decryptedNotes[0].payload
  }
}

async function handleUnlock(passwordValue: string) {
  try {
    const { vault, vaultKey } = await unlockAnyVault(passwordValue)
    vaultStore.unlock(vault.vaultId)
    activeVaultKey.value = vaultKey
    await loadNotesForActiveVault()
    if (!currentDraft.value && noteList.value.length) {
      currentDraft.value = noteList.value[0].payload
      selectedNoteId.value = noteList.value[0].id
    }
    error.value = ''
    saveStatus.value = 'saved'
    resetInactivityTimer()
  } catch {
    error.value = 'Unable to unlock this vault. Please check your password and try again.'
  }
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

function confirmRecoveryKey() {
  if (!pendingVaultId.value || !pendingVaultKey.value) {
    return
  }

  vaultStore.unlock(pendingVaultId.value)
  activeVaultKey.value = pendingVaultKey.value
  selectedNoteId.value = null
  currentDraft.value = createEmptyNotePayload()
  noteList.value = []
  recoveryViewOpen.value = false
  resetInactivityTimer()
}

function selectNote(noteId: string) {
  if (!noteList.value.length) {
    return
  }

  const match = noteList.value.find((note) => note.id === noteId)
  if (!match) {
    return
  }

  draftVersion += 1
  selectedNoteId.value = noteId
  currentDraft.value = match.payload
  resetInactivityTimer()
}

function createNewNote() {
  draftVersion += 1
  const nextId = crypto.randomUUID()
  const payload = createEmptyNotePayload()
  noteList.value = [{ id: nextId, payload }, ...noteList.value]
  selectedNoteId.value = nextId
  currentDraft.value = payload
  saveStatus.value = 'idle'
  resetInactivityTimer()
}

async function persistDraft() {
  if (!vaultStore.vaultId || !activeVaultKey.value || !currentDraft.value) {
    return
  }

  const versionAtSave = draftVersion
  const draftAtSave = currentDraft.value
  const noteId = selectedNoteId.value ?? crypto.randomUUID()
  const payload: NotePayload = {
    ...draftAtSave,
    title: draftAtSave.title || 'Untitled note',
    body: draftAtSave.body || '',
    updatedAt: new Date().toISOString(),
    revision: (draftAtSave.revision ?? 0) + 1,
  }

  saveStatus.value = 'saving'

  try {
    const saved = await saveEncryptedNote(vaultStore.vaultId, activeVaultKey.value, payload, noteId)
    selectedNoteId.value = saved.noteId
    const nextEntry = { id: saved.noteId, payload }
    const updatedList = noteList.value.filter((item) => item.id !== saved.noteId)
    noteList.value = [nextEntry, ...updatedList]
    if (draftVersion === versionAtSave) {
      currentDraft.value = payload
      saveStatus.value = 'saved'
    }
  } catch {
    if (draftVersion === versionAtSave) {
      saveStatus.value = 'failed'
    }
  }
}

function handleDraftChange(nextPayload: NotePayload) {
  currentDraft.value = nextPayload
  if (!vaultStore.isUnlocked || !activeVaultKey.value) {
    return
  }

  draftVersion += 1
  saveStatus.value = 'unsaved'

  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }

  saveTimeout = setTimeout(() => {
    void persistDraft()
  }, 700)

  resetInactivityTimer()
}

async function handleDelete() {
  if (!selectedNoteId.value || !vaultStore.vaultId) {
    return
  }

  try {
    await deleteNote(selectedNoteId.value)
    noteList.value = noteList.value.filter((note) => note.id !== selectedNoteId.value)
    selectedNoteId.value = noteList.value[0]?.id ?? null
    currentDraft.value = noteList.value[0]?.payload ?? null
  } catch {
    saveStatus.value = 'failed'
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', resetInactivityTimer)
  window.addEventListener('keydown', resetInactivityTimer)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', resetInactivityTimer)
  window.removeEventListener('keydown', resetInactivityTimer)
})
</script>

<template>
  <main class="app-shell">
    <div v-if="!vaultStore.isUnlocked" class="locked-wrap">
      <RecoveryKeyView v-if="recoveryViewOpen" :recovery-key="pendingRecoveryKey" @confirm="confirmRecoveryKey" />
      <LockedScreen v-else-if="!setupMode" @unlock="handleUnlock" @create="setupMode = true" />
      <VaultSetup v-else @create="handleCreateVault" @cancel="setupMode = false" />
      <p v-if="error" class="error-message">{{ error }}</p>
    </div>

    <div v-else class="journal-layout">
      <EntryList :notes="noteList" :selected-note-id="selectedNoteId" @select="selectNote" @create="createNewNote" />
      <div class="editor-panel">
        <div class="editor-header">
          <h2>Journal</h2>
          <SaveStatus :status="saveStatus" />
        </div>

        <JournalEditor :draft="currentDraft" @update-draft="handleDraftChange" @delete="handleDelete" @lock="lockJournal" />
      </div>
    </div>
  </main>
</template>
