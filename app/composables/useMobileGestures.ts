
import { useWebHaptics } from 'web-haptics/vue';

export const useMobileGestures = () => {
  const store = useMatrixStore();
  const { trigger } = useWebHaptics({
    debug: store.ui.hapticsDebugEnabled
  });

  const touchStart = ref({ x: 0, y: 0 });
  const touchEnd = ref({ x: 0, y: 0 });

  const MIN_SWIPE_DISTANCE = 50;

  const onTouchStart = (e: TouchEvent) => {
    touchStart.value = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY
    };
  };

  const onTouchEnd = (e: TouchEvent, data?: any) => {
    touchEnd.value = {
      x: e.changedTouches[0].clientX,
      y: e.changedTouches[0].clientY
    };

    handleSwipe(data);
  };

  const handleSwipe = (data?: any) => {
    const dx = touchEnd.value.x - touchStart.value.x;
    const dy = touchEnd.value.y - touchStart.value.y;

    // Horizontal swipe
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > MIN_SWIPE_DISTANCE) {
      if (dx > 0) {
        // Swipe Right: Open Sidebar if closed, or close Member List if open
        if (store.ui.memberListVisible) {
          store.toggleMemberList();
          if (store.ui.hapticFeedbackEnabled) trigger('light');
        } else if (!store.ui.sidebarOpen) {
          store.toggleSidebar(true);
          if (store.ui.hapticFeedbackEnabled) trigger('light');
        }
      } else {
        // Swipe Left: Close Sidebar if open, or open Member List if closed
        if (store.ui.sidebarOpen) {
          store.toggleSidebar(false);
          if (store.ui.hapticFeedbackEnabled) trigger('light');
        } else if (!store.ui.memberListVisible) {
          // Swipe to Reply check (Swipe Left on a message)
          if (data?.type === 'message' && data.msg) {
            store.handleReply(data.msg);
            if (store.ui.hapticFeedbackEnabled) trigger('light');
            return;
          }

          // Only open member list via swipe if we are in a chat route
          const route = useRoute();
          const isChatRoute = route.path.startsWith('/chat/dms/') ||
                             route.path.startsWith('/chat/rooms/') ||
                             (route.path.startsWith('/chat/spaces/') && Array.isArray(route.params.id) && route.params.id.length > 1);

          if (isChatRoute) {
            store.toggleMemberList();
            if (store.ui.hapticFeedbackEnabled) trigger('light');
          }
        }
      }
    }
  };

  return {
    onTouchStart,
    onTouchEnd
  };
};
