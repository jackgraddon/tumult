import type * as sdk from 'matrix-js-sdk';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api/CryptoEvent';
import { VerificationPhase, VerificationRequestEvent, VerifierEvent } from 'matrix-js-sdk/lib/crypto-api/verification';
import type { VerificationRequest, Verifier, ShowSasCallbacks } from 'matrix-js-sdk/lib/crypto-api/verification';
import { useMatrixStore } from '~/stores/matrix';
import { useUIStore } from '~/stores/ui';
import { markRaw } from 'vue';
import { toast } from 'vue-sonner';
import { getPref, setPref } from '~/composables/useAppStorage';

export class VerificationService {
  private static instance: VerificationService;
  private client: sdk.MatrixClient | null = null;

  private constructor() {}

  public static getInstance(): VerificationService {
    if (!VerificationService.instance) VerificationService.instance = new VerificationService();
    return VerificationService.instance;
  }

  setClient(client: sdk.MatrixClient | null) {
    this.client = client;
    if (this.client) {
        this.setupCryptoListeners();
        this.setupVerificationListeners();
    }
  }

  private setupCryptoListeners() {
    if (!this.client) return;

    this.client.on("crypto.secrets.request" as any, async (request: any) => {
      const userId = request.userId;
      const deviceId = request.deviceId;
      console.log(`[Gossip] Secret request received for ${request.name} from ${deviceId}`);

      try {
        const crypto = this.client?.getCrypto();
        if (!crypto) return;

        const status = await crypto.getDeviceVerificationStatus(userId, deviceId);
        if (status?.isVerified()) {
          console.log(`[Gossip] Device ${deviceId} is verified. Sharing ${request.name}...`);
          await request.share();
        } else {
          console.warn(`[Gossip] Unverified device ${deviceId} requested ${request.name}. Ignoring.`);
        }
      } catch (e) {
        console.error(`[Gossip] Error processing secret request from ${deviceId}:`, e);
      }
    });

    this.client.on("crypto.secrets.receiving" as any, (name: string) => {
      console.log(`[Gossip] Receiving secret: ${name}`);
    });

    this.client.on("crypto.secrets.received" as any, async (name: string) => {
      console.log(`[Gossip] Successfully received and stored: ${name}`);
      const store = useMatrixStore();

      if (name === 'm.megolm_backup.v1') {
        console.log('[Gossip] Megolm backup key received! Triggering automated restoration...');
        await this.loadSessionBackupPrivateKeyFromSecretStorage();
        await this.restoreKeysFromBackup();
        await this.retryDecryption();

        store.isRestoringHistory = false;
        store.cancelSecretStorageKey();

        setTimeout(() => {
          if (store.isVerificationCompleted && !store.isRestoringHistory) {
            store._resetVerificationState();
          }
        }, 1000);
      } else if (name === 'm.cross_signing.master') {
        await this.checkDeviceVerified();
        store.cancelSecretStorageKey();
      }
    });
  }

  private setupVerificationListeners() {
    if (!this.client) return;

    this.client.on(CryptoEvent.VerificationRequestReceived, (request: VerificationRequest) => {
      if (request.initiatedByMe) return;
      const store = useMatrixStore();
      const uiStore = useUIStore();

      if (store.isVerificationInitiatedByMe && store.activeVerificationRequest &&
          ![VerificationPhase.Cancelled, VerificationPhase.Done].includes(store.activeVerificationRequest.phase)) {
        return;
      }

      console.log('Incoming verification from:', request.otherUserId, (request as any).transactionId);
      store.activeVerificationRequest = markRaw(request);
      store.isVerificationInitiatedByMe = request.initiatedByMe;
      store.verificationPhase = request.phase;
      uiStore.setVerificationModalOpen(true);

      this.attachRequestListeners(request);
    });

    this.client.on(CryptoEvent.KeysChanged, () => this.checkDeviceVerified());
    this.client.on(CryptoEvent.UserTrustStatusChanged, () => this.checkDeviceVerified());
  }

