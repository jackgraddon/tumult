
import { getSecret, getPref } from "~/composables/useAppStorage";

export default defineNuxtPlugin(async (nuxtApp) => {
    const store = useMatrixStore();
    const route = useRoute();

    // Initialise basic storage (preferences, theme, etc.)
    await store.initStorage();

    // Prevent auto-login on the callback page to avoid race conditions
    if (!route.path.includes('/auth/callback')) {
        console.log('[MatrixPlugin] Starting session restoration check...');
        const accessToken = await getSecret('matrix_access_token');
        const userId = await getPref('matrix_user_id', null);
        const deviceId = await getPref('matrix_device_id', null);
        const refreshToken = await getSecret('matrix_refresh_token');
        const homeserverUrl = await getPref('matrix_homeserver_url', null);

        // Synchronize homeserver URL to localStorage for sync utilities
        if (homeserverUrl && typeof localStorage !== 'undefined') {
            localStorage.setItem('matrix_homeserver_url', homeserverUrl);
        }

        // OIDC metadata needed to rebuild token refresh function
        const issuer = await getPref('matrix_oidc_issuer', null);
        const clientId = await getPref('matrix_oidc_client_id', null);
        const idTokenClaims = await getPref('matrix_oidc_id_token_claims', undefined);

        console.log('[MatrixPlugin] Session data:', {
            hasAccessToken: !!accessToken,
            userId,
            deviceId,
            hasRefreshToken: !!refreshToken,
            hasOidcMetadata: !!(issuer && clientId && idTokenClaims)
        });

        // Validate data (Check for "undefined" string which caused your earlier crash)
        if (accessToken && userId && userId !== 'undefined') {
            console.log('[MatrixPlugin] Restoring Matrix session for:', userId);

            // Pass it to the store. We DO NOT await this here.
            // initClient() handles its own internal async lifecycle.
            // Awaiting it here would block Nuxt from hydrating the page,
            // leading to the "white screen" hang if sync takes too long.
            store.initClient(
                accessToken,
                userId,
                deviceId || undefined,
                refreshToken || undefined,
                issuer || undefined,
                clientId || undefined,
                idTokenClaims,
            ).catch(err => {
                console.error('Failed to restore Matrix session:', err);
                store.isRestoringSession = false;
            });
        } else {
            console.log('[MatrixPlugin] No session found, clearing restoration flag.');
            store.isRestoringSession = false;
        }
    } else {
        // We are on auth callback, not restoring session here
        store.isRestoringSession = false;
    }

    return {
        provide: {
            matrix: () => store.client
        }
    };
});