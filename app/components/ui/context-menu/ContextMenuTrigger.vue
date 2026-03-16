<script setup lang="ts">
import type { ContextMenuTriggerProps } from "reka-ui"
import { ContextMenuTrigger, useForwardProps } from "reka-ui"

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<ContextMenuTriggerProps>()

const forwardedProps = useForwardProps(props)
</script>

<template>
  <ContextMenuTrigger
    data-slot="context-menu-trigger"
    v-bind="{ ...forwardedProps, ...$attrs }"
    class="contents"
  >
    <slot />
  </ContextMenuTrigger>
</template>