  public attachRequestListeners(request: VerificationRequest) {
    const store = useMatrixStore();
    const uiStore = useUIStore();

    const checkPhase = async () => {
      try {
        const phase = request.phase;
        store.verificationPhase = phase;
        store.isVerificationInitiatedByMe = request.initiatedByMe;
        const isTerminal = phase === VerificationPhase.Done || phase === VerificationPhase.Cancelled;

        if (phase === VerificationPhase.Ready) {
          store.qrCodeData = (request as any).qrCodeData || null;
          const canShowQr = (request as any).qrCodeData || request.otherPartySupportsMethod('m.qr_code.scan.v1');
          const canScanQr = request.otherPartySupportsMethod('m.qr_code.show.v1');
          const qrPossible = canShowQr || canScanQr;

          if (store.isVerificationInitiatedByMe && !request.verifier && !store.activeSas && !qrPossible) {
            const verifier = await request.startVerification('m.sas.v1');
            this.setupVerifierListeners(verifier);
          }
        } else if (phase === VerificationPhase.Started) {
          if (request.verifier) this.setupVerifierListeners(request.verifier);
        } else if (phase === VerificationPhase.Done) {
          store.isVerificationCompleted = true;
          store.activeSas = null;
          store.isRestoringHistory = true;

          store.cancelSecretStorageKey();
          await this.checkDeviceVerified();
          await this.requestSecretsFromOtherDevices();

          setTimeout(async () => {
            await this.restoreKeysFromBackup();
            store.isRestoringHistory = false;
            await this.retryDecryption();
            setTimeout(() => store._resetVerificationState(), 1000);
          }, 5000);

          toast.success('Device verified!');
        } else if (phase === VerificationPhase.Cancelled) {
          store._resetVerificationState();
          uiStore.setVerificationModalOpen(false);
        }

        if (isTerminal) {
          request.off(VerificationRequestEvent.Change, checkPhase);
        }
      } catch (err) {
        console.error('[Verification] Error in checkPhase:', err);
      }
    };

    request.on(VerificationRequestEvent.Change, checkPhase);
    checkPhase();
  }

  private setupVerifierListeners(verifier: Verifier) {
    const store = useMatrixStore();
    store.isSasTimeout = false;

    const sasTimeout = setTimeout(() => {
      if (!store.activeSas && !store.isVerificationCompleted) {
        store.isSasTimeout = true;
      }
    }, 15000);

    verifier.on(VerifierEvent.ShowSas, (sas: ShowSasCallbacks) => {
      clearTimeout(sasTimeout);
      store.isSasTimeout = false;
      store.activeSas = sas;
    });

    verifier.on(VerifierEvent.Cancel, () => {
      clearTimeout(sasTimeout);
      store._resetVerificationState();
    });

    verifier.verify().then(() => {
        clearTimeout(sasTimeout);
    }).catch((e) => {
      clearTimeout(sasTimeout);
      if (!(verifier as any).hasBeenCancelled) {
        store._resetVerificationState();
      }
    });
  }

  async checkDeviceVerified() {
    if (!this.client) return;
    const crypto = this.client.getCrypto();
    if (!crypto) return;
    const store = useMatrixStore();

    await this.client.downloadKeysForUsers([this.client.getUserId()!]);
    const wasReady = store.isCrossSigningReady;
    store.isCrossSigningReady = await crypto.isCrossSigningReady();
    store.isSecretStorageReady = await crypto.isSecretStorageReady();

    if (!wasReady && store.isCrossSigningReady) {
        this.requestSecretsFromOtherDevices();
        await this.restoreKeysFromBackup();
        this.provisionDehydratedDevice();
        this.retryDecryption();
    }
  }

  async requestVerification() {
    if (!this.client?.getCrypto()) return;
    const store = useMatrixStore();
    const uiStore = useUIStore();
    uiStore.setVerificationModalOpen(true);
    store.isRequestingVerification = true;
    try {
      await this.client.downloadKeysForUsers([this.client.getUserId()!]).catch(() => {});
      if (store.activeVerificationRequest) {
          await store.activeVerificationRequest.cancel().catch(() => {});
      }
      store.isVerificationCompleted = false;
      store.activeSas = null;

      const request = await this.client.getCrypto()!.requestOwnUserVerification();
      store.activeVerificationRequest = markRaw(request);
      store.isVerificationInitiatedByMe = request.initiatedByMe;
      store.verificationPhase = request.phase;
      this.attachRequestListeners(request);
    } finally {
      store.isRequestingVerification = false;
    }
  }

