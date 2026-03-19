<template>
  <UiDialog :open="store.verificationModalOpen || !!store.secretStoragePrompt" @update:open="handleClose">
    <UiDialogContent class="sm:max-w-md">
      <UiDialogHeader>
        <UiDialogTitle>
          <template v-if="store.isVerificationCompleted">Verification Complete</template>
          <template v-else-if="store.secretStoragePrompt && store.isCrossSigningReady">Restore Encrypted History</template>
          <template v-else-if="store.secretStoragePrompt">Security Key Required</template>
          <template v-else>Device Verification</template>
        </UiDialogTitle>
        <UiDialogDescription v-if="store.secretStoragePrompt">
          <template v-if="store.isCrossSigningReady">
            Your device is now verified! To access your previous message history, please enter your security key or passphrase.
          </template>
          <template v-else>
            Enter your security key or passphrase to verify this session and access encrypted messages.
          </template>
        </UiDialogDescription>
        <UiDialogDescription v-else-if="store.activeVerificationRequest">
          {{ store.isVerificationInitiatedByMe ? 'Verify this device with another session.' : 'Someone is trying to verify this device.' }}
        </UiDialogDescription>
        <UiDialogDescription v-else-if="store.isRequestingVerification">
          Sending verification request...
        </UiDialogDescription>
        <UiDialogDescription v-else-if="store.isCryptoDegraded">
          {{ store.cryptoStatusMessage || 'Your encryption state is out of sync.' }}
        </UiDialogDescription>
        <UiDialogDescription v-else>
          Choose how you would like to secure your messages.
        </UiDialogDescription>
      </UiDialogHeader>

      <!-- Degraded State / Repair UI -->
      <div v-if="store.isCryptoDegraded && !store.isRestoringHistory" class="flex flex-col gap-4 py-6 text-center">
        <div class="bg-destructive/10 p-6 rounded-xl border border-destructive/20 mb-2">
           <div class="bg-destructive/20 size-12 rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="solar:shield-warning-bold" class="size-6 text-destructive" />
           </div>
           <h4 class="text-base font-bold text-destructive">Encryption Desync Detected</h4>
           <p class="text-sm text-muted-foreground mt-2 leading-relaxed">
              We've detected a problem with your device's security keys. This often happens when multiple sessions conflict.
           </p>
        </div>

        <div class="flex flex-col gap-3">
          <UiButton class="w-full" @click="store.repairCrypto()">
            <Icon name="solar:restart-bold" class="mr-2 size-4" />
            Repair Encryption (Reloads App)
          </UiButton>
          <UiButton variant="outline" class="w-full" @click="store.resetSecurity()">
            <Icon name="solar:trash-bin-trash-bold" class="mr-2 size-4" />
            Reset & Logout
          </UiButton>
        </div>
      </div>

      <!-- Choice / Initial State -->
      <div v-if="!store.isCryptoDegraded && !store.secretStoragePrompt && !store.activeVerificationRequest && !store.isVerificationCompleted" class="flex flex-col gap-4 py-4">
        <template v-if="store.isRequestingVerification">
           <div class="flex flex-col items-center gap-4 py-8">
              <UiSpinner class="h-8 w-8 text-primary" />
              <p class="text-sm font-medium animate-pulse">Contacting your other devices...</p>
           </div>
        </template>
        <template v-else>
          <p class="text-sm text-center text-muted-foreground pb-2">
            Verification ensures that only you can read your messages.
          </p>
          <UiCard class="p-4 cursor-pointer hover:bg-accent/50 transition-colors" @click="handleDeviceVerification">
            <div class="flex items-center gap-4">
              <div class="bg-primary/10 p-2 rounded-full">
                <Icon name="solar:devices-bold" class="size-6 text-primary" />
              </div>
              <div class="flex-1">
                <h4 class="text-sm font-bold">Verify with another device</h4>
                <p class="text-xs text-muted-foreground">Approve a request on your phone or computer.</p>
              </div>
              <Icon name="lucide:chevron-right" class="size-4 text-muted-foreground" />
            </div>
          </UiCard>

          <UiCard class="p-4 cursor-pointer hover:bg-accent/50 transition-colors" @click="store.bootstrapVerification()">
            <div class="flex items-center gap-4">
              <div class="bg-muted p-2 rounded-full">
                <Icon name="solar:key-bold" class="size-6 text-muted-foreground" />
              </div>
              <div class="flex-1">
                <h4 class="text-sm font-bold">Use Security Key</h4>
                <p class="text-xs text-muted-foreground">Enter your recovery passphrase instead.</p>
              </div>
              <Icon name="lucide:chevron-right" class="size-4 text-muted-foreground" />
            </div>
          </UiCard>
        </template>
      </div>

      <!-- Verification Success / Zero-Click Restoration -->
      <div v-if="store.isRestoringHistory || store.isVerificationCompleted" class="flex flex-col items-center gap-6 py-8">
        <div v-if="store.isRestoringHistory" class="flex flex-col items-center gap-6 w-full">
           <div class="relative">
              <UiSpinner class="h-16 w-16 text-primary" />
              <div class="absolute inset-0 flex items-center justify-center">
                 <Icon name="solar:key-bold" class="size-6 text-primary animate-pulse" />
              </div>
           </div>
           <div class="text-center space-y-2">
              <p class="font-bold text-lg">Verified!</p>
              <p class="text-sm text-muted-foreground animate-pulse">Syncing encrypted history from your other devices...</p>
           </div>
        </div>
        <div v-else class="flex flex-col items-center gap-4 text-green-600 w-full">
          <div class="text-5xl">✅</div>
          <p class="font-bold text-lg">Verified!</p>
          <p class="text-sm text-muted-foreground text-center">Your session is now secure.</p>
          <UiButton class="mt-2" variant="outline" size="sm" @click="store.closeVerificationModal()">
            Close
          </UiButton>
        </div>
      </div>

      <!-- Secret Storage / Backup Key Input (Manual Fallback) -->
      <div v-else-if="store.secretStoragePrompt" class="flex flex-col gap-4 py-1">
        <template v-if="store.isCrossSigningReady">
          <div class="text-green-600 flex flex-col items-center mb-2">
            <div class="text-4xl mb-1">✅</div>
            <p class="font-bold">Verified!</p>
          </div>
        </template>
        
        <UiInput 
          v-model="backupKeyInput" 
          type="hidden"
          placeholder="Security Key or Passphrase" 
          class="my-2"
          @keyup.enter="submitKey"
        />
        <div class="flex gap-3 justify-end items-center">
          <UiButton variant="ghost" size="sm" class="text-xs" @click="store.cancelSecretStorageKey()">
            {{ store.isCrossSigningReady ? 'Skip History' : 'Cancel' }}
          </UiButton>
          <UiButton size="sm" @click="submitKey">
            {{ store.isCrossSigningReady ? 'Restore History' : 'Verify With Key' }}
          </UiButton>
        </div>

        <div v-if="!store.isCrossSigningReady" class="pt-4 border-t mt-2">
          <p class="text-[10px] text-muted-foreground text-center mb-2 uppercase tracking-tight">Alternatively</p>
          <UiButton variant="outline" size="sm" class="w-full text-xs" @click="switchToDeviceVerification">
            <Icon name="solar:devices-bold" class="mr-2 size-3" />
            Verify with another device
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
      <div v-else-if="store.isVerificationReady && !store.activeSas" class="flex flex-col gap-4 py-4 text-center">
        <div v-if="store.isSasTimeout" class="bg-destructive/10 p-4 rounded-lg border border-destructive/20 mb-2">
           <h4 class="text-sm font-bold text-destructive flex items-center justify-center gap-2">
              <Icon name="solar:danger-bold" class="size-4" />
              Connection Unstable
           </h4>
           <p class="text-xs text-muted-foreground mt-1">
              The security exchange is taking longer than expected. Please ensure both devices are online.
           </p>
        </div>

        <p class="text-sm font-semibold text-green-600" v-else>
          Verification request has been accepted.
        </p>
        
        <!-- QR Code Display / Scanner -->
        <div class="flex flex-col items-center gap-4 py-4">
          <template v-if="!isScanning">
            <div v-if="qrCodeUrl" class="bg-white p-4 rounded-xl shadow-inner mb-2">
              <img :src="qrCodeUrl" class="w-48 h-48" alt="Verification QR Code" />
            </div>
            
            <UiButton 
              v-if="isCameraSupported && store.qrCodeData" 
              variant="outline" 
              size="sm" 
              class="w-full" 
              @click="startScanning"
            >
              <Icon name="solar:camera-bold" class="mr-2 size-4" />
              Scan their QR code
            </UiButton>
          </template>

          <template v-else>
            <div class="relative w-full aspect-square max-w-[280px] bg-black rounded-xl overflow-hidden shadow-2xl border-2 border-primary/50">
               <video ref="video" class="absolute inset-0 w-full h-full object-cover" autoplay playsinline muted></video>
               <canvas ref="canvas" class="hidden"></canvas>
               
               <!-- Scanner Overlay -->
               <div class="absolute inset-0 border-[40px] border-black/40">
                  <div class="w-full h-full border-2 border-primary/50 relative">
                     <div class="absolute inset-0 animate-pulse bg-primary/5"></div>
                     <!-- Corner Accents -->
                     <div class="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-primary"></div>
                     <div class="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-primary"></div>
                     <div class="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-primary"></div>
                     <div class="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-primary"></div>
                  </div>
               </div>
            </div>
            <UiButton variant="ghost" size="sm" @click="stopScanning">
              Cancel Scanning
            </UiButton>
          </template>
        </div>

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
             Use Emoji Verification
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
        <template v-if="store.isSasConfirming">
          <div class="flex flex-col items-center gap-4 py-12">
            <UiSpinner class="h-8 w-8 text-primary" />
            <p class="text-sm font-medium animate-pulse">Confirming match...</p>
            <p class="text-xs text-muted-foreground">Waiting for the other device to acknowledge.</p>
          </div>
        </template>
        <template v-else>
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
        </template>
      </div>
      
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import { useMatrixStore } from '~/stores/matrix';
import { useMediaQuery } from '@vueuse/core';
import { toast } from 'vue-sonner';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { VerificationPhase } from 'matrix-js-sdk/lib/crypto-api/verification';

