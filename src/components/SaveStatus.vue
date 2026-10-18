<script setup lang="ts">
interface Props {
  status: 'idle' | 'unsaved' | 'saving' | 'saved' | 'failed'
}

const props = defineProps<Props>()

</script>

<template>
  <div v-if="props.status === 'failed'" class="save-status" role="alert">
    Could not save changes
  </div>
</template>
