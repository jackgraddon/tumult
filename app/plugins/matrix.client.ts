import { getSecret, getPref } from "~/composables/useAppStorage";

export default defineNuxtPlugin(async (nuxtApp) => {
    const store = useMatrixStore();
    const route = useRoute();

    // Prevent auto-login on the callback page to avoid race conditions
    if (!route.path.includes('/auth/callback')) {
        const accessToken = await getSecret('matrix_access_token');
        const userId = await getPref('matrix_user_id', null);
        const deviceId = await getPref('matrix_device_id', null);
        const refreshToken = await getSecret('matrix_refresh_token');

        // OIDC metadata needed to rebuild token refresh function
        const issuer = await getPref('matrix_oidc_issuer', null);
        const clientId = await getPref('matrix_oidc_client_id', null);
        const idTokenClaimsRaw = await getPref('matrix_oidc_id_token_claims', null);
        let idTokenClaims: any = undefined;
        if (idTokenClaimsRaw && typeof idTokenClaimsRaw === 'string') {
            try {
                idTokenClaims = JSON.parse(idTokenClaimsRaw);
            } catch {
                // Invalid JSON, skip parsing
            }
        }

        // Validate data (Check for "undefined" string which caused your earlier crash)
        if (accessToken && userId && userId !== 'undefined') {
            console.log('Restoring Matrix session...');

            // Pass it to the store
            await store.initClient(
                accessToken,
                userId,
                deviceId || undefined,
                refreshToken || undefined,
                issuer || undefined,
                clientId || undefined,
                idTokenClaims,
            );
        }
    }

    return {
        provide: {
            matrix: () => store.client
        }
    };
});