  async acceptVerification() {
    const store = useMatrixStore();
    if (!store.activeVerificationRequest) return;
    const request = store.activeVerificationRequest;

    if (request.phase === VerificationPhase.Ready) {
      const verifier = await request.startVerification('m.sas.v1');
      this.setupVerifierListeners(verifier);
    } else if (request.phase < VerificationPhase.Ready) {
      await request.accept();
    }
  }

  async reciprocateQrCode(data: string | Uint8ClampedArray) {
    const store = useMatrixStore();
    if (store.activeVerificationRequest) {
      let uint8Array: Uint8ClampedArray;
      if (data instanceof Uint8ClampedArray) {
        uint8Array = data;
      } else {
        const parts = data.split('/');
        const base64 = parts[parts.length - 1];
        const binaryString = atob(base64 || '');
        uint8Array = new Uint8ClampedArray(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          uint8Array[i] = binaryString.charCodeAt(i);
        }
      }
      const verifier = await (store.activeVerificationRequest as any).scanQRCode(uint8Array);
      this.setupVerifierListeners(verifier);
    }
  }

  async confirmSasMatch(match: boolean) {
    const store = useMatrixStore();
    if (store.activeSas) {
      try {
        if (match) {
            store.isSasConfirming = true;
            await store.activeSas.confirm();
        } else {
            await store.activeSas.mismatch();
            store.activeVerificationRequest?.cancel();
        }
      } finally {
        store.isSasConfirming = false;
      }
    }
  }

  async cancelVerification() {
    const store = useMatrixStore();
    if (store.activeVerificationRequest) {
      await store.activeVerificationRequest.cancel().catch(() => {});
    }
    store._resetVerificationState();
  }

  async bootstrapVerification() {
    if (!this.client?.getCrypto()) return;
    const store = useMatrixStore();
    const uiStore = useUIStore();
    uiStore.setVerificationModalOpen(true);
    store.isRequestingVerification = true;
    try {
      await this.client.getCrypto()!.bootstrapCrossSigning({
        setupNewCrossSigning: false
      });
      await this.client.getCrypto()!.bootstrapSecretStorage({
        setupNewSecretStorage: false
      });
      await this.checkDeviceVerified();
      await this.restoreKeysFromBackup();
      await this.retryDecryption();

      if (store.isCrossSigningReady) {
        store.isVerificationCompleted = true;
        setTimeout(() => store._resetVerificationState(), 3000);
      }
    } catch (e) {
      console.error('[VerificationService] Bootstrap failed', e);
    } finally {
      store.isRequestingVerification = false;
    }
  }

  async submitSecretStorageKey(key: string) {
    const store = useMatrixStore();
    if (store.secretStoragePrompt) {
      const prompt = store.secretStoragePrompt;
      store.secretStoragePrompt = null;
      prompt.promise.resolve(key);
    }
  }

  cancelSecretStorageKey() {
    const store = useMatrixStore();
    if (store.secretStoragePrompt) {
      const prompt = store.secretStoragePrompt;
      store.secretStoragePrompt = null;
      prompt.promise.resolve(null);
    }
  }

  async repairCrypto() {
    const store = useMatrixStore();
    await store.repairCrypto();
  }

  async resetSecurity() {
    const store = useMatrixStore();
    await store.resetSecurity();
  }

  closeVerificationModal() {
    const store = useMatrixStore();
    const uiStore = useUIStore();
    uiStore.setVerificationModalOpen(false);
    if (!store.activeVerificationRequest && !store.isVerificationCompleted) {
        store._resetVerificationState();
    }
  }