const store = useMatrixStore();
const backupKeyInput = ref('');
const qrCodeUrl = ref<string | null>(null);

// Scanner State
const isScanning = ref(false);
const isCameraSupported = ref(false);
const video = ref<HTMLVideoElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
let stream: MediaStream | null = null;
let animationFrameId: number | null = null;

const isMobile = useMediaQuery('(max-width: 768px)');

onMounted(async () => {
  isCameraSupported.value = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
});

// Auto-stop scanner on mobile if we are in the ready phase
watch([() => store.isVerificationReady, isMobile], ([ready, mobile]) => {
  if (ready && mobile && isCameraSupported.value && !isScanning.value && !store.activeSas && store.qrCodeData) {
    startScanning();
  }
}, { immediate: true });

// Stop scanning if SAS starts or verification ends
watch(() => store.activeSas, (sas) => {
  if (sas && isScanning.value) {
    console.log('[VerificationModal] SAS started, stopping camera.');
    stopScanning();
  }
});

watch(() => store.verificationPhase, (phase) => {
  if (phase === VerificationPhase.Cancelled || phase === VerificationPhase.Done) {
    if (isScanning.value) {
      console.log('[VerificationModal] Verification ended, stopping camera.');
      stopScanning();
    }
  }
});

watch(() => store.qrCodeData, async (data) => {
  if (data) {
    try {
      qrCodeUrl.value = await QRCode.toDataURL(data, {
        margin: 0,
        scale: 10,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });
    } catch (err) {
      console.error('Failed to generate QR code:', err);
      qrCodeUrl.value = null;
    }
  } else {
    qrCodeUrl.value = null;
  }
}, { immediate: true });

