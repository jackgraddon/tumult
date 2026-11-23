<script setup lang="ts">
/**
 * Loading shape for a room whose timeline snapshot has not arrived yet — e.g.
 * the SDK has not synced it into its store. It holds the same vertical space as
 * a few message rows so opening a room never collapses the pane, and every
 * colour, size and motion value comes from a theme token.
 */
</script>

<template>
    <div class="tumult-timeline-skeleton" role="status" aria-label="Loading messages">
        <div v-for="row in 4" :key="row" class="tumult-skeleton-row" aria-hidden="true">
            <div class="tumult-skeleton-avatar"></div>
            <div class="tumult-skeleton-lines">
                <div class="tumult-skeleton-line tumult-skeleton-line-name"></div>
                <div class="tumult-skeleton-line tumult-skeleton-line-body"></div>
                <div v-if="row % 2 === 0" class="tumult-skeleton-line tumult-skeleton-line-short"></div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.tumult-timeline-skeleton {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-4);
    min-height: 0;
    overflow: hidden;
    padding: var(--space-3);
}
.tumult-skeleton-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
}
.tumult-skeleton-avatar {
    flex-shrink: 0;
    width: var(--avatar-md);
    height: var(--avatar-md);
    border-radius: var(--radius-full);
}
.tumult-skeleton-lines {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    padding-top: var(--space-0-5);
}
.tumult-skeleton-line {
    height: var(--space-2);
    border-radius: var(--control-radius);
}
.tumult-skeleton-line-name {
    width: 22%;
}
.tumult-skeleton-line-body {
    width: 68%;
}
.tumult-skeleton-line-short {
    width: 40%;
}
.tumult-skeleton-avatar,
.tumult-skeleton-line {
    background: linear-gradient(
        100deg,
        var(--skeleton-surface) 20%,
        var(--skeleton-shimmer-surface) 50%,
        var(--skeleton-surface) 80%
    );
    background-size: 200% 100%;
    animation: tumult-skeleton-shimmer var(--skeleton-shimmer-duration) var(--skeleton-shimmer-ease) infinite;
}
@keyframes tumult-skeleton-shimmer {
    to {
        background-position: -200% 0;
    }
}
@media (prefers-reduced-motion: reduce) {
    .tumult-skeleton-avatar,
    .tumult-skeleton-line {
        animation: none;
    }
}
</style>
