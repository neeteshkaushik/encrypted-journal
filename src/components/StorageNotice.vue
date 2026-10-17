<script setup lang="ts">
const emit = defineEmits<{
  dismiss: []
}>()
</script>

<template>
  <aside class="storage-notice" aria-label="Storage and recovery information">
    <button
      class="storage-notice-close"
      type="button"
      aria-label="Dismiss storage warning"
      title="Dismiss"
      @click="emit('dismiss')"
    >
      ×
    </button>
    <strong>Your journal is stored only in this browser.</strong>
    <span>
      Browser data can be cleared or evicted. Export an encrypted backup and keep it somewhere separate. You need your
      master password or recovery key to unlock a restored vault.
    </span>
  </aside>
</template>
