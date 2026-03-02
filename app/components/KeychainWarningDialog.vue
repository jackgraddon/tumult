<template>
  <Teleport to="body">
    <Transition name="backdrop">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-[200] flex items-center justify-center"
        @click.self="$emit('cancel')"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" />

        <!-- Dialog -->
        <Transition name="dialog">
          <div
            v-if="modelValue"
            class="relative z-10 w-full max-w-md mx-4 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
          >
            <!-- Header stripe -->
            <div class="h-1 w-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-400" />

            <div class="p-6">
              <!-- Icon + title -->
              <div class="flex items-start gap-4 mb-5">
                <div class="shrink-0 h-11 w-11 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <Icon name="solar:lock-keyhole-bold-duotone" class="h-6 w-6 text-amber-400" />
                </div>
                <div>
                  <h2 class="text-base font-semibold text-foreground leading-snug">
                    macOS will ask for your Keychain password
                  </h2>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    This happens on first use — it won't appear again if you click Always Allow
                  </p>
                </div>
              </div>

              <!-- Explanation -->
              <div class="text-sm text-muted-foreground space-y-3 mb-5">
                <p>
                  When this app sets up end-to-end encryption for your voice call, macOS
                  tries to store a cryptographic key in your system Keychain. You'll see
                  a dialog titled <span class="font-medium text-foreground">"WebCrypto Master Key"</span>.
                </p>
                <p>
                  This key is used to protect your call in memory — it is not sent anywhere
                  and does not give the app access to your other Keychain items.
                </p>
              </div>

              <!-- Mock dialog preview -->
              <div class="rounded-xl border border-border/60 bg-muted/30 p-4 mb-5">
                <p class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  What you'll see from macOS
                </p>
                <div class="flex items-start gap-3">
                  <!-- Padlock icon mockup -->
                  <div class="shrink-0 mt-0.5 h-9 w-9 rounded bg-amber-400/20 border border-amber-400/30 flex items-center justify-center">
                    <Icon name="solar:lock-keyhole-bold" class="h-5 w-5 text-amber-400" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-xs font-medium text-foreground leading-snug">
                      <span class="font-bold">Ruby Chat</span> wants to use your confidential
                      information stored in <span class="font-bold">"Ruby Chat WebCrypto Master Key"</span> in your keychain.
                    </p>
                    <p class="text-[11px] text-muted-foreground mt-1.5">
                      To allow this, enter the "login" keychain password.
                    </p>
                    <!-- Mock buttons -->
                    <div class="flex items-center gap-1.5 mt-2.5">
                      <div class="px-2.5 py-1 rounded bg-green-500/10 border border-green-500/30 text-[10px] font-semibold text-green-400 flex items-center gap-1">
                        <Icon name="solar:star-bold" class="h-2.5 w-2.5" />
                        Always Allow
                      </div>
                      <div class="px-2.5 py-1 rounded bg-muted border border-border text-[10px] text-muted-foreground">Deny</div>
                      <div class="px-2.5 py-1 rounded bg-muted border border-border text-[10px] text-muted-foreground">Allow</div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Recommendation callout -->
              <div class="flex items-center gap-2.5 rounded-lg bg-green-500/8 border border-green-500/20 px-3.5 py-2.5 mb-6">
                <Icon name="solar:verified-check-bold" class="h-4 w-4 text-green-400 shrink-0" />
                <p class="text-xs text-green-300">
                  Click <span class="font-semibold">"Always Allow"</span> to prevent this prompt from appearing on every call.
                </p>
              </div>

              <!-- Remember checkbox -->
              <label class="flex items-center gap-2.5 cursor-pointer mb-5 group">
                <div
                  class="h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors"
                  :class="rememberChoice
                    ? 'bg-primary border-primary'
                    : 'border-border bg-transparent group-hover:border-primary/50'"
                  @click="rememberChoice = !rememberChoice"
                >
                  <Icon v-if="rememberChoice" name="solar:check-read-bold" class="h-2.5 w-2.5 text-primary-foreground" />
                </div>
                <span class="text-xs text-muted-foreground group-hover:text-foreground transition-colors select-none">
                  Don't show this again
                </span>
              </label>

              <!-- Actions -->
              <div class="flex items-center justify-end gap-2.5">
                <UiButton
                  variant="ghost"
                  size="sm"
                  class="text-muted-foreground"
                  @click="$emit('cancel')"
                >
                  Cancel
                </UiButton>
                <UiButton
                  size="sm"
                  class="gap-1.5"
                  @click="handleProceed"
                >
                  <Icon name="solar:phone-calling-bold" class="h-3.5 w-3.5" />
                  Join Call
                </UiButton>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'proceed', rememberChoice: boolean): void;
  (e: 'cancel'): void;
}>();

const rememberChoice = ref(false);

function handleProceed() {
  emit('proceed', rememberChoice.value);
  emit('update:modelValue', false);
}
</script>

<style scoped>
.backdrop-enter-active,
.backdrop-leave-active {
  transition: opacity 0.2s ease;
}
.backdrop-enter-from,
.backdrop-leave-to {
  opacity: 0;
}

.dialog-enter-active {
  transition: opacity 0.2s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.dialog-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.dialog-enter-from {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
.dialog-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(4px);
}
</style>