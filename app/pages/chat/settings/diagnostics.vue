<template>
  <div class="space-y-4">
    <h2 class="text-2xl font-semibold tracking-tight">Diagnostics</h2>

    <div class="flex flex-wrap gap-2">
      <UiButton @click="getPushers" variant="outline" class="gap-2">
        <Icon name="solar:monitor-bold-duotone" class="h-4 w-4" />
        Get Pushers
      </UiButton>
      <UiButton @click="resetPusher" variant="destructive" class="gap-2" :disabled="isResettingPusher">
        <Icon :name="isResettingPusher ? 'solar:refresh-bold' : 'solar:refresh-bold-duotone'" class="h-4 w-4" :class="{ 'animate-spin': isResettingPusher }" />
        {{ isResettingPusher ? 'Fixing...' : 'Fix Pusher URL' }}
      </UiButton>
      <UiButton @click="hardResetPush" variant="destructive" class="gap-2" :disabled="isResettingPusher">
        <Icon name="solar:bomb-bold-duotone" class="h-4 w-4" />
        Hard Reset Push
      </UiButton>
    </div>

    <div class="flex items-center justify-between">
      <div>
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

      <!-- Push Notifications -->
      <UiCard>
        <UiCardHeader class="pb-2 pt-4 px-4">
          <UiCardTitle class="text-sm font-medium flex items-center gap-2">
            <Icon name="solar:bell-bold-duotone" class="h-4 w-4 text-muted-foreground" />
            Push Notifications
          </UiCardTitle>
        </UiCardHeader>
        <UiCardContent class="px-4 pb-4 space-y-2">
          <DiagRow label="Service Worker" :status="getStatus(diagnostics.push.serviceWorker)" />
          <DiagRow label="Push Manager" :status="getStatus(diagnostics.push.pushManager)" />
          <DiagRow label="Notification Permission" :status="getStatus(diagnostics.push.permission)" />
          <DiagRow label="Push Subscription" :status="getStatus(diagnostics.push.subscription)" />
          <DiagRow label="Matrix Pusher Registered" :status="getStatus(diagnostics.push.pusherRegistered)" />
          <DiagRow label="Pusher Key Format (JSON)" :status="getStatus(diagnostics.push.pusherKeyValid)" />
          <DiagRow label="Pusher URL Correct" :status="getStatus(diagnostics.push.pusherUrlCorrect)" />
          <div v-if="diagnostics.push.pusherUrl" class="mt-2 p-2 rounded bg-muted/40 font-mono text-[10px] break-all text-muted-foreground">
            <span class="text-foreground font-semibold">Registered URL: </span>{{ diagnostics.push.pusherUrl }}
          </div>
          <div v-if="diagnostics.push.expectedUrl" class="p-2 rounded bg-muted/40 font-mono text-[10px] break-all text-muted-foreground">
            <span class="text-foreground font-semibold">Expected URL: </span>{{ diagnostics.push.expectedUrl }}
          </div>
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

    <!-- Pusher reset status -->
    <UiCard v-if="pusherResetStatus" :class="pusherResetStatus.ok ? 'border-green-500/40 bg-green-500/5' : 'border-destructive/40 bg-destructive/5'">
      <UiCardContent class="px-4 py-4 flex items-center gap-3">
        <Icon
          :name="pusherResetStatus.ok ? 'solar:check-circle-bold' : 'solar:close-circle-bold'"
          class="h-5 w-5 shrink-0"
          :class="pusherResetStatus.ok ? 'text-green-500' : 'text-destructive'"
        />
        <p class="text-sm" :class="pusherResetStatus.ok ? 'text-green-700 dark:text-green-400' : 'text-destructive'">
          {{ pusherResetStatus.message }}
        </p>
      </UiCardContent>
    </UiCard>

    <!-- Matrix Pushers List -->
    <UiCard>
      <UiCardHeader class="pb-2 pt-4 px-4">
        <UiCardTitle class="text-sm font-medium flex items-center gap-2">
          <Icon name="solar:notification-lines-remove-bold-duotone" class="h-4 w-4 text-muted-foreground" />
          Matrix Pushers
        </UiCardTitle>
      </UiCardHeader>
      <UiCardContent class="px-4 pb-4">
        <div v-if="pusherList.length === 0" class="text-xs text-muted-foreground py-2">
          No pushers found. Click "Get Pushers" to refresh.
        </div>
        <div v-else class="space-y-3">
          <div v-for="p in pusherList" :key="p.pushkey" class="p-2 border rounded-md bg-muted/30 space-y-1">
            <div class="flex justify-between items-center">
              <span class="font-mono text-xs font-bold">{{ p.app_id }}</span>
              <div class="flex items-center gap-1.5">
                <!-- Flag bad Tumult pusher URL inline -->
                <span
                  v-if="p.app_id === 'cc.jackg' && !isCorrectPusherUrl(p.data?.url)"
                  class="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium"
                >
                  Wrong URL
                </span>
                <span
                  v-else-if="p.app_id === 'cc.jackg'"
                  class="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 font-medium"
                >
                  URL OK
                </span>
                <span
                  v-if="p.app_id === 'cc.jackg' && !isValidJson(p.pushkey)"
                  class="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium"
                >
                  Invalid Key Format
                </span>
                <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{{ p.kind || 'none' }}</span>
              </div>
            </div>
            <div class="text-[10px] text-muted-foreground break-all">
              <p><strong>Pusher URL:</strong> {{ p.data?.url || 'N/A' }}</p>
              <p><strong>Display:</strong> {{ p.app_display_name }} ({{ p.device_display_name }})</p>
            </div>
          </div>
        </div>
      </UiCardContent>
    </UiCard>

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
definePageMeta({
  icon: 'solar:bug-bold-duotone',
  category: 'advanced',
  title: 'Diagnostics',
  place: 1
})