async function startScanning() {
  if (!isCameraSupported.value) return;

  if (store.activeSas) {
    console.log('[VerificationModal] SAS already active, skipping camera.');
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'environment' } 
    });
    isScanning.value = true;
    
    await nextTick();
    if (video.value) {
      video.value.srcObject = stream;
      video.value.play();
      animationFrameId = requestAnimationFrame(tick);
    }
  } catch (err) {
    console.error('Failed to access camera:', err);
    isScanning.value = false;
    toast.error('Camera Access Failed', {
      description: 'Please ensure you have granted camera permissions to use QR verification.'
    });
  }
}

function stopScanning() {
  isScanning.value = false;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

async function tick() {
  if (!isScanning.value || !video.value || !canvas.value) return;

  if (video.value.readyState === video.value.HAVE_ENOUGH_DATA) {
    const ctx = canvas.value.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      canvas.value.height = video.value.videoHeight;
      canvas.value.width = video.value.videoWidth;
      ctx.drawImage(video.value, 0, 0, canvas.value.width, canvas.value.height);
      const imageData = ctx.getImageData(0, 0, canvas.value.width, canvas.value.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data.startsWith('matrix-qrcode/')) {
        console.log('[QRScanner] Found QR code:', code.data);
        stopScanning();
        await store.reciprocateQrCode(code.data);
        return;
      }
    }
  }
  animationFrameId = requestAnimationFrame(tick);
}

onUnmounted(() => {
  stopScanning();
});

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
    if (store.activeVerificationRequest && !store.isVerificationCompleted && !store.isSasConfirming) {
      store.cancelVerification();
    }
    stopScanning();
    store.closeVerificationModal();
  }
}
</script>
