
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('long-press', {
    mounted(el, binding) {
      if (typeof binding.value !== 'function') return;

      let timer: any = null;
      let startX = 0;
      let startY = 0;
      const MOVE_THRESHOLD = 10;

      const start = (e: any) => {
        // Only primary mouse button or touch
        if (e.type === 'mousedown' && e.button !== 0) return;

        if (e.type === 'touchstart') {
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
        }

        if (timer === null) {
          timer = setTimeout(() => {
            // Trigger long press
            binding.value(e);

            // Light haptic feedback to signal trigger
            if ('vibrate' in navigator) navigator.vibrate(10);

            // Prevent default behavior to avoid native menus after trigger
            if (e.cancelable) e.preventDefault();

            // Cleanup timer
            timer = null;
          }, 500);
        }
      };

      const move = (e: TouchEvent) => {
        if (timer === null) return;

        const deltaX = Math.abs(e.touches[0].clientX - startX);
        const deltaY = Math.abs(e.touches[0].clientY - startY);

        if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
          cancel();
        }
      };

      const cancel = () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      };

      el.addEventListener('mousedown', start);
      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchmove', move);
      el.addEventListener('mouseup', cancel);
      el.addEventListener('mouseleave', cancel);
      el.addEventListener('touchend', cancel);
      el.addEventListener('touchcancel', cancel);

      // Also intercept the actual contextmenu event to prevent native fallback
      // if we've handled it via long-press (or just generally for these elements)
      const preventDefault = (e: Event) => {
        // Optional: Only prevent if we handled it. But usually elements with
        // @contextmenu want to prevent native anyway.
        // e.preventDefault();
      };
      el.addEventListener('contextmenu', preventDefault);

      // Cleanup
      el._longPressCleanup = () => {
        el.removeEventListener('mousedown', start);
        el.removeEventListener('touchstart', start);
        el.removeEventListener('touchmove', move);
        el.removeEventListener('mouseup', cancel);
        el.removeEventListener('mouseleave', cancel);
        el.removeEventListener('touchend', cancel);
        el.removeEventListener('touchcancel', cancel);
        el.removeEventListener('contextmenu', preventDefault);
      };
    },
    unmounted(el) {
      if (el._longPressCleanup) el._longPressCleanup();
    }
  });
});
