<script setup lang="ts">
import { ref, watch } from "vue";

import { createIconRegistry } from "./index.ts";
import { parseIconRef, useIcons, type IconDef } from "./registry.ts";

const props = defineProps<{
    /** `"cog"` (Material) or `"pack:name"`. Any other string renders as literal text. */
    name: string;
    /** Shown when `name` is a well-formed icon name nothing resolves. */
    fallback?: string;
}>();

// Outside a shell there is no registry to inject; the built-in pack still works.
const registry = useIcons() ?? createIconRegistry();

const def = ref<IconDef | null>(null);
const missing = ref(false);

watch(
    () => props.name,
    (name) => {
        def.value = null;
        missing.value = false;
        if (parseIconRef(name) === null) return;
        const found = registry.resolve(name);
        if (found instanceof Promise) {
            found.then(
                (resolved) => {
                    if (props.name !== name) return;
                    def.value = resolved ?? null;
                    missing.value = resolved === undefined;
                },
                () => {
                    if (props.name === name) missing.value = true;
                },
            );
        } else {
            def.value = found ?? null;
            missing.value = found === undefined;
        }
    },
    { immediate: true },
);
</script>

<template>
    <svg
        v-if="def"
        class="tumult-icon"
        :viewBox="`0 0 ${def.viewBox ?? 24} ${def.viewBox ?? 24}`"
        width="1em"
        height="1em"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
    >
        <path :d="def.path" />
    </svg>
    <span v-else-if="parseIconRef(name) === null" class="tumult-icon-glyph" aria-hidden="true">{{ name }}</span>
    <span v-else-if="missing" class="tumult-icon-glyph" aria-hidden="true">{{ fallback }}</span>
    <span v-else class="tumult-icon" aria-hidden="true" />
</template>

<style scoped>
/* The svg is sized by its width/height attributes (the theme gate forbids
   literal lengths in a stylesheet), so a parent font-size drives it. */
.tumult-icon {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
}
</style>
