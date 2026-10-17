<script setup lang="ts">
interface Props {
  status: 'idle' | 'unsaved' | 'saving' | 'saved' | 'failed'
}

const props = defineProps<Props>()

const labelMap = {
  idle: 'Ready',
  unsaved: 'Unsaved changes',
  saving: 'Saving',
  saved: 'Saved',
  failed: 'Save failed',
} as const
</script>

<template>
  <div class="save-status" :data-status="props.status">
    {{ labelMap[props.status] }}
  </div>
</template>
