
export function useHaptics() {
  const { $isTauri: isTauri } = useNuxtApp();

  const vibrate = (pattern: number | number[] = 10) => {
    if (import.meta.server) return;

    if (isTauri) {
      if ('vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    } else {
      if ('vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    }
  };

  const light = () => vibrate(10);
  const medium = () => vibrate(20);
  const heavy = () => vibrate(50);
  const success = () => vibrate([10, 30, 10]);
  const error = () => vibrate([50, 50, 50]);

  return {
    vibrate,
    light,
    medium,
    heavy,
    success,
    error
  };
}
