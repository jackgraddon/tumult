<template>
  <UiDialog :open="store.verificationModalOpen || !!store.secretStoragePrompt" @update:open="handleClose">
    <UiDialogContent class="sm:max-w-md">
      <UiDialogHeader>
        <UiDialogTitle>{{ store.secretStoragePrompt ? 'Security Key Required' : 'Device Verification' }}</UiDialogTitle>
        <UiDialogDescription v-if="store.secretStoragePrompt">
          Enter your security key or passphrase to access encrypted messages.
        </UiDialogDescription>
        <UiDialogDescription v-else-if="store.activeVerificationRequest">
          {{ store.isVerificationInitiatedByMe ? 'Verify this device with another session.' : 'Someone is trying to verify this device.' }}
        </UiDialogDescription>
        <UiDialogDescription v-else-if="store.isRequestingVerification">
          Sending verification request...
        </UiDialogDescription>
        <UiDialogDescription v-else>
          Keep your messages secure by verifying this session.
        </UiDialogDescription>
      </UiDialogHeader>

      <!-- Choice / Initial State -->
      <div v-if="!store.secretStoragePrompt && !store.activeVerificationRequest && !store.isVerificationCompleted" class="flex flex-col gap-4 py-4">
        <template v-if="store.isRequestingVerification">
           <div class="flex flex-col items-center gap-4 py-8">
              <UiSpinner class="h-8 w-8 text-primary" />
              <p class="text-sm font-medium animate-pulse">Contacting your other devices...</p>
           </div>
        </template>
        <template v-else>
          <p class="text-sm text-center text-muted-foreground">
            How would you like to verify this session?
          </p>
          <div class="flex flex-col gap-2">
            <UiButton @click="handleDeviceVerification">
              <Icon name="solar:devices-bold" class="mr-2 size-4" />
              Verify with another device
            </UiButton>
            <UiButton variant="outline" @click="store.bootstrapVerification()">
              <Icon name="solar:key-bold" class="mr-2 size-4" />
              Use Security Key / Passphrase
            </UiButton>
          </div>
        </template>
      </div>

      <!-- Secret Storage / Backup Key Input -->
      <div v-if="store.secretStoragePrompt" class="flex flex-col gap-4 py-1">
        <template v-if="store.isCrossSigningReady">
          <div class="text-green-600 flex flex-col items-center">
            <div class="text-3xl mb-1">✅</div>
            <p class="font-bold text-sm">Verified!</p>
          </div>
          <p class="text-xs text-muted-foreground text-center">
            To restore your secure message history, please enter your Security Key or Passphrase.
          </p>
        </template>
        
        <UiInput 
          v-model="backupKeyInput" 
          type="password" 
          placeholder="Security Key or Passphrase" 
          class="my-2"
          @keyup.enter="submitKey"
        />
        <div class="flex gap-3 justify-end">
          <UiButton variant="secondary" size="sm" @click="store.cancelSecretStorageKey()">
            {{ store.isCrossSigningReady ? 'Skip History' : 'Cancel' }}
          </UiButton>
          <UiButton size="sm" @click="submitKey">
            {{ store.isCrossSigningReady ? 'Restore' : 'Verify' }}
          </UiButton>
        </div>

        <div v-if="!store.isCrossSigningReady" class="pt-4 border-t mt-2">
          <p class="text-[10px] text-muted-foreground text-center mb-2">Alternatively</p>
          <UiButton variant="ghost" size="sm" class="w-full text-xs" @click="switchToDeviceVerification">
            Verify with another device instead
          </UiButton>
        </div>
      </div>

      <!-- Outgoing Verification (Waiting for acceptance) -->
      <div v-else-if="store.isVerificationInitiatedByMe && store.isVerificationRequested" class="flex flex-col gap-4 py-4 text-center">
        <p class="text-sm">
          Open Element (or your other client) and accept the verification request.
        </p>
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span class="animate-pulse">Waiting for other device to accept...</span>
          </div>
          <UiButton variant="destructive" size="sm" @click="store.cancelVerification()">
            Cancel Request
          </UiButton>
          <div class="text-xs text-muted-foreground italic">or</div>
          <UiButton variant="outline" size="sm" @click="store.bootstrapVerification()">
            Use Recovery Key / Passphrase
          </UiButton>
        </div>
      </div>

      <!-- Outgoing/Incoming Verification (Ready to start) -->
      <!-- Outgoing/Incoming Verification (Ready to start) -->
      <div v-else-if="store.isVerificationReady && !store.activeSas" class="flex flex-col gap-4 py-4 text-center">
        <p class="text-sm font-semibold text-green-600">
          Verification request has been accepted.
        </p>
        <p class="text-xs text-muted-foreground">
          Waiting for the SAS (emoji) exchange to begin...
        </p>
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <UiSpinner v-if="!store.activeSas" class="h-4 w-4" />
            <span>{{ store.isVerificationInitiatedByMe ? 'Negotiating...' : 'Waiting for initiator...' }}</span>
          </div>
          <!-- Fallback button if auto-negotiation fails -->
          <UiButton variant="secondary" size="sm" @click="store.acceptVerification()">
             Try Starting Manually
          </UiButton>
          <UiButton variant="destructive" size="sm" @click="store.cancelVerification()">
            Cancel
          </UiButton>
        </div>
      </div>

      <!-- Incoming Verification Request (Initial) -->
      <div v-else-if="!store.isVerificationInitiatedByMe && store.isVerificationRequested" class="flex flex-col gap-4 py-4">
        <p class="text-sm">
          A device for <strong>{{ store.activeVerificationRequest?.otherUserId }}</strong> 
          wants to verify with you.
        </p>
        <div class="flex gap-3 justify-end">
          <UiButton variant="destructive" size="sm" @click="store.cancelVerification()">
            Decline
          </UiButton>
          <UiButton size="sm" @click="store.acceptVerification()">
            Accept Verification
          </UiButton>
        </div>
      </div>

      <!-- SAS (Emoji) Verification -->
      <div v-else-if="store.activeSas" class="flex flex-col gap-6 py-4">
        <p class="text-sm text-center">
          Compare these emojis with the other device. Do they match perfectly?
        </p>
        
        <div class="grid grid-cols-4 gap-4 justify-items-center">
          <div 
            v-for="(emojiObj, index) in store.activeSas.sas.emoji" 
            :key="index"
            class="flex flex-col items-center gap-1"
          >
            <span class="text-4xl">{{ emojiObj[0] }}</span>
            <span class="text-[10px] text-muted-foreground font-bold uppercase">{{ emojiObj[1] }}</span>
          </div>
        </div>

        <div class="flex gap-3 justify-end mt-4">
          <UiButton variant="destructive" size="sm" @click="store.confirmSasMatch(false)">
            They Don't Match
          </UiButton>
          <UiButton size="sm" @click="store.confirmSasMatch(true)">
            They Match
          </UiButton>
        </div>
      </div>

      <!-- Verification Success -->
      <div v-else-if="store.isVerificationCompleted" class="flex flex-col items-center gap-4 py-8 text-green-600">
        <div class="text-5xl">✅</div>
        <p class="font-bold text-lg">Verified!</p>
        <p class="text-sm text-muted-foreground text-center">Your session is now secure.</p>
        <UiButton class="mt-2" variant="outline" size="sm" @click="store.closeVerificationModal()">
          Close
        </UiButton>
      </div>
      
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import { useMatrixStore } from '~/stores/matrix';

const store = useMatrixStore();
const backupKeyInput = ref('');

async function submitKey() {
  if (!backupKeyInput.value) return;
  await store.submitSecretStorageKey(backupKeyInput.value);
  backupKeyInput.value = ''; 
}

async function handleDeviceVerification() {
  await store.requestVerification();
}

function switchToDeviceVerification() {
  store.cancelSecretStorageKey();
  handleDeviceVerification();
}

function handleClose(open: boolean) {
  if (!open) {
    if (store.activeVerificationRequest && !store.isVerificationCompleted) {
      store.cancelVerification();
    }
    store.closeVerificationModal();
  }
}
</script>
