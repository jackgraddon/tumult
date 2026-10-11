<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { EncryptedAttachment, MessageView } from "@tumult/core";
import { isTerminalMediaError } from "@tumult/core/media";

import {
    useEncryptedMediaResolver,
    useMediaDownloadResolver,
    useMediaResolver,
} from "../../media.ts";

const props = defineProps<{ message: MessageView }>();

const resolveThumbnail = useMediaResolver();
const resolveDownload = useMediaDownloadResolver();
const resolveEncrypted = useEncryptedMediaResolver();

type MediaKind = "image" | "video" | "audio" | "file";
type ResolveStatus = "idle" | "loading" | "ready" | "failed";

const status = ref<ResolveStatus>("idle");
const src = ref<string | null>(null);
/** A retry could plausibly succeed: a transient failure, not a 4xx verdict. */
const canRetry = ref(false);

const msgtype = computed(() =>
    typeof props.message.content["msgtype"] === "string" ? props.message.content["msgtype"] : "",
);
const kind = computed<MediaKind>(() => {
    if (msgtype.value === "m.image") return "image";
    if (msgtype.value === "m.video") return "video";
    if (msgtype.value === "m.audio") return "audio";
    return "file";
});
const mxcUrl = computed(() =>
    typeof props.message.content["url"] === "string" ? props.message.content["url"] : "",
);
const encryptedFile = computed(() => {
    const file = props.message.content["file"];
    if (!file || typeof file !== "object") return null;
    return file as unknown as EncryptedAttachment;
});
const body = computed(() => props.message.body);
const label = computed(() => {
    if (kind.value === "image") return "Image";
    if (kind.value === "video") return "Video";
    if (kind.value === "audio") return "Audio";
    return "File";
});

/**
 * The resolver this message needs, or null when the shell provided none
 * (tests, stories) — then the filename is the whole story, as documented.
 *
 * Images thumbnail; everything else downloads. The thumbnail endpoint is an
 * image pipeline and answers 400 for formats it cannot render, so asking it
 * for a video both fails and logs on every rebuild.
 */
const resolver = computed<(() => Promise<string>) | null>(() => {
    const file = encryptedFile.value;
    if (file) return resolveEncrypted ? () => resolveEncrypted(file) : null;
    const uri = mxcUrl.value;
    if (!uri.startsWith("mxc://")) return null;
    if (kind.value === "image") return resolveThumbnail ? () => resolveThumbnail(uri, 512) : null;
    return resolveDownload ? () => resolveDownload(uri) : null;
});

async function load(): Promise<void> {
    const run = resolver.value;
    if (!run) {
        status.value = "idle";
        return;
    }
    status.value = "loading";
    src.value = null;
    canRetry.value = false;
    try {
        src.value = await run();
        status.value = "ready";
    } catch (error) {
        // The resolver logs the first terminal failure (and every retryable
        // one); the UI's job here is the honest failed state, not another log.
        canRetry.value = !isTerminalMediaError(error);
        status.value = "failed";
    }
}

watch([() => props.message.content["url"], encryptedFile], load, { immediate: true });
</script>

<template>
    <div class="tumult-media-message">
        <template v-if="kind === 'image'">
            <img
                v-if="src"
                class="tumult-media-message-image"
                :src="src"
                :alt="body"
                loading="lazy"
            />
            <div v-else-if="status === 'failed'" class="tumult-media-message-failed">
                <span class="tumult-media-message-note">{{ label }} unavailable</span>
                <button v-if="canRetry" class="tumult-media-message-retry" type="button" @click="load">
                    Retry
                </button>
            </div>
            <p v-else class="tumult-media-message-pending">{{ body }}</p>
        </template>

        <template v-else>
            <video
                v-if="kind === 'video' && src"
                class="tumult-media-message-video"
                :src="src"
                controls
                preload="metadata"
            ></video>
            <audio
                v-else-if="kind === 'audio' && src"
                class="tumult-media-message-audio"
                :src="src"
                controls
                preload="metadata"
            ></audio>
            <p class="tumult-media-message-body">{{ body }}</p>
            <div class="tumult-media-message-actions">
                <a v-if="src" class="tumult-media-message-link" :href="src" :download="body"
                    >Download</a
                >
                <template v-else-if="status === 'failed'">
                    <span class="tumult-media-message-note">{{ label }} unavailable</span>
                    <button
                        v-if="canRetry"
                        class="tumult-media-message-retry"
                        type="button"
                        @click="load"
                    >
                        Retry
                    </button>
                </template>
            </div>
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
    border-radius: var(--radius-md);
    object-fit: contain;
}
.tumult-media-message-video {
    max-width: 360px;
    max-height: 280px;
    border-radius: var(--radius-md);
}
.tumult-media-message-audio {
    max-width: 320px;
}
.tumult-media-message-pending,
.tumult-media-message-body {
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
.tumult-media-message-actions,
.tumult-media-message-failed {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.tumult-media-message-link {
    color: var(--accent);
    font-size: var(--text-sm);
}
.tumult-media-message-note {
    color: var(--text-muted);
    font-size: var(--text-sm);
}
.tumult-media-message-retry {
    padding: 0 var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-hover);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
}
</style>
