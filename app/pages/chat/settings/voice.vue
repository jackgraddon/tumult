<template>
  <div class="p-6 space-y-6 max-w-2xl">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">Voice Diagnostics</h3>
        <p class="text-sm text-muted-foreground mt-0.5">Check your voice call setup and connectivity</p>
      </div>
      <UiButton @click="runDiagnostics" :disabled="isRunning" class="gap-2">
        <Icon
          :name="isRunning ? 'solar:refresh-bold' : 'solar:stethoscope-bold'"
          class="h-4 w-4"
          :class="{ 'animate-spin': isRunning }"
        />
        {{ isRunning ? 'Running...' : 'Run Diagnostics' }}
      </UiButton>
    </div>

    <!-- Check Groups -->
    <div class="space-y-3">

      <!-- Browser Capabilities -->
      <UiCard>
        <UiCardHeader class="pb-2 pt-4 px-4">
          <UiCardTitle class="text-sm font-medium flex items-center gap-2">
            <Icon name="solar:monitor-bold-duotone" class="h-4 w-4 text-muted-foreground" />
            Browser Capabilities
          </UiCardTitle>
        </UiCardHeader>
        <UiCardContent class="px-4 pb-4 space-y-2">
          <DiagRow label="WebRTC Support" :status="getStatus(diagnostics.browser.webrtc)" />
          <DiagRow label="Media Devices API" :status="getStatus(diagnostics.browser.mediaDevices)" />
          <DiagRow label="getUserMedia" :status="getStatus(diagnostics.browser.getUserMedia)" />
          <DiagRow label="Microphone Access" :status="getStatus(diagnostics.browser.micAccess)" />
        </UiCardContent>
      </UiCard>

      <!-- Network -->
      <UiCard>
        <UiCardHeader class="pb-2 pt-4 px-4">
          <UiCardTitle class="text-sm font-medium flex items-center gap-2">
            <Icon name="solar:globus-bold-duotone" class="h-4 w-4 text-muted-foreground" />
            Network Connectivity
          </UiCardTitle>
        </UiCardHeader>
        <UiCardContent class="px-4 pb-4 space-y-2">
          <DiagRow label="Matrix Server" :status="getStatus(diagnostics.network.matrix)" />
          <DiagRow label="LiveKit Service" :status="getStatus(diagnostics.network.livekit)" />
        </UiCardContent>
      </UiCard>

      <!-- MatrixRTC -->
      <UiCard>
        <UiCardHeader class="pb-2 pt-4 px-4">
          <UiCardTitle class="text-sm font-medium flex items-center gap-2">
            <Icon name="solar:transmission-bold-duotone" class="h-4 w-4 text-muted-foreground" />
            MatrixRTC
          </UiCardTitle>
        </UiCardHeader>
        <UiCardContent class="px-4 pb-4 space-y-2">
          <DiagRow label="MatrixRTC Available" :status="getStatus(diagnostics.matrixRTC.available)" />
          <DiagRow label="Focus Discovery (.well-known)" :status="getStatus(diagnostics.matrixRTC.focus)" />
        </UiCardContent>
      </UiCard>

      <!-- LiveKit -->
      <UiCard>
        <UiCardHeader class="pb-2 pt-4 px-4">
          <UiCardTitle class="text-sm font-medium flex items-center gap-2">
            <Icon name="solar:transmission-square-bold-duotone" class="h-4 w-4 text-muted-foreground" />
            LiveKit
          </UiCardTitle>
        </UiCardHeader>
        <UiCardContent class="px-4 pb-4 space-y-2">
          <DiagRow label="E2EE Worker" :status="getStatus(diagnostics.livekit.worker)" />
          <DiagRow label="WebCrypto (E2EE)" :status="getStatus(diagnostics.livekit.e2ee)" />
          <DiagRow label="WebSocket Support" :status="getStatus(diagnostics.livekit.websocket)" />
        </UiCardContent>
      </UiCard>

    </div>

    <!-- Results Log -->
    <template v-if="hasRun && (diagnostics.errors.length > 0 || diagnostics.successes.length > 0 || diagnostics.recommendations.length > 0)">

      <!-- Errors -->
      <UiCard v-if="diagnostics.errors.length > 0" class="border-destructive/40 bg-destructive/5">
        <UiCardHeader class="pb-2 pt-4 px-4">
          <UiCardTitle class="text-sm font-medium text-destructive flex items-center gap-2">
            <Icon name="solar:danger-triangle-bold" class="h-4 w-4" />
            Issues Found
          </UiCardTitle>
        </UiCardHeader>
        <UiCardContent class="px-4 pb-4">
          <ul class="space-y-1.5">
            <li
              v-for="(error, i) in diagnostics.errors"
              :key="i"
              class="text-sm text-destructive flex items-start gap-2"
            >
              <Icon name="solar:close-circle-bold" class="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {{ error }}
            </li>
          </ul>
        </UiCardContent>
      </UiCard>

      <!-- Recommendations -->
      <UiCard v-if="diagnostics.recommendations.length > 0" class="border-yellow-500/40 bg-yellow-500/5">
        <UiCardHeader class="pb-2 pt-4 px-4">
          <UiCardTitle class="text-sm font-medium text-yellow-600 dark:text-yellow-400 flex items-center gap-2">
            <Icon name="solar:lightbulb-bold" class="h-4 w-4" />
            Recommendations
          </UiCardTitle>
        </UiCardHeader>
        <UiCardContent class="px-4 pb-4">
          <ul class="space-y-1.5">
            <li
              v-for="(rec, i) in diagnostics.recommendations"
              :key="i"
              class="text-sm text-yellow-700 dark:text-yellow-300 flex items-start gap-2"
            >
              <Icon name="solar:arrow-right-bold" class="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {{ rec }}
            </li>
          </ul>
        </UiCardContent>
      </UiCard>

      <!-- All passed -->
      <UiCard v-if="diagnostics.errors.length === 0" class="border-green-500/40 bg-green-500/5">
        <UiCardContent class="px-4 py-4 flex items-center gap-3">
          <Icon name="solar:check-circle-bold" class="h-5 w-5 text-green-500 shrink-0" />
          <div>
            <p class="text-sm font-medium text-green-700 dark:text-green-400">All checks passed</p>
            <p class="text-xs text-green-600/70 dark:text-green-500/70">Voice calls should work correctly</p>
          </div>
        </UiCardContent>
      </UiCard>

    </template>

    <!-- Debug: Room State Dump (dev tool) -->
    <UiCard class="border-dashed">
      <UiCardHeader class="pb-2 pt-4 px-4">
        <UiCardTitle class="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Icon name="solar:bug-bold-duotone" class="h-4 w-4" />
          Room State Debug
        </UiCardTitle>
      </UiCardHeader>
      <UiCardContent class="px-4 pb-4 space-y-3">
        <div class="flex gap-2">
          <UiInput v-model="debugRoomId" placeholder="!roomId:server" class="font-mono text-xs h-8" />
          <UiButton variant="outline" size="sm" @click="dumpRoomState" :disabled="!debugRoomId" class="gap-1.5 shrink-0">
            <Icon name="solar:magnifer-bold" class="h-3.5 w-3.5" />
            Inspect
          </UiButton>
        </div>
        <p class="text-xs text-muted-foreground">Dumps RTC/call/member state events to the console for the given room.</p>
      </UiCardContent>
    </UiCard>

  </div>
