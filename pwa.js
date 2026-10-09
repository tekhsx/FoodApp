/* tu\'dale PWA: instalación y aviso de nuevas versiones. */
(() => {
  'use strict';
  const VERSION = document.querySelector('meta[name="foodapp-version"]')?.content || 'sin-version';
  const installButton = document.getElementById('pwaInstallBtn');
  const updateNotice = document.getElementById('pwaUpdateNotice');
  const updateButton = document.getElementById('pwaUpdateNow');
  const laterButton = document.getElementById('pwaUpdateLater');
  const updateMessage = document.getElementById('pwaUpdateMessage');
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIosSafari = /iphone|ipad|ipod/i.test(navigator.userAgent) && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
  const supportsSW = 'serviceWorker' in navigator && location.protocol !== 'file:';
  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const CHECK_MIN_GAP_MS = 30 * 1000;
  let installPrompt = null;
  let registration = null;
  let latestVersion = '';
  let updateReady = false;
  let pendingUserUpdate = false;
  let lastCheck = 0;
  let dismissedVersion = '';
  let checking = false;
  let previouslyControlled = Boolean(navigator.serviceWorker?.controller);

  function refreshInstallButton() {
    if (installButton) installButton.hidden = isStandalone() || (!installPrompt && !isIosSafari);
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    refreshInstallButton();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    refreshInstallButton();
  });
  installButton?.addEventListener('click', async () => {
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      installButton.hidden = true;
      try { await prompt.prompt(); await prompt.userChoice; }
      catch (error) { console.warn('No se pudo abrir el instalador:', error); }
      refreshInstallButton();
    } else if (isIosSafari) {
      const message = 'Para instalar tu\'dale: toca Compartir y luego “Añadir a pantalla de inicio”.';
      if (typeof showToast === 'function') showToast(message);
      else {
        const toast=document.getElementById('toast');
        if(toast){toast.textContent=message;toast.style.display='block';setTimeout(()=>toast.style.display='none',3500);}
      }
    }
  });
  refreshInstallButton();

  function showUpdateNotification() {
    if (!updateNotice || !updateReady || pendingUserUpdate) return;
    // No interrumpir la pantalla TV mientras está en Fullscreen.
    updateNotice.hidden = Boolean(document.fullscreenElement) || latestVersion === dismissedVersion;
    if (updateMessage && !updateNotice.hidden) {
      updateMessage.textContent = 'Hay una actualización lista para instalar. Tus pedidos y tu carrito se conservarán.';
    }
  }
  function markUpdateReady(version) {
    if (version && version !== VERSION) latestVersion = version;
    else if (!latestVersion) latestVersion = 'nueva-version';
    updateReady = true;
    showUpdateNotification();
  }
  function handleWaitingWorker() {
    if (registration?.waiting && navigator.serviceWorker.controller) {
      markUpdateReady();
    }
  }

  // Un archivo de versión se consulta SIN caché; detecta despliegues aunque
  // solo se haya modificado index.html y el SW aún no haya cambiado.
  async function checkPublishedVersion() {
    try {
      const url = new URL('./version.json', document.baseURI);
      const response = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      if (!response.ok) return;
      const data = await response.json();
      if (typeof data.version === 'string' && data.version !== VERSION) markUpdateReady(data.version);
    } catch (error) {
      // En modo sin conexión no molestamos al usuario.
    }
  }

  async function checkForUpdates(force = false) {
    if (checking || (!force && Date.now() - lastCheck < CHECK_MIN_GAP_MS)) return;
    checking = true;
    lastCheck = Date.now();
    try {
      if (supportsSW) {
        if (!registration) registration = await navigator.serviceWorker.getRegistration('./');
        if (registration) {
          // Comprueba una versión nueva del service worker aunque no se recargue la PWA.
          await registration.update();
          handleWaitingWorker();
        }
      }
      await checkPublishedVersion();
    } catch (error) {
      console.debug('Revisión de tu\'dale pendiente de conexión:', error);
    } finally {
      checking = false;
    }
  }

  laterButton?.addEventListener('click', () => {
    dismissedVersion = latestVersion;
    updateNotice.hidden = true;
  });

  function reloadForUpdate() {
    // Network-first en navegaciones y pwa.js evita reutilizar una app obsoleta.
    location.reload();
  }

  updateButton?.addEventListener('click', async () => {
    if (pendingUserUpdate) return;
    pendingUserUpdate = true;
    updateButton.disabled = true;
    updateButton.textContent = 'Actualizando…';
    try {
      if (supportsSW) {
        registration = registration || await navigator.serviceWorker.getRegistration('./');
        if (registration) {
          await registration.update();
          if (registration.waiting) {
            // La nueva versión toma el control SOLO después de que el usuario lo aprueba.
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            // Si hay un retraso en controllerchange, asegurar que se aplique la recarga.
            setTimeout(reloadForUpdate, 4500);
            return;
          }
        }
      }
      reloadForUpdate();
    } catch (error) {
      pendingUserUpdate = false;
      updateButton.disabled = false;
      updateButton.textContent = 'Reintentar actualización';
      if (updateMessage) updateMessage.textContent = 'No se pudo actualizar. Comprueba la conexión y vuelve a intentarlo.';
      console.warn('Error al actualizar tu\'dale:', error);
    }
  });

  document.addEventListener('fullscreenchange', showUpdateNotification);
  if (supportsSW) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const wasControlled = previouslyControlled;
      previouslyControlled = true;
      if (pendingUserUpdate) reloadForUpdate();
      else if (wasControlled) markUpdateReady(); // Otra pestaña pudo activar la actualización.
      // En la primera instalación NO hay una versión nueva que anunciar.
    });
    window.addEventListener('load', async () => {
      try {
        registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' });
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed') handleWaitingWorker();
          });
        });
        handleWaitingWorker();
      } catch (error) { console.warn('No se pudo registrar el service worker:', error); }
      await checkForUpdates(true);
    });
  } else {
    window.addEventListener('load', () => checkForUpdates(true));
  }
  window.addEventListener('online', () => checkForUpdates(true));
  window.addEventListener('focus', () => checkForUpdates());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdates();
  });
  setInterval(checkForUpdates, CHECK_INTERVAL_MS);
})();