  async handleStartupDehydration() {
    if (!this.client) return;
    const crypto = this.client.getCrypto();
    if (!crypto) return;
    try {
      await (crypto as any).startDehydration.call(crypto, {
        rehydrate: true,
        onlyIfKeyCached: false,
      });
      this.maintenanceDehydration();
    } catch (e) {
      console.warn("[Dehydration] Startup rehydration failed:", e);
    }
  }

  async provisionDehydratedDevice() {
    if (!this.client) return;
    const store = useMatrixStore();
    if (!store.isCrossSigningReady) return;
    const crypto = this.client.getCrypto();
    if (!crypto) return;
    try {
      await (crypto as any).startDehydration.call(crypto, {
        rehydrate: false,
        onlyIfKeyCached: false,
      });
    } catch (e) {
      console.error("[Dehydration] Failed to provision dehydrated device:", e);
    }
  }

  async maintenanceDehydration() {
    if (!this.client) return;
    const store = useMatrixStore();
    if (!store.isCrossSigningReady) return;
    const lastRun = await getPref('matrix_crypto_dehydration_last_run', 0);
    const now = Date.now();
    const threshold = 24 * 60 * 60 * 1000 + Math.floor(Math.random() * 4 * 60 * 60 * 1000);
    if (now - lastRun < threshold) return;
    try {
      const crypto = this.client.getCrypto();
      if (crypto) {
        await (crypto as any).startDehydration.call(crypto, {
          rehydrate: false,
          onlyIfKeyCached: true,
        });
        await setPref('matrix_crypto_dehydration_last_run', now);
      }
    } catch (e) {
      console.error("[Dehydration] Maintenance failed:", e);
    }
  }

  async performCryptoSanityCheck() {
    if (!this.client) return;
    try {
      const res = await (this.client as any).getInternalHttpApi().authedRequest(
        'POST', "/_matrix/client/v3/keys/upload", {}, {}
      );
      if ((res.one_time_key_counts?.['signed_curve25519'] || 0) === 0) {
        const store = useMatrixStore();
        store.isCryptoDegraded = true;
        store.cryptoStatusMessage = "Encryption keys exhausted. Security repair required.";
        const uiStore = useUIStore();
        toast.error("Encryption Warning", {
          description: "Your security keys are out of sync. Click to repair.",
          duration: 15000,
          action: { label: "Repair", onClick: () => { uiStore.setVerificationModalOpen(true); } }
        });
      }
    } catch (e) {}
  }

  async retryDecryption() {
    if (!this.client) return;
    const rooms = this.client.getRooms();
    for (const room of rooms) {
      const events = room.getUnfilteredTimelineSet().getLiveTimeline().getEvents();
      for (const event of events) {
        if (event.isDecryptionFailure()) {
          await event.attemptDecryption(this.client.getCrypto() as any, { isRetry: true }).catch(() => {});
        }
      }
    }
  }

  async requestSecretsFromOtherDevices() {
    if (!this.client) return;
    try {
      if (typeof (this.client as any).checkOwnCrossSigningTrust === 'function') {
        await (this.client as any).checkOwnCrossSigningTrust();
      }
      await this.loadSessionBackupPrivateKeyFromSecretStorage().catch(() => {});
    } catch (e) {}
  }

  async restoreKeysFromBackup() {
    if (!this.client) return;
    const crypto = this.client.getCrypto();
    if (!crypto) return;
    try {
      const backupInfo = await crypto.getKeyBackupInfo();
      if (!backupInfo) return;
      let backupKey = await (crypto as any).getSessionBackupPrivateKey();
      let attempts = 0;
      while (!backupKey && attempts < 20) {
        await new Promise(r => setTimeout(r, 500));
        backupKey = await (crypto as any).getSessionBackupPrivateKey();
        attempts++;
      }
      if (!backupKey) await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
      await crypto.restoreKeyBackup({});
      await crypto.checkKeyBackupAndEnable();
    } catch (err) {}
  }

  async loadSessionBackupPrivateKeyFromSecretStorage() {
    if (!this.client) return;
    try {
      await this.client.getCrypto()?.loadSessionBackupPrivateKeyFromSecretStorage();
      this.retryDecryption();
    } catch (e) {}
  }
}