</template>

<script lang="ts" setup>
import { ref, reactive } from 'vue';
import { useMatrixStore } from '~/stores/matrix';

const matrixStore = useMatrixStore();
const isRunning = ref(false);
const hasRun = ref(false);
const debugRoomId = ref('');

// Tri-state: null = not yet checked, true = pass, false = fail
const diagnostics = reactive({
  browser: {
    webrtc: null as boolean | null,
    mediaDevices: null as boolean | null,
    getUserMedia: null as boolean | null,
    micAccess: null as boolean | null,
  },
  network: {
    livekit: null as boolean | null,
    matrix: null as boolean | null,
  },
  matrixRTC: {
    available: null as boolean | null,
    focus: null as boolean | null,
  },
  livekit: {
    worker: null as boolean | null,
    e2ee: null as boolean | null,
    websocket: null as boolean | null,
  },
  errors: [] as string[],
  successes: [] as string[],
  recommendations: [] as string[],
});

// Maps boolean | null to a display status
function getStatus(val: boolean | null): 'pending' | 'pass' | 'fail' {
  if (val === null) return 'pending';
  return val ? 'pass' : 'fail';
}

async function runDiagnostics() {
  isRunning.value = true;
  hasRun.value = false;
  diagnostics.errors = [];
  diagnostics.successes = [];
  diagnostics.recommendations = [];

  // Reset all checks to null (pending)
  Object.keys(diagnostics.browser).forEach(k => (diagnostics.browser as any)[k] = null);
  Object.keys(diagnostics.network).forEach(k => (diagnostics.network as any)[k] = null);
  Object.keys(diagnostics.matrixRTC).forEach(k => (diagnostics.matrixRTC as any)[k] = null);
  Object.keys(diagnostics.livekit).forEach(k => (diagnostics.livekit as any)[k] = null);

  try {
    await checkBrowserCapabilities();
    await checkNetworkConnectivity();
    await checkMatrixRTC();
    await checkLiveKit();
    generateRecommendations();
    hasRun.value = true;
  } catch (error) {
    diagnostics.errors.push(`Diagnostic failed: ${error instanceof Error ? error.message : String(error)}`);
    hasRun.value = true;
  } finally {
    isRunning.value = false;
  }
}

async function checkBrowserCapabilities() {
  diagnostics.browser.webrtc = !!(window.RTCPeerConnection && window.RTCRtpTransceiver && window.RTCRtpSender);
  if (!diagnostics.browser.webrtc) {
    diagnostics.errors.push('WebRTC is not supported — voice calls will not work');
  }

  diagnostics.browser.mediaDevices = !!(navigator.mediaDevices?.enumerateDevices);
  if (!diagnostics.browser.mediaDevices) {
    diagnostics.errors.push('Media devices API not available');
  }

  diagnostics.browser.getUserMedia = !!(navigator.mediaDevices?.getUserMedia);
  if (!diagnostics.browser.getUserMedia) {
    diagnostics.errors.push('getUserMedia not available — microphone/camera access will fail');
  }

  if (diagnostics.browser.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach(t => t.stop());
      diagnostics.browser.micAccess = true;
    } catch (error) {
      diagnostics.browser.micAccess = false;
      diagnostics.errors.push(`Microphone access failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    diagnostics.browser.micAccess = false;
  }
}

async function checkNetworkConnectivity() {
  if (!matrixStore.client) {
    diagnostics.network.matrix = false;
    diagnostics.errors.push('Matrix client is not initialized');
  } else {
    try {
      await matrixStore.client.whoami();
      diagnostics.network.matrix = true;
    } catch (error) {
      diagnostics.network.matrix = false;
      diagnostics.errors.push(`Matrix server unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const response = await fetch('https://livekit-jwt.call.matrix.org/sfu/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: 'test', device_id: 'test', openid_token: 'test' })
    });
    // A 400 means the service is reachable but rejected the invalid test payload — that's expected
    diagnostics.network.livekit = response.status === 400 || response.ok;
    if (!diagnostics.network.livekit) {
      diagnostics.errors.push(`LiveKit service returned unexpected status: ${response.status}`);
    }
  } catch (error) {
    diagnostics.network.livekit = false;
    diagnostics.errors.push(`LiveKit service unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkMatrixRTC() {
  if (!matrixStore.client) {
    diagnostics.matrixRTC.available = false;
    diagnostics.matrixRTC.focus = false;
    diagnostics.errors.push('Matrix client not available for MatrixRTC check');
    return;
  }

  diagnostics.matrixRTC.available = !!(matrixStore.client.matrixRTC);
  if (!diagnostics.matrixRTC.available) {
    diagnostics.matrixRTC.focus = false;
    diagnostics.errors.push('MatrixRTC is not available on this client');
    return;
  }

  try {
    const wellKnown = await matrixStore.client.getClientWellKnown();
    const rtcFoci = wellKnown?.['org.matrix.msc4143.rtc_foci'];
    diagnostics.matrixRTC.focus = Array.isArray(rtcFoci) && rtcFoci.length > 0;
    if (!diagnostics.matrixRTC.focus) {
      diagnostics.errors.push('No MatrixRTC foci in .well-known — falling back to default matrix.org focus');
    }
  } catch (error) {
    diagnostics.matrixRTC.focus = false;
    diagnostics.errors.push(`Focus discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkLiveKit() {
  try {
    const workerUrl = new URL('livekit-client/e2ee-worker', import.meta.url).href;
    const response = await fetch(workerUrl);
    diagnostics.livekit.worker = response.ok;
    if (!diagnostics.livekit.worker) {
      diagnostics.errors.push('LiveKit E2EE worker is not accessible');
    }
  } catch (error) {
    diagnostics.livekit.worker = false;
    diagnostics.errors.push(`LiveKit worker check failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  diagnostics.livekit.e2ee = !!(window.crypto?.subtle);
  if (!diagnostics.livekit.e2ee) {
    diagnostics.errors.push('WebCrypto API unavailable — E2EE will fail');
  }

  diagnostics.livekit.websocket = !!(window.WebSocket);
  if (!diagnostics.livekit.websocket) {
    diagnostics.errors.push('WebSocket not available — LiveKit connections will fail');
  }
}

function generateRecommendations() {
  if (!diagnostics.browser.getUserMedia) {
    diagnostics.recommendations.push('Enable microphone/camera permissions in your browser or OS settings');
  }
  if (!diagnostics.network.livekit) {
    diagnostics.recommendations.push('Check your internet connection and firewall — LiveKit requires WebSocket/TURN access');
  }
  if (!diagnostics.matrixRTC.focus) {
    diagnostics.recommendations.push('Add org.matrix.msc4143.rtc_foci to your homeserver .well-known configuration');
  }
  if (!diagnostics.livekit.e2ee) {
    diagnostics.recommendations.push('Use a browser with WebCrypto support (Chrome, Firefox, Safari) for E2EE');
  }
}

function dumpRoomState() {
  if (!matrixStore.client || !debugRoomId.value) return;

  const room = matrixStore.client.getRoom(debugRoomId.value);
  if (!room) {
    console.error(`[VoiceDiag] Room not found: ${debugRoomId.value}`);
    return;
  }

  console.log(`=== Room State Dump: ${debugRoomId.value} ===`);

  room.currentState.events.forEach((stateKeyMap, eventType) => {
    if (eventType.includes('rtc') || eventType.includes('call') || eventType.includes('member')) {
      console.log(`\n--- ${eventType} ---`);
      stateKeyMap.forEach((event, stateKey) => {
        console.log('  State Key:', stateKey);
        console.log('  Sender:', event.getSender());
        console.log('  Content:', JSON.stringify(event.getContent(), null, 2));
      });
    }
  });
}
</script>