import { ref, reactive } from 'vue';
import { useMatrixStore } from '~/stores/matrix';
import { Method } from 'matrix-js-sdk';

const { $isTauri: isTauri } = useNuxtApp();
const matrixStore = useMatrixStore();
const config = useRuntimeConfig();

const isRunning = ref(false);
const hasRun = ref(false);
const isResettingPusher = ref(false);
const debugRoomId = ref('');
const pusherList = ref<any[]>([]);
const pusherResetStatus = ref<{ ok: boolean; message: string } | null>(null);

// The correct URL is the Nuxt server route path directly.
// The homeserver POSTs to this URL as-is (does NOT append anything).
const CORRECT_PUSHER_URL = 'https://tumult.jackg.cc/_matrix/push/v1/notify';

function isCorrectPusherUrl(url: string | undefined): boolean {
  return url === CORRECT_PUSHER_URL;
}

function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

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
  push: {
    serviceWorker: null as boolean | null,
    pushManager: null as boolean | null,
    permission: null as boolean | null,
    subscription: null as boolean | null,
    pusherRegistered: null as boolean | null,
    pusherKeyValid: null as boolean | null,
    pusherUrlCorrect: null as boolean | null,
    pusherUrl: null as string | null,
    expectedUrl: null as string | null,
  },
  errors: [] as string[],
  successes: [] as string[],
  recommendations: [] as string[],
});

async function getPushers() {
  if (!matrixStore.client) return;
  const pushers = await matrixStore.client.getPushers();
  pusherList.value = pushers.pushers;
  console.log(pushers);
}

/**
 * Directly overwrites the Tumult pusher on the homeserver with the correct URL.
 * 
 * We do NOT delete-and-reload because that just re-registers using the same
 * broken NUXT_PUBLIC_PUSH_RELAY_URL env var, ending up back at the Sygnal address.
 * Instead, setPusher with the same app_id overwrites the existing entry in-place.
 */
