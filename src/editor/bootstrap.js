// WizEditor probes browser persistence during module initialization.
// The editor frame intentionally has no origin, cookies, service worker or durable storage.
(() => {
  Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
  for (const key of ['localStorage', 'sessionStorage']) {
    const values = new Map();
    Object.defineProperty(window, key, {
      configurable: true,
      value: {
        getItem: (key) => values.get(String(key)) ?? null,
        setItem: (key, value) => values.set(String(key), String(value)),
        removeItem: (key) => values.delete(String(key)),
        clear: () => values.clear(),
        key: (index) => [...values.keys()][index] ?? null,
        get length() {
          return values.size;
        },
      },
    });
  }
})();
