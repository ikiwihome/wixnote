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
  // The opaque editor origin cannot use IndexedDB. WizEditor's diagram plugin
  // uses it for temporary drafts, so provide the small asynchronous subset it needs.
  const stores = new Map();
  const request = (operation) => {
    const result = {};
    setTimeout(() => {
      try {
        result.result = operation();
        result.onsuccess?.({ target: result });
      } catch (error) {
        result.error = error;
        result.onerror?.({ target: result });
      }
    }, 0);
    return result;
  };
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: {
      open(name) {
        return request(() => {
          if (!stores.has(name)) stores.set(name, new Map());
          const values = stores.get(name);
          return {
            createObjectStore() {},
            transaction() {
              return {
                objectStore: () => ({
                  get: (key) => request(() => values.get(key)),
                  put: (item) =>
                    request(() => {
                      values.set(item.key, item);
                      return item.key;
                    }),
                }),
              };
            },
          };
        });
      },
    },
  });
})();
