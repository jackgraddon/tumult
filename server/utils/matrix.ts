import * as sdk from 'matrix-js-sdk';

const config = useRuntimeConfig();

const MATRIX_BASE_URL = config.matrix?.baseUrl;
// Normalize URLs
const clientUrl = config.matrix?.clientUrl?.replace(/\/+$/, '') || '';
const redirectEndpoint = config.matrix?.redirectEndpoint?.startsWith('/') ? config.matrix?.redirectEndpoint : `/${config.matrix?.redirectEndpoint}`;
export const MATRIX_CLIENT_URL = clientUrl;
export const REDIRECT_ENDPOINT = redirectEndpoint;
const MATRIX_CLIENT_NAME = config.matrix?.clientName;
const MATRIX_CLIENT_ID = config.matrix?.clientId;
const CONTACT_EMAIL = config.matrix?.contactEmail;

const clientMetadata: sdk.OidcRegistrationClientMetadata = {
    applicationType: "native",
    clientName: MATRIX_CLIENT_NAME,
    clientUri: MATRIX_CLIENT_URL,
    contacts: [CONTACT_EMAIL],
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