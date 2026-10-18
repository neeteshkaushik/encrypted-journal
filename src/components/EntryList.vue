<script setup lang="ts">
import type { NotePayload } from '../types/note'

interface NoteListItem {
  id: string
  payload: NotePayload
  isConflictCopy?: boolean
}

const props = defineProps<{
  notes: NoteListItem[]
  selectedNoteId: string | null
  disabled: boolean
}>()

const emit = defineEmits<{
  select: [noteId: string]
  create: []
}>()
</script>

<template>
  <aside class="entry-list">
    <button class="primary-btn" type="button" :disabled="props.disabled" @click="emit('create')">New note</button>

    <ul v-if="props.notes.length">
      <li v-for="note in props.notes" :key="note.id" :class="{ active: note.id === props.selectedNoteId }">
        <button type="button" :disabled="props.disabled" @click="emit('select', note.id)">
          {{ note.payload.title || 'Untitled note' }}{{ note.isConflictCopy ? ' (conflict copy)' : '' }}
        </button>
      </li>
    </ul>

    <p v-else class="muted">No notes yet</p>
  </aside>
</template>
