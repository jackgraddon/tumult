import { resolve } from 'node:path'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  future: { compatibilityVersion: 4 },
  ssr: false,
  srcDir: 'app',
  devtools: { enabled: true },

  app: {
    head: {
      htmlAttrs: {
        lang: 'en'
      },
      title: 'Tumult',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/pwa-32x32.png' },
        { rel: 'apple-touch-icon', href: '/pwa-192x192.png' }
      ]
    }
  },

  runtimeConfig: {
    // Server-side config (not exposed to client)
    matrix: {
      baseUrl: process.env.NUXT_PUBLIC_MATRIX_BASE_URL || 'matrix.org',
      clientUrl: process.env.NUXT_PUBLIC_CLIENT_URL || 'http://localhost:3000',
      redirectEndpoint: process.env.NUXT_MATRIX_REDIRECT_ENDPOINT || '/api/auth/oidc/callback',
      clientName: process.env.NUXT_MATRIX_CLIENT_NAME || 'Tumult',
      clientId: process.env.NUXT_MATRIX_CLIENT_ID || '',
      contactEmail: process.env.NUXT_MATRIX_CONTACT_EMAIL || 'admin@localho.st',
    },
    vapid: {
      publicKey: process.env.NUXT_VAPID_PUBLIC_KEY || 'BG1ZIw13v4KW4i2Xu6cV8IdPBgvXWj2E3CmjmI5njf_rCf05h0jv3D85uzKvn9YAuwMd0UBZfDDlbr3hbutwF_Y',
      privateKey: process.env.NUXT_VAPID_PRIVATE_KEY || '',
      subject: process.env.NUXT_VAPID_SUBJECT || 'mailto:admin@tumult.jackg.cc',
    },
    public: {
      matrix: {
        baseUrl: process.env.NUXT_PUBLIC_MATRIX_BASE_URL || 'matrix.org',
        recommendedHomeservers: (process.env.NUXT_PUBLIC_MATRIX_RECOMMENDED_HOMESERVERS || 'matrix.org,mozilla.org,gnome.org,kde.org').split(','),
      },
      push: {
        relayUrl: process.env.NUXT_PUBLIC_PUSH_BASE_URL || 'https://tumult.jackg.cc/',
        vapidPublicKey: process.env.NUXT_VAPID_PUBLIC_KEY || 'BG1ZIw13v4KW4i2Xu6cV8IdPBgvXWj2E3CmjmI5njf_rCf05h0jv3D85uzKvn9YAuwMd0UBZfDDlbr3hbutwF_Y',
      }
    }
  },

  routeRules: {
    '/chat/**': { ssr: false },
  },

  css: [
    '@/assets/css/main.css',
    '@/assets/css/tailwind.css',
  ],
  shadcn: {
    prefix: 'Ui',
    componentDir: '@/components/ui'
  },

  vite: {
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_'],
    server: {
      allowedHosts: ['localho.st', 'localhost'],
      strictPort: true,
      fs: {
        allow: [
          resolve('.'),
          resolve('..'),
        ]
      }
    },
    optimizeDeps: {
      exclude: ['@matrix-org/matrix-sdk-crypto-wasm'],
      include: [
        '@vue/devtools-core',
        '@vue/devtools-kit',
        'workbox-window',
        'workbox-precaching',
        '@tauri-apps/api/event',
        '@tauri-apps/plugin-store',
        'vue-sonner',
        '@tauri-apps/api/core',
        '@tauri-apps/api/window',
        'matrix-js-sdk',
        'matrix-js-sdk/lib/crypto-api/CryptoEvent',
        'matrix-js-sdk/lib/crypto-api/verification',
        'matrix-js-sdk/lib/crypto-api/key-passphrase',
        'matrix-js-sdk/lib/crypto-api/recovery-key',
        'matrix-js-sdk/lib/matrixrtc/MatrixRTCSessionManager',
        'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession',
        '@vueuse/core',
        '@tauri-apps/plugin-os',
        '@tauri-apps/plugin-shell',
        'qrcode',
        'jsqr',
        'lucide-vue-next',
        'vue3-emoji-picker',
        'class-variance-authority',
        'reka-ui',
        'livekit-client',
        '@tauri-apps/plugin-autostart',
        '@tauri-apps/plugin-notification',
        '@tauri-apps/plugin-updater',
        'clsx',
        'tailwind-merge'
      ],
      entries: [
        './app/app.vue',
        './app/pages/**/*.vue'
      ]
    },
    esbuild: {
      supported: {
        'top-level-await': true
      },
    },
    build: {
      sourcemap: false
    },
  },

  nitro: {
    experimental: {
      wasm: true,
    },
  },

  devServer: {
    host: 'localhost',
    port: 3000,
    // https: {
    //   key: './.dev/keys/server.key',
    //   cert: './.dev/keys/server.crt'
    // }
  },

  ignore: [
    'src-tauri/**'
  ],

  modules: [
    '@nuxt/devtools',
    '@nuxt/eslint',
    '@nuxt/image',
    '@nuxt/icon',
    '@nuxt/fonts',
    '@nuxt/a11y',
    '@pinia/nuxt',
    'shadcn-nuxt',
    '@nuxtjs/tailwindcss',
    '@nuxtjs/color-mode',
    '@vite-pwa/nuxt'
  ],

  pwa: {
    strategies: 'injectManifest',
    filename: 'sw.js',
    registerType: 'prompt',
    injectRegister: 'script',
    manifest: {
      name: 'Tumult',
      short_name: 'Tumult',
      description: 'Own your noise. A smart, rebellious friend for your conversations.',
      theme_color: '#ffffff',
      background_color: '#ffffff',
      display: 'standalone',
      orientation: 'any',
      scope: '/',
      start_url: '/',
      categories: ['social', 'chat', 'communications'],
      icons: [
        {
          src: 'pwa-64x64.png',
          sizes: '64x64',
          type: 'image/png'
        },
        {
          src: 'pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any maskable'
        },
        {
          src: 'pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable'
        }
      ]
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      maximumFileSizeToCacheInBytes: 5000000,
    },
    injectManifest: {
      swSrc: resolve('public/sw.js'),
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      maximumFileSizeToCacheInBytes: 5000000,
    },
    client: {
      installPrompt: true,
    },
    devOptions: {
      enabled: false,
      suppressWarnings: true,
      navigateFallback: '/',
      navigateFallbackAllowlist: [new RegExp('^\\/$')],
      type: 'module',
    },
  },

  typescript: {
    tsConfig: {
      include: ['./app/declarations.d.ts']
    }
  },

  colorMode: {
    classSuffix: '',
    preference: 'system',
    fallback: 'light',
  },
})