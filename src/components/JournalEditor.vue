<script setup lang="ts">
import type { NotePayload } from '../types/note'

const props = defineProps<{
  draft: NotePayload | null
}>()

const emit = defineEmits<{
  updateDraft: [payload: NotePayload]
  delete: []
  lock: []
}>()

function updateField(field: 'title' | 'body', value: string) {
  if (!props.draft) {
    return
  }

  const nextPayload = {
    ...props.draft,
    [field]: value,
    updatedAt: new Date().toISOString(),
  }

  emit('updateDraft', nextPayload)
}
</script>

<template>
  <section v-if="props.draft" class="editor-shell">
    <div class="editor-toolbar">
      <button class="secondary-btn" type="button" @click="emit('lock')">Lock</button>
      <button class="danger-btn" type="button" @click="emit('delete')">Delete</button>
    </div>

    <input
      :value="props.draft.title"
      type="text"
      class="title-input"
      placeholder="Untitled note"
      @input="updateField('title', ($event.target as HTMLInputElement).value)"
    />

    <textarea
      :value="props.draft.body"
      class="editor-body"
      placeholder="Write something private..."
      @input="updateField('body', ($event.target as HTMLTextAreaElement).value)"
    />
  </section>

  <section v-else class="editor-empty">
    <p>Select a note or create a new one.</p>
  </section>
</template>
