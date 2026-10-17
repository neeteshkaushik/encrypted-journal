<script setup lang="ts">
import { computed, ref } from 'vue'

import type { NotePayload } from '../types/note'
import { maskCompletedWords } from '../utils/maskText'

const props = defineProps<{
  draft: NotePayload | null
}>()

const emit = defineEmits<{
  updateDraft: [payload: NotePayload]
  delete: []
  lock: []
}>()

const privacyMode = ref(false)
const titleMask = ref<HTMLElement | null>(null)
const bodyMask = ref<HTMLElement | null>(null)

const maskedTitle = computed(() => maskCompletedWords(props.draft?.title ?? ''))
const maskedBody = computed(() => maskCompletedWords(props.draft?.body ?? ''))

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

function syncScroll(input: HTMLInputElement | HTMLTextAreaElement, mask: HTMLElement | null) {
  if (mask) {
    mask.scrollLeft = input.scrollLeft
    mask.scrollTop = input.scrollTop
  }
}

function togglePrivacyMode() {
  privacyMode.value = !privacyMode.value
}
</script>

<template>
  <section v-if="props.draft" class="editor-shell">
    <div class="editor-toolbar">
      <button
        class="secondary-btn"
        type="button"
        :aria-pressed="privacyMode"
        @click="togglePrivacyMode"
      >
        {{ privacyMode ? 'Show all text' : 'Privacy mode' }}
      </button>
      <button class="secondary-btn" type="button" @click="emit('lock')">Lock</button>
      <button class="danger-btn" type="button" @click="emit('delete')">Delete</button>
    </div>

    <p v-if="privacyMode" class="privacy-hint">
      Completed text is masked on screen. The unfinished last word stays visible; this does not encrypt text in memory.
    </p>

    <div class="title-field">
      <div v-if="privacyMode" ref="titleMask" class="title-mask" aria-hidden="true">
        {{ maskedTitle }}
      </div>
      <input
        ref="titleInput"
        :value="props.draft.title"
        type="text"
        class="title-input"
        :class="{ 'is-masked': privacyMode }"
        :placeholder="privacyMode ? '' : 'Untitled note'"
        :aria-label="privacyMode ? 'Journal title, privacy mask enabled' : 'Journal title'"
        @input="updateField('title', ($event.target as HTMLInputElement).value)"
        @scroll="syncScroll($event.target as HTMLInputElement, titleMask)"
      />
    </div>

    <div class="body-field">
      <div v-if="privacyMode" ref="bodyMask" class="body-mask" aria-hidden="true">
        {{ maskedBody }}
      </div>
      <textarea
        ref="bodyInput"
        :value="props.draft.body"
        class="editor-body"
        :class="{ 'is-masked': privacyMode }"
        :placeholder="privacyMode ? '' : 'Write something private...'"
        :aria-label="privacyMode ? 'Journal text, privacy mask enabled' : 'Journal text'"
        @input="updateField('body', ($event.target as HTMLTextAreaElement).value)"
        @scroll="syncScroll($event.target as HTMLTextAreaElement, bodyMask)"
      />
    </div>
  </section>

  <section v-else class="editor-empty">
    <p>Select a note or create a new one.</p>
  </section>
</template>
