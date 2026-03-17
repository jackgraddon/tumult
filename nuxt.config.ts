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
      title: 'Tumult'
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
    public: {
      matrix: {
        baseUrl: process.env.NUXT_PUBLIC_MATRIX_BASE_URL || 'matrix.org',
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
        allow: ['..']
      }
    },
    optimizeDeps: {
      exclude: ['@matrix-org/matrix-sdk-crypto-wasm'],
      include: ['@matrix-org/matrix-sdk-crypto-wasm'],
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
    build: {},
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
    '@nuxt/hints',
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
    registerType: 'autoUpdate',
    manifest: {
      name: 'Tumult',
      theme_color: '#ffffff',
      scope: '/',
      start_url: '/',
      icons: [
        {
          src: 'pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: 'pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png'
        }
      ]
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      maximumFileSizeToCacheInBytes: 5000000,
    },
    injectManifest: {
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
      navigateFallbackAllowlist: [/^\/$/],
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