async function resetPusher() {
  console.log('[Diagnostics] resetPusher called, client:', !!matrixStore.client);

  if (!matrixStore.client) {
    pusherResetStatus.value = { ok: false, message: 'Matrix client not ready.' };
    return;
  }

  isResettingPusher.value = true;
  pusherResetStatus.value = null;

  try {
    // Always fetch fresh from the server so we have the exact pushkey
    const { pushers } = await matrixStore.client.getPushers();
    pusherList.value = pushers;

    const tumultPusher = pushers.find((p: any) => p.app_id === 'cc.jackg');

    if (!tumultPusher) {
      pusherResetStatus.value = { ok: false, message: 'No Tumult pusher found on the homeserver. Open the app fresh to register one.' };
      return;
    }

    // Re-use the existing pushkey exactly as stored — no SW lookup needed.
    // setPusher with the same app_id overwrites the entry in-place on the homeserver.
    await (matrixStore.client as any).setPusher({
      app_id: 'cc.jackg',
      app_display_name: 'Tumult',
      device_display_name: tumultPusher.device_display_name ?? 'Web Client',
      pushkey: tumultPusher.pushkey,
      kind: 'http',
      lang: 'en',
      data: {
        url: CORRECT_PUSHER_URL,
      },
    });

    // Refresh and verify
    const after = await matrixStore.client.getPushers();
    pusherList.value = after.pushers;

    const updated = after.pushers.find((p: any) => p.app_id === 'cc.jackg');
    if (updated && isCorrectPusherUrl(updated.data?.url)) {
      pusherResetStatus.value = { ok: true, message: `✓ Pusher URL fixed → ${CORRECT_PUSHER_URL}` };
    } else {
      pusherResetStatus.value = {
        ok: false,
        message: `Pusher was updated but URL still shows: "${updated?.data?.url ?? 'unknown'}". The homeserver may have rejected the change.`
      };
    }
  } catch (error) {
    console.error('[Diagnostics] resetPusher failed:', error);
    pusherResetStatus.value = {
      ok: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    isResettingPusher.value = false;
  }
}

/**
 * Hard Reset: Unsubscribes from push entirely and re-subscribes to force a fresh JSON pushkey.
 */
async function hardResetPush() {
  console.log('[Diagnostics] hardResetPush called');

  if (!matrixStore.client) {
    pusherResetStatus.value = { ok: false, message: 'Matrix client not ready.' };
    return;
  }

  isResettingPusher.value = true;
  pusherResetStatus.value = null;

  try {
    if (!('serviceWorker' in navigator)) {
       throw new Error('Service Worker not supported');
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      console.log('[Diagnostics] Unsubscribing from existing push...');
      await subscription.unsubscribe();
    }

    console.log('[Diagnostics] Re-subscribing...');
    const newSub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: config.public.push.vapidPublicKey
    });

    console.log('[Diagnostics] Registering new pusher on homeserver...');
    await (matrixStore.client as any).setPusher({
      app_id: 'cc.jackg',
      app_display_name: 'Tumult',
      device_display_name: 'Web Client (Reset)',
      pushkey: JSON.stringify(newSub.toJSON()),
      kind: 'http',
      lang: 'en',
      data: {
        url: CORRECT_PUSHER_URL,
      },
    });

    pusherResetStatus.value = { ok: true, message: '✓ Hard reset complete. Push subscription and Matrix pusher recreated.' };
    await getPushers();
    await checkPushNotifications();
  } catch (error) {
    console.error('[Diagnostics] hardResetPush failed:', error);
    pusherResetStatus.value = {
      ok: false,
      message: `Hard Reset Error: ${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    isResettingPusher.value = false;
  }
}

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
  Object.keys(diagnostics.push).forEach(k => (diagnostics.push as any)[k] = null);

  try {
    await checkBrowserCapabilities();
    await checkNetworkConnectivity();
    await checkMatrixRTC();
    await checkLiveKit();
    await checkPushNotifications();
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
    diagnostics.errors.push('Tumult is not initialized');
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
    return;
  }

  diagnostics.matrixRTC.available = !!(matrixStore.client.matrixRTC);

  try {
    // 1. Try the SDK first
    let wellKnown = await matrixStore.client.getClientWellKnown();
    
    // 2. If SDK says undefined, force a fresh fetch to verify the Worker
    if (!wellKnown) {
      const response = await fetch(`${matrixStore.client.getHomeserverUrl()}/.well-known/matrix/client`);
      if (response.ok) {
        wellKnown = await response.json();
      }
    }

    console.log("Resolved Well-Known:", wellKnown);

    const rtcFoci = wellKnown?.['org.matrix.msc4143.rtc_foci'];
    diagnostics.matrixRTC.focus = Array.isArray(rtcFoci) && rtcFoci.length > 0;
    
    if (!diagnostics.matrixRTC.focus) {
      diagnostics.errors.push('No MatrixRTC foci found in well-known');
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

async function checkPushNotifications() {
  // Service Worker
  diagnostics.push.serviceWorker = 'serviceWorker' in navigator;
  if (!diagnostics.push.serviceWorker) {
    diagnostics.errors.push('Service Worker not supported — background push is impossible');
    diagnostics.push.pushManager = false;
    diagnostics.push.permission = false;
    diagnostics.push.subscription = false;
    diagnostics.push.pusherRegistered = false;
    diagnostics.push.pusherKeyValid = false;
    diagnostics.push.pusherUrlCorrect = false;
    return;
  }

  // Push Manager
  diagnostics.push.pushManager = 'PushManager' in window;
  if (!diagnostics.push.pushManager) {
    diagnostics.errors.push('PushManager not available — this browser cannot receive push notifications');
  }

  // Notification Permission
  const permission = Notification.permission;
  diagnostics.push.permission = permission === 'granted';
  if (permission === 'denied') {
    diagnostics.errors.push('Notification permission denied — user must re-enable in iOS Settings');
  } else if (permission === 'default') {
    diagnostics.errors.push('Notification permission not yet granted');
  }

  // Push Subscription
  try {
    const swReg = await navigator.serviceWorker.ready;
    const sub = await swReg.pushManager.getSubscription();
    diagnostics.push.subscription = !!sub;
    if (!sub) {
      diagnostics.errors.push('No active push subscription — the app needs to be re-opened to re-subscribe');
    }
  } catch (e) {
    diagnostics.push.subscription = false;
    diagnostics.errors.push(`Push subscription check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Matrix Pusher & URL check
  if (!matrixStore.client) {
    diagnostics.push.pusherRegistered = false;
    diagnostics.push.pusherKeyValid = false;
    diagnostics.push.pusherUrlCorrect = false;
    return;
  }

  try {
    const { pushers } = await matrixStore.client.getPushers();
    pusherList.value = pushers; // keep the list in sync
    const tumultPusher = pushers.find((p: any) => p.app_id === 'cc.jackg');

    diagnostics.push.pusherRegistered = !!tumultPusher;
    if (!tumultPusher) {
      diagnostics.errors.push('No Tumult pusher registered on the homeserver — push will not be delivered when closed');
      diagnostics.push.pusherKeyValid = false;
      diagnostics.push.pusherUrlCorrect = false;
    } else {
      const registeredUrl = tumultPusher.data?.url ?? '';
      diagnostics.push.pusherUrl = registeredUrl;
      diagnostics.push.expectedUrl = CORRECT_PUSHER_URL;
      diagnostics.push.pusherUrlCorrect = isCorrectPusherUrl(registeredUrl);

      diagnostics.push.pusherKeyValid = isValidJson(tumultPusher.pushkey);

      if (!diagnostics.push.pusherKeyValid) {
        diagnostics.errors.push('Pusher key format is invalid (not JSON). This is likely an old FCM subscription. Use "Hard Reset Push" to fix it.');
      }

      if (!diagnostics.push.pusherUrlCorrect) {
        diagnostics.errors.push(
          `Pusher URL is wrong: "${registeredUrl}". Click "Fix Pusher URL" to correct it.`
        );
      }
    }
  } catch (e) {
    diagnostics.push.pusherRegistered = false;
    diagnostics.push.pusherKeyValid = false;
    diagnostics.push.pusherUrlCorrect = false;
    diagnostics.errors.push(`Failed to fetch pushers: ${e instanceof Error ? e.message : String(e)}`);
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
  if (diagnostics.push.pusherRegistered && !diagnostics.push.pusherUrlCorrect) {
    diagnostics.recommendations.push('Click "Fix Pusher URL" at the top of this page to correct the push relay address');
  }
  if (diagnostics.push.pusherRegistered && !diagnostics.push.pusherKeyValid) {
    diagnostics.recommendations.push('Click "Hard Reset Push" to fix the invalid pushkey format');
  }
  if (!diagnostics.push.permission) {
    diagnostics.recommendations.push('On iOS, make sure this app is added to your Home Screen and notifications are enabled in Settings → Notifications');
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