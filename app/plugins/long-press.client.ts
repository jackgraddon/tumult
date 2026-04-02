
import { WebHaptics } from 'web-haptics';

export default defineNuxtPlugin((nuxtApp) => {
  const haptics = new WebHaptics();

  nuxtApp.vueApp.directive('long-press', {
    mounted(el, binding) {
      if (typeof binding.value !== 'function') return;

      let timer: any = null;
      let startX = 0;
      let startY = 0;
      const MOVE_THRESHOLD = 10;

      let isLongPressTriggered = false;

      const start = (e: TouchEvent) => {
        const store = useMatrixStore();

        // Touch only to avoid interfering with desktop right-click logic
        if (e.type !== 'touchstart') return;

        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isLongPressTriggered = false;

        if (timer === null) {
          timer = setTimeout(() => {
            isLongPressTriggered = true;

            // Trigger long press
            binding.value(e);

            // Light haptic feedback to signal trigger
            if (store.ui.hapticFeedbackEnabled) {
              haptics.setDebug(store.ui.hapticsDebugEnabled);
              haptics.trigger('light');
            }

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

      const handleContextMenu = (e: Event) => {
        // If we already triggered the action via the timer, prevent the standard
        // contextmenu event from firing to avoid double-triggering on mobile.
        // We DO NOT stopPropagation here because the GlobalContextMenu needs to
        // receive this event to actually open the menu.
        if (isLongPressTriggered) {
          e.preventDefault();
          isLongPressTriggered = false;
        }
      };

      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchmove', move);
      el.addEventListener('touchend', cancel);
      el.addEventListener('touchcancel', cancel);
      el.addEventListener('contextmenu', handleContextMenu, { capture: true });

      // Cleanup
      el._longPressCleanup = () => {
        el.removeEventListener('touchstart', start);
        el.removeEventListener('touchmove', move);
        el.removeEventListener('touchend', cancel);
        el.removeEventListener('touchcancel', cancel);
        el.removeEventListener('contextmenu', handleContextMenu);
      };
    },
    unmounted(el) {
      if (el._longPressCleanup) el._longPressCleanup();
    }
  });
});
