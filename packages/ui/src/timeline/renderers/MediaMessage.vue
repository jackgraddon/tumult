<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { EncryptedAttachment, MessageView } from "@tumult/core";

import { useMediaResolver, useEncryptedMediaResolver } from "../../media.ts";

const props = defineProps<{ message: MessageView }>();

const resolveMedia = useMediaResolver();
const resolveEncryptedMedia = useEncryptedMediaResolver();
const src = ref<string | null>(null);

const msgtype = computed(() =>
    typeof props.message.content["msgtype"] === "string" ? props.message.content["msgtype"] : "",
);
const mxcUrl = computed(() =>
    typeof props.message.content["url"] === "string" ? props.message.content["url"] : "",
);
const encryptedFile = computed(() => {
    const file = props.message.content["file"];
    if (!file || typeof file !== "object") return null;
    return file as unknown as EncryptedAttachment;
});
const body = computed(() => props.message.body);

const isImage = computed(() => msgtype.value === "m.image");

watch(
    [() => props.message.content["url"], encryptedFile],
    ([url, file]) => {
        src.value = null;
        if (file && resolveEncryptedMedia) {
            void resolveEncryptedMedia(file).then((resolved) => {
                src.value = resolved;
            }).catch((error: unknown) => {
                console.error("[tumult] encrypted media resolve failed", error);
            });
        } else if (typeof url === "string" && url.startsWith("mxc://") && resolveMedia) {
            void resolveMedia(url, 512).then((resolved) => {
                src.value = resolved;
            }).catch((error: unknown) => {
                console.error("[tumult] media resolve failed", error);
            });
        }
    },
    { immediate: true },
);
</script>

<template>
    <div class="tumult-media-message">
        <img
            v-if="isImage && src"
            class="tumult-media-message-image"
            :src="src"
            :alt="body"
            loading="lazy"
        />
        <p v-else-if="isImage" class="tumult-media-message-pending">{{ body }}</p>
        <template v-else>
            <p class="tumult-media-message-body">{{ body }}</p>
            <a
                v-if="mxcUrl"
                class="tumult-media-message-link"
                :href="mxcUrl"
                target="_blank"
                rel="noopener noreferrer"
                >Download</a
            >
        </template>
    </div>
</template>

<style scoped>
.tumult-media-message {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
}
.tumult-media-message-image {
    max-width: 320px;
    max-height: 240px;
    border-radius: var(--radius-md, 4px);
    object-fit: contain;
}
.tumult-media-message-pending,
.tumult-media-message-body {
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
.tumult-media-message-link {
    color: var(--accent-primary, #5865f2);
    font-size: var(--text-sm);
}
</style>
