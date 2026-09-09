/** Register the hosted editor shell once. Returns a synchronous cleanup function.
 * @param {{onStatus?: (status: {supported:boolean, ready:boolean, preparing?:boolean, updateAvailable?:boolean, error?:string, version?:string}) => void}} [options]
 */
export function registerOffline({ onStatus = () => {} } = {}) {
  let disposed = false;
  const cleanups = [];
  const pending = new Set();
  const emit = (status) => { if (!disposed) onStatus(status); };
  const dispose = () => { disposed = true; for (const cleanup of cleanups.splice(0)) cleanup(); for (const cancel of pending) cancel(); pending.clear(); };
  if (process.env.NODE_ENV !== 'production') {
    // Remove only the known unversioned development shell. Never touch artwork
    // IndexedDB, unrelated service workers, or a versioned production cache.
    if ('serviceWorker' in navigator && typeof caches !== 'undefined') void (async () => {
      try {
        const placeholders = (await caches.keys()).filter((key) => key.startsWith('pixelwall-shell-') && key.includes('__PIXELWALL_BUILD_ID__'));
        if (!placeholders.length) return;
        for (const registration of await navigator.serviceWorker.getRegistrations()) {
          const worker = registration.active ?? registration.waiting ?? registration.installing;
          if (worker && new URL(worker.scriptURL).pathname === '/sw.js') await registration.unregister();
        }
        for (const key of placeholders) await caches.delete(key);
      } catch { /* Development cleanup is best effort and never affects artwork. */ }
    })();
    return dispose;
  }
  if (process.env.NEXT_PUBLIC_PIXELWALL_STANDALONE === 'true') return dispose;
  if (!('serviceWorker' in navigator) || !window.isSecureContext || !['https:', 'http:'].includes(location.protocol)) { emit({ supported: false, ready: false }); return dispose; }
  void (async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      if (disposed) return;
      function listen(target, type, callback) { target.addEventListener(type, callback); cleanups.push(() => target.removeEventListener(type, callback)); }
      async function inspect() {
        if (disposed) return;
        const worker = registration.active;
        if (!worker) { emit({ supported: true, ready: false, preparing: true }); return; }
        const channel = new MessageChannel();
        const status = await new Promise((resolve) => {
          let timeout;
          const finish = (value) => { clearTimeout(timeout); channel.port1.close(); channel.port2.close(); pending.delete(cancel); resolve(value); };
          const cancel = () => finish({ ready: false });
          pending.add(cancel);
          timeout = setTimeout(cancel, 4000);
          channel.port1.onmessage = (event) => finish(event.data);
          try { worker.postMessage({ type: 'OFFLINE_STATUS' }, [channel.port2]); } catch { cancel(); }
        });
        emit({ supported: true, ...status, updateAvailable: Boolean(registration.waiting) });
      }
      function observeInstalling() { if (registration.installing) listen(registration.installing, 'statechange', () => { void inspect(); }); }
      listen(registration, 'updatefound', observeInstalling);
      listen(navigator.serviceWorker, 'controllerchange', () => { void inspect(); });
      observeInstalling();
      await inspect();
    } catch (error) { emit({ supported: true, ready: false, error: error.message }); }
  })();
  return dispose;
}
/** Call only after flushing saves and the user chooses Update. */
export function activateSavedUpdate(registration) { registration?.waiting?.postMessage({ type: 'ACTIVATE_SAVED_UPDATE' }); }
