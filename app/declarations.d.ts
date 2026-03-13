declare module 'vue3-emoji-picker/css' { }

declare module '#app' {
  interface NuxtApp {
    $isTauri: boolean
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $isTauri: boolean
  }
}

export { }