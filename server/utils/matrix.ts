import * as sdk from 'matrix-js-sdk';

const config = useRuntimeConfig();

const matrixConfig = config.matrix;

const MATRIX_BASE_URL = matrixConfig?.baseUrl;
// Normalize URLs
const clientUrl = matrixConfig?.clientUrl?.replace(/\/+$/, '') || '';
const redirectEndpointRaw = matrixConfig?.redirectEndpoint || '/api/auth/oidc/callback';
const redirectEndpoint = redirectEndpointRaw.startsWith('/') ? redirectEndpointRaw : `/${redirectEndpointRaw}`;

export const MATRIX_CLIENT_URL = clientUrl;
export const REDIRECT_ENDPOINT = redirectEndpoint;

const MATRIX_CLIENT_NAME = matrixConfig?.clientName || 'Tumult';
const MATRIX_CLIENT_ID = matrixConfig?.clientId;
const CONTACT_EMAIL = matrixConfig?.contactEmail;

const clientMetadata: sdk.OidcRegistrationClientMetadata = {
    applicationType: "native",
    clientName: MATRIX_CLIENT_NAME,
    clientUri: MATRIX_CLIENT_URL,
    contacts: CONTACT_EMAIL ? [CONTACT_EMAIL] : [],
    policyUri: MATRIX_CLIENT_URL,
    redirectUris: [`${MATRIX_CLIENT_URL}${REDIRECT_ENDPOINT}`],
    tosUri: MATRIX_CLIENT_URL,
};

/**
 * Create a Tumult instance
 * @returns {sdk.MatrixClient} A Tumult
 */
function createMatrixClient() {
    return sdk.createClient({
        baseUrl: MATRIX_BASE_URL,
    });
}

/**
 * Discover OIDC configuration from Matrix server
 * @returns {Promise<sdk.OidcClientConfig>} The OIDC client config
 */
export async function discoverOidcConfig() {
    const client = createMatrixClient();
    return client.getAuthMetadata();
}

/**
 * Register a Tumult for server-side operations
 * @returns {Promise<string>} The registered client ID
 */
export async function registerClient() {
    if (MATRIX_CLIENT_ID) {
        return MATRIX_CLIENT_ID;
    }

    const authConfig = await discoverOidcConfig();
    return sdk.registerOidcClient(authConfig, clientMetadata);
}