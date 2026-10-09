/* FoodApp: registro del service worker y botón de instalación. */
(() => {
  'use strict';
  let installPrompt = null;
  const button = document.getElementById('pwaInstallBtn');
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIosSafari = /iphone|ipad|ipod/i.test(navigator.userAgent) && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

  function refreshInstallButton() {
    if (!button) return;
    button.hidden = isStandalone() || (!installPrompt && !isIosSafari);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    refreshInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    refreshInstallButton();
  });

  if (button) {
    button.addEventListener('click', async () => {
      if (installPrompt) {
        const prompt = installPrompt;
        installPrompt = null;
        button.hidden = true;
        try {
          await prompt.prompt();
          await prompt.userChoice;
        } catch (error) {
          console.warn('No se pudo abrir el instalador:', error);
        }
        refreshInstallButton();
        return;
      }
      if (isIosSafari) {
        const message = 'Para instalar FoodApp: toca Compartir y luego “Añadir a pantalla de inicio”.';
        if (typeof showToast === 'function') showToast(message);
        else alert(message);
      }
    });
  }

  refreshInstallButton();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js', { scope: './' })
        .catch(err => console.warn('No se pudo registrar el service worker:', err));
    });
  }
})();
