/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** Public https URL identifying this app to the IdP. See .env.example. */
    readonly VITE_CLIENT_URI?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare module "*.vue" {
    import type { DefineComponent } from "vue";
    const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
    export default component;
}
