<script setup lang="ts">
import { computed, ref, watch, type CSSProperties } from "vue";
import type { EncryptedAttachment, MessageView } from "@tumult/core";
import { isTerminalMediaError } from "@tumult/core/media";

import {
    useEncryptedMediaResolver,
    useMediaDownloadResolver,
    useMediaResolver,
} from "../../media.ts";
import { mediaText } from "./mediaText.ts";

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
const text = computed(() => mediaText(props.message.content, props.message.body));

/**
 * Intrinsic pixel size from the event's `info` block. Matrix media events
 * carry `info.w`/`info.h` in cleartext (and inside decrypted content for
 * E2EE), so the row can reserve its final box BEFORE the bytes arrive —
 * without it, every decode re-measures the row and shifts the timeline
 * under the reader.
 */
const dims = computed(() => {
    const info = props.message.content["info"];
    if (!info || typeof info !== "object") return null;
    const { w, h } = info as { w?: unknown; h?: unknown };
    if (typeof w !== "number" || typeof h !== "number" || !(w > 0) || !(h > 0)) return null;
    return { w, h };
});
/**
 * The reservation inputs as inline custom props: the intrinsic width as a
 * LENGTH (the no-upscale term of the `min()`) and w/h as a bare ratio (the
 * height-clamp term and `aspect-ratio`). The unit travels in the value on
 * purpose — the token-completeness gate (`packages/theme`) rejects a literal
 * pixel length in a component stylesheet, so multiplying a bare number by a
 * pixel unit inside `calc()` is not an option.
 */
const reservation = computed<CSSProperties | undefined>(() => {
    const size = dims.value;
    if (!size) return undefined;
    return {
        "--media-intrinsic-w": `${size.w}px`,
        "--media-intrinsic-ratio": String(size.w / size.h),
    } as CSSProperties;
});
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
            <!--
                With `info` dims the box is reserved from the FIRST render:
                `[data-dims]` pins the exact max-clamp fit box (width + ratio
                derived from the event's own dimensions and the token maxes),
                so the pre-load reservation equals the post-load replaced-
                element clamp and the decode never re-measures the row under
                the reader. Dims-less events keep text-until-decoded.
            -->
            <img
                v-if="(src || dims) && status !== 'failed'"
                class="tumult-media-message-image"
                :src="src ?? undefined"
                :alt="text.alt"
                :data-dims="dims ? 'true' : undefined"
                :style="reservation"
                loading="lazy"
            />
            <div v-else-if="status === 'failed'" class="tumult-media-message-failed">
                <span class="tumult-media-message-note">{{ label }} unavailable</span>
                <button v-if="canRetry" class="tumult-media-message-retry" type="button" @click="load">
                    Retry
                </button>
            </div>
            <p v-else class="tumult-media-message-pending">{{ text.name }}</p>
        </template>

        <template v-else>
            <video
                v-if="kind === 'video' && (src || dims) && status !== 'failed'"
                class="tumult-media-message-video"
                :src="src ?? undefined"
                :data-dims="dims ? 'true' : undefined"
                :style="reservation"
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
            <p class="tumult-media-message-body">{{ text.name }}</p>
            <div class="tumult-media-message-actions">
                <a v-if="src" class="tumult-media-message-link" :href="src" :download="text.name"
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
        <!-- MSC2530 caption: the message text sent with the file. -->
        <p v-if="text.caption" class="tumult-media-message-caption">{{ text.caption }}</p>
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
    max-width: var(--media-image-max-width);
    max-height: var(--media-image-max-height);
    /* Reservation inputs from the event's `info` block; the inline style sets
       them per message. Declared here (with a harmless fallback) so the token
       gate can see the names. */
    --media-intrinsic-w: var(--media-image-max-width);
    --media-intrinsic-ratio: 1;
    border-radius: var(--radius-md);
    object-fit: contain;
}
/*
 * Reserved pre-load box from the event's `info` dims: width is the exact fit
 * the replaced-element max-clamp produces after decode (never upscaling, per
 * max-* semantics), with the ratio pinned via aspect-ratio. Pre-load and
 * post-load boxes are identical, so a late decode never re-measures the row
 * and shifts the timeline under the reader. The length and the ratio arrive as
 * inline custom props — the unit rides in the value, because this stylesheet
 * may not name a literal pixel length (the theme's token-completeness gate
 * scans these blocks, comments included).
 */
.tumult-media-message-image[data-dims] {
    width: min(
        var(--media-intrinsic-w),
        var(--media-image-max-width),
        calc(var(--media-image-max-height) * var(--media-intrinsic-ratio))
    );
    aspect-ratio: var(--media-intrinsic-ratio);
    height: auto;
}
.tumult-media-message-video {
    max-width: var(--media-video-max-width);
    max-height: var(--media-video-max-height);
    /* Same reservation inputs as the image (see above). */
    --media-intrinsic-w: var(--media-video-max-width);
    --media-intrinsic-ratio: 1;
    border-radius: var(--radius-md);
}
/* Same reservation as the image, against the video maxes. */
.tumult-media-message-video[data-dims] {
    width: min(
        var(--media-intrinsic-w),
        var(--media-video-max-width),
        calc(var(--media-video-max-height) * var(--media-intrinsic-ratio))
    );
    aspect-ratio: var(--media-intrinsic-ratio);
    height: auto;
}
.tumult-media-message-audio {
    max-width: var(--media-audio-max-width);
}
.tumult-media-message-pending,
.tumult-media-message-body,
.tumult-media-message-caption {
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
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-hover);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
}
</style>
