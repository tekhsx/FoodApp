/* FoodApp Web Push: permiso voluntario y sesión de suscripción, nunca contraseñas guardadas. */
(() => {
  'use strict';
  const btn = document.getElementById('pushEnableBtn');
  const dialog = document.getElementById('pushCredentialsDialog');
  const form = document.getElementById('pushCredentialsForm');
  const cancel = document.getElementById('pushCancelBtn');
  const SUPABASE_FUNCTION = 'https://owzdppnomndgrrpnrvnr.supabase.co/functions/v1/push-register';
  const ANON_KEY = typeof supabaseKey === 'string' ? supabaseKey : '';
  const supported = 'serviceWorker' in navigator && 'PushManager' in window &&
    'Notification' in window && window.isSecureContext;
  const getIdentity = () => typeof currentUser !== 'undefined' ? currentUser : null;
  const bindingKey = 'foodapp_push_bound_account';
  const deviceKey = 'foodapp_push_device';
  const sessionKey = 'foodapp_push_account_session';
  const declinedKey = identity => 'foodapp_push_declined_' + (identity?.id || 'guest');
  const accountLabel = identity => identity?.id ? 'user:' + identity.id : 'guest';
  const safeToast = message => {
    if(typeof showToast === 'function')return showToast(message);
    const toast=document.getElementById('toast');
    if(toast){toast.textContent=message;toast.style.display='block';setTimeout(()=>toast.style.display='none',3500);}
  };
  let processing = false;
  let createdDeviceOnThisLoad = false;

  function getDevice() {
    try {
      const stored = JSON.parse(localStorage.getItem(deviceKey) || 'null');
      if (/^[a-f0-9-]{36}$/i.test(stored?.deviceId || '') && /^[a-f0-9]{64}$/i.test(stored?.deviceSecret || '')) return stored;
    } catch {}
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const record = {
      deviceId: crypto.randomUUID(),
      deviceSecret: Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('')
    };
    localStorage.setItem(deviceKey, JSON.stringify(record));
    createdDeviceOnThisLoad = true;
    return record;
  }
  function storedSession(identity) {
    if (!identity?.id) return null;
    try {
      const s = JSON.parse(localStorage.getItem(sessionKey) || 'null');
      if (s?.userId === identity.id && /^[a-f0-9]{64}$/.test(s.sessionToken || '') &&
          Date.parse(s.expiresAt) > Date.now() + 30 * 1000) return s;
    } catch {}
    return null;
  }
  function base64Key(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, character => character.charCodeAt(0));
  }
  async function request(action, payload = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 13000);
    try {
      const response = await fetch(SUPABASE_FUNCTION, {
        method: 'POST', mode: 'cors', cache: 'no-store', signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json', apikey: ANON_KEY,
          Authorization: 'Bearer ' + ANON_KEY
        },
        body: JSON.stringify({action, ...payload})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Error ' + response.status);
      return data;
    } finally { clearTimeout(timer); }
  }
  async function swRegistration() {
    const reg = (await navigator.serviceWorker.getRegistration('./')) ||
      (await navigator.serviceWorker.register('./service-worker.js', {
        scope: './', updateViaCache: 'none'
      }));
    return reg.active ? reg : navigator.serviceWorker.ready;
  }
  function showError(message) {
    const box = document.getElementById('pushRegistrationError');
    if (!box) return;
    box.textContent = message || '';
    box.hidden = !message;
  }
  function explainPushError(error) {
    const message = String(error?.message || error || '');
    if (/push service|registration failed|could not connect|AbortError/i.test(
      String(error?.name || '') + ' ' + message))
      return 'El navegador no pudo conectarse al servicio de notificaciones. Prueba otra conexión, actualiza el navegador o utiliza Edge/Firefox.';
    if (error?.name === 'NotAllowedError')
      return 'Las notificaciones están bloqueadas. Permítelas en la configuración del sitio y vuelve a intentarlo.';
    return message || 'No se pudieron activar las notificaciones. Inténtalo nuevamente.';
  }
  function refreshButton() {
    if (!btn) return;
    const identity = getIdentity();
    btn.hidden = !identity;
    if (!identity) return;
    btn.disabled = !supported || processing;
    const active = supported && Notification.permission === 'granted' &&
      localStorage.getItem(bindingKey) === accountLabel(identity);
    btn.classList.toggle('push-enabled', !!active);
    const label = !supported ? 'Notificaciones no compatibles con este navegador' :
      active ? 'Notificaciones activas. Toca para volver a configurarlas' :
      'Activar notificaciones de pedidos';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = active ?
      '<i class="ph-fill ph-bell-ringing" aria-hidden="true"></i>' :
      '<i class="ph ph-bell" aria-hidden="true"></i>';
  }
  function offerNotifications(auto = false) {
    if (!supported || !getIdentity() || processing || Notification.permission === 'denied') return;
    const identity = getIdentity();
    if (identity.id && !storedSession(identity)) return;
    if (auto && localStorage.getItem(declinedKey(identity)) === 'yes') return;
    if (Notification.permission === 'granted' &&
        localStorage.getItem(bindingKey) === accountLabel(identity)) return;
    if (dialog) { showError(''); dialog.hidden = false; }
  }
  async function getVapidKey() {
    const response = await request('config');
    if (!response.vapidPublicKey) throw new Error('El servidor push no tiene clave pública disponible.');
    const key = base64Key(response.vapidPublicKey);
    if (key.length !== 65 || key[0] !== 4)
      throw new Error('La clave pública del servidor no tiene un formato correcto.');
    return key;
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function subscribeBrowser(reg, key) {
    try {
      return await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:key});
    } catch (firstError) {
      if (!/push service|registration failed|AbortError/i.test(String(firstError?.name) + ' ' + String(firstError?.message)) ||
          document.hidden) throw firstError;
      await pause(1500);
      const existing = await reg.pushManager.getSubscription();
      if (existing) return existing;
      return await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:key});
    }
  }
  async function bindSubscription(identity, existingOnly = false) {
    if (!supported || Notification.permission !== 'granted') return false;
    const session = identity?.id ? storedSession(identity) : null;
    if (identity?.id && !session) throw new Error('Vuelve a iniciar sesión en FoodApp para autorizar las notificaciones una sola vez.');
    const reg = await swRegistration();
    if (!reg.active) throw new Error('El servicio de tu\'dale se está instalando. Prueba en unos segundos.');
    let sub = await reg.pushManager.getSubscription();
    if (!sub && existingOnly) return false;
    const key = await getVapidKey();
    // Si la app perdió su ID local pero el navegador conservó PushManager,
    // liberar el endpoint anterior antes de registrar una instalación nueva.
    let device = getDevice();
    if (sub && createdDeviceOnThisLoad) {
      if (!await sub.unsubscribe()) throw new Error('No se pudo renovar una suscripción anterior.');
      sub = null;
    }
    if (sub?.options?.applicationServerKey) {
      const previous = new Uint8Array(sub.options.applicationServerKey);
      if (previous.length !== key.length || !previous.every((n, i) => n === key[i])) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    if (!sub) sub = await subscribeBrowser(reg, key);
    const register = (d, subscription) => request('register', {
      ...d, identity: identity?.id ? 'account' : 'guest',
      ...(identity?.id ? {sessionToken: session.sessionToken} : {}),
      subscription: subscription.toJSON()
    });
    try {
      await register(device, sub);
    } catch (error) {
      // Copias de datos del navegador pueden compartir un identificador antiguo.
      // Recuperar una sola vez; nunca vincular por el nombre del cliente.
      if (!/Dispositivo no autorizado|identificador del dispositivo ya pertenece/i.test(
        String(error?.message || ''))) throw error;
      await sub.unsubscribe();
      localStorage.removeItem(deviceKey);
      device = getDevice();
      sub = await subscribeBrowser(reg, key);
      await register(device, sub);
    }
    createdDeviceOnThisLoad = false;
    localStorage.setItem(bindingKey, accountLabel(identity));
    localStorage.removeItem(declinedKey(identity));
    showError('');
    refreshButton();
    return true;
  }
  function enable() {
    const identity = getIdentity();
    if (!supported) return safeToast('Este navegador no es compatible con las notificaciones push.');
    if (!identity) return safeToast('Inicia sesión para activar las notificaciones.');
    if (identity.id && !storedSession(identity))
      return safeToast('Para activar la campana, cierra sesión y vuelve a entrar una vez. No volveremos a pedir tu contraseña para notificaciones.');
    localStorage.removeItem(declinedKey(identity));
    offerNotifications();
  }
  async function confirmActivation(event) {
    event.preventDefault();
    if (processing) return;
    const identity = getIdentity();
    if (!identity) return;
    processing = true;
    refreshButton();
    showError('');
    try {
      // El permiso debe solicitarse desde el toque real en "Activar", nunca automáticamente.
      const permission = Notification.permission === 'default' ?
        await Notification.requestPermission() : Notification.permission;
      if (permission !== 'granted') throw new Error(
        'No se concedió el permiso. Puedes cambiarlo en los ajustes de notificaciones del navegador.');
      await bindSubscription(identity);
      if (dialog) dialog.hidden = true;
      safeToast('🔔 Notificaciones de pedidos activadas.');
    } catch (error) {
      console.warn('No se pudo activar Web Push:', error);
      showError(explainPushError(error));
    } finally { processing = false; refreshButton(); }
  }
  async function associateAccount(email, password) {
    const identity = getIdentity();
    if (!identity?.id || identity.email !== email) return;
    try {
      // La contraseña solo viaja durante el inicio de sesión; jamás se guarda ni se rellena oculta.
      const result = await request('auth', {email, password});
      if (String(result.userId) !== String(identity.id) ||
          !result.sessionToken || !result.expiresAt) throw new Error('Identidad de sesión inválida');
      localStorage.setItem(sessionKey, JSON.stringify({
        userId: identity.id, sessionToken: result.sessionToken, expiresAt: result.expiresAt
      }));
      if (Notification.permission === 'granted') {
        try { await bindSubscription(identity, true); } catch (error) {
          console.warn('No se pudo actualizar la suscripción anterior:', error);
        }
      }
      offerNotifications(true);
    } catch (error) {
      console.warn('No se pudo crear sesión de notificaciones:', error);
    } finally { refreshButton(); }
  }
  async function associateGuest() {
    const identity = getIdentity();
    if (!identity || identity.id) return;
    if (supported && Notification.permission === 'granted') {
      try { await bindSubscription(identity, true); }
      catch (error) { console.warn('No se pudo asociar el dispositivo invitado:', error); }
    }
    offerNotifications(true);
  }
  function guestDeviceId() {
    if (!getIdentity() || getIdentity().id) return null;
    return getDevice().deviceId;
  }
  async function disconnect() {
    const activeSession = storedSession(getIdentity());
    localStorage.removeItem(sessionKey);
    localStorage.removeItem(bindingKey);
    if (activeSession?.sessionToken) {
      try { await request('logout', {sessionToken: activeSession.sessionToken}); }
      catch (error) { console.warn('No se pudo revocar la sesión push:', error); }
    }
    if (!supported) return;
    const device = getDevice();
    try {
      const reg = await navigator.serviceWorker.getRegistration('./');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch (error) { console.warn('Error al quitar suscripción local:', error); }
    try { await request('unregister', device); }
    catch (error) { console.warn('Error al quitar suscripción remota:', error); }
    finally {
      // Este UUID pertenece a la instalación, no al nombre escrito.
      // Conservarlo permite seguir identificando sus pedidos tras volver a entrar.
      refreshButton();
    }
  }
  btn?.addEventListener('click', enable);
  form?.addEventListener('submit', confirmActivation);
  cancel?.addEventListener('click', () => {
    if (dialog) dialog.hidden = true;
    const identity = getIdentity();
    if (identity) localStorage.setItem(declinedKey(identity), 'yes');
    showError('');
  });
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type !== 'FOODAPP_PUSH_OPEN') return;
    const identity = getIdentity();
    if (event.data.view === 'admin-orders' && identity?.role === 'admin') navigate('admin-orders');
    if (event.data.view === 'my-orders' && identity) navigate('my-orders');
  });
  window.FoodAppPush = {refreshButton, enable, associateAccount, associateGuest, guestDeviceId, disconnect};
  window.addEventListener('load', () => { refreshButton(); offerNotifications(true); });
  refreshButton();
})();
