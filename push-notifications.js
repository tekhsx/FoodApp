/* FoodApp Push: suscripción por dispositivo. La clave privada VAPID NUNCA está aquí. */
(() => {
  'use strict';
  const btn = document.getElementById('pushEnableBtn');
  const dialog = document.getElementById('pushCredentialsDialog');
  const form = document.getElementById('pushCredentialsForm');
  const passwordInput = document.getElementById('pushAuthPassword');
  const cancel = document.getElementById('pushCancelBtn');
  const SUPABASE_FUNCTION = 'https://owzdppnomndgrrpnrvnr.supabase.co/functions/v1/push-register';
  const ANON_KEY = (typeof supabaseKey === 'string' ? supabaseKey : '');
  const supported = 'serviceWorker' in navigator && 'PushManager' in window &&
    'Notification' in window && window.isSecureContext;
  const getIdentity = () => typeof currentUser !== 'undefined' ? currentUser : null;
  const bindingKey = 'foodapp_push_bound_account';
  const dataKey = 'foodapp_push_device';
  let processing = false;

  const safeToast = msg => (typeof showToast === 'function' ? showToast(msg) : alert(msg));
  const accountLabel = identity => identity?.id ? `user:${identity.id}` : 'guest';
  function getDevice() {
    try {
      const stored = JSON.parse(localStorage.getItem(dataKey) || 'null');
      if (stored?.deviceId && stored?.deviceSecret) return stored;
    } catch { /* generar dispositivo */ }
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const record = { deviceId: crypto.randomUUID(),
      deviceSecret: Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('') };
    localStorage.setItem(dataKey, JSON.stringify(record));
    return record;
  }
  function publicKeyToUint8Array(base64) {
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, ch => ch.charCodeAt(0));
  }
  async function request(action, payload = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 13000);
    try {
      const response = await fetch(SUPABASE_FUNCTION, {
        method: 'POST', mode: 'cors', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ action, ...payload }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Error ${response.status}`);
      return result;
    } finally { clearTimeout(timeout); }
  }
  async function swRegistration() {
    // Si el SW ya está instalado, no alterar su ciclo de actualización.
    const reg = (await navigator.serviceWorker.getRegistration('./')) ||
      (await navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' }));
    return reg.active ? reg : navigator.serviceWorker.ready;
  }
  function refreshButton() {
    if (!btn) return;
    const identity = getIdentity();
    btn.hidden = !identity;
    if (!identity) return;
    btn.disabled = !supported || processing;
    const active = supported && Notification.permission === 'granted' &&
      localStorage.getItem(bindingKey) === accountLabel(identity);
    btn.classList.toggle('push-enabled', Boolean(active));
    const label = !supported ? 'Notificaciones no compatibles en este navegador' :
      active ? 'Notificaciones activas. Toca para volver a configurar' :
      'Activar notificaciones de pedidos';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = active ? '<i class="ph-fill ph-bell-ringing" aria-hidden="true"></i>' :
      '<i class="ph ph-bell" aria-hidden="true"></i>';
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const isPushServiceError = error => /push service|registration failed|could not connect|AbortError/i.test(
    String(error?.name || '') + ' ' + String(error?.message || error || ''));
  function explainPushError(error) {
    if (isPushServiceError(error)) {
      return 'Chrome no pudo registrar este dispositivo en su servicio de notificaciones. Comprueba que no estés en modo incógnito, actualiza el navegador y prueba otra conexión (Wi-Fi o datos móviles). Si continúa, prueba Firefox o revisa los servicios de notificaciones del navegador. No es un error de contraseña.';
    }
    if (error?.name === 'NotAllowedError') return 'El navegador tiene bloqueadas las notificaciones para FoodApp. Autorízalas en los permisos del sitio e inténtalo nuevamente.';
    if (error?.name === 'InvalidStateError') return 'La suscripción anterior del navegador no coincide con la configuración actual. Actualiza FoodApp y vuelve a intentarlo.';
    return error?.message || 'No se pudo crear la suscripción. Vuelve a intentarlo.';
  }
  function showPushError(message) {
    const field = document.getElementById('pushRegistrationError');
    if (field) { field.textContent = message || ''; field.hidden = !message; }
  }
  async function getVapidKey() {
    const { vapidPublicKey } = await request('config');
    if (!vapidPublicKey) throw new Error('La clave pública VAPID aún no está disponible en Supabase.');
    const key = publicKeyToUint8Array(vapidPublicKey);
    if (key.length !== 65 || key[0] !== 4) throw new Error('La clave pública VAPID tiene un formato incorrecto.');
    try { await crypto.subtle.importKey('raw', key, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); }
    catch { throw new Error('La clave pública VAPID no es válida; hay que revisarla en Supabase.'); }
    return key;
  }
  async function subscribeBrowser(reg, key) {
    try {
      return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } catch (firstError) {
      if (!isPushServiceError(firstError) || document.hidden) throw firstError;
      // Solo un reintento ante un fallo temporal del servicio push (sin repetir permisos).
      await pause(1500);
      const existing = await reg.pushManager.getSubscription();
      if (existing) return existing;
      try { return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
      catch (secondError) { console.warn('Servicio push rechazó también el segundo intento:', secondError); throw secondError; }
    }
  }
  async function bindSubscription(identity, password, existingOnly = false) {
    if (!supported || Notification.permission !== 'granted') return false;
    const reg = await swRegistration();
    if (!reg.active) throw new Error('El servicio de FoodApp todavía se está instalando. Vuelve a intentarlo.');
    let sub = await reg.pushManager.getSubscription();
    if (!sub && existingOnly) return false;
    // Comprobar la misma clave para evitar mantener una suscripción antigua con VAPID diferente.
    const key = await getVapidKey();
    if (sub && sub.options?.applicationServerKey) {
      const oldKey = new Uint8Array(sub.options.applicationServerKey);
      const sameKey = oldKey.length === key.length && oldKey.every((value, i) => value === key[i]);
      if (!sameKey) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    if (!sub) sub = await subscribeBrowser(reg, key);
    const device = getDevice();
    const registeredUser = Boolean(identity?.id);
    await request('register', {
      ...device, subscription: sub.toJSON(), identity: registeredUser ? 'account' : 'guest',
      ...(registeredUser ? { email: identity.email, password } : {}),
    });
    localStorage.setItem(bindingKey, accountLabel(identity));
    showPushError('');
    refreshButton();
    return true;
  }
  async function enable() {
    if (!supported) return safeToast('Para notificaciones push, abre FoodApp con HTTPS en un navegador compatible.');
    const identity = getIdentity();
    if (!identity) return safeToast('Inicia sesión antes de activar notificaciones.');
    if (processing) return;
    processing = true; refreshButton();
    showPushError('');
    try {
      // La petición de permiso se hace directamente desde el gesto del usuario.
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (permission !== 'granted') return safeToast('Permite las notificaciones en los ajustes del navegador.');
      if (identity.id) {
        passwordInput.value = '';
        dialog.hidden = false;
        passwordInput.focus();
      } else {
        await bindSubscription(identity, undefined);
        safeToast('🔔 Notificaciones del pedido activadas.');
      }
    } catch (err) {
      console.warn('Error al activar Push:', err);
      safeToast(err.message || 'No se pudieron activar las notificaciones.');
    } finally { processing = false; refreshButton(); }
  }
  async function credentialSubmit(event) {
    event.preventDefault();
    if (processing) return;
    const identity = getIdentity();
    const password = passwordInput.value;
    if (!identity?.id || !password) return;
    processing = true;
    refreshButton();
    showPushError('');
    try {
      await bindSubscription(identity, password);
      dialog.hidden = true;
      safeToast('🔔 Recibirás notificaciones de tus pedidos.');
    } catch (err) {
      console.warn('Error registrando notificación:', err);
      showPushError(explainPushError(err));
    } finally { passwordInput.value = ''; processing = false; refreshButton(); }
  }
  async function associateAccount(email, password) {
    // Solo reactivar/traspasar una suscripción YA autorizada; no pedir permiso sin gesto.
    if (!supported || Notification.permission !== 'granted') return;
    const identity = getIdentity();
    if (!identity?.id || identity.email !== email) return;
    try { await bindSubscription(identity, password, true); }
    catch (error) { console.warn('Notificaciones: toca la campana para volver a autorizar.', error); }
  }
  async function associateGuest() {
    if (!supported || Notification.permission !== 'granted') return;
    if (getIdentity()?.id) return;
    try { await bindSubscription(getIdentity(), undefined, true); }
    catch (error) { console.warn('No se pudo asociar el invitado:', error); }
  }
  function guestDeviceId() {
    if (getIdentity()?.id || !supported || Notification.permission !== 'granted' ||
      localStorage.getItem(bindingKey) !== 'guest') return null;
    return getDevice().deviceId;
  }
  async function disconnect() {
    if (!supported) return;
    localStorage.removeItem(bindingKey);
    const device = getDevice();
    try {
      const reg = await navigator.serviceWorker.getRegistration('./');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe(); // Protege incluso si la llamada al servidor falla.
    } catch (error) { console.warn('Push unsubscribe:', error); }
    try { await request('unregister', device); }
    catch (error) { console.warn('No se pudo borrar la suscripción remota:', error); }
    finally {
      localStorage.removeItem(dataKey); // Próximo usuario tendrá otro identificador.
      refreshButton();
    }
  }

  btn?.addEventListener('click', enable);
  form?.addEventListener('submit', credentialSubmit);
  cancel?.addEventListener('click', () => {
    dialog.hidden = true; passwordInput.value = ''; showPushError('');
  });
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type !== 'FOODAPP_PUSH_OPEN') return;
    const desired = event.data.view;
    const identity = getIdentity();
    if (desired === 'admin-orders' && identity?.role === 'admin') navigate(desired);
    if (desired === 'my-orders' && identity) navigate(desired);
  });
  window.FoodAppPush = { refreshButton, enable, associateAccount, associateGuest, guestDeviceId, disconnect };
  window.addEventListener('load', () => {
    refreshButton();
    // Permiso previamente concedido: mantener el vínculo anterior sin pedir contraseña.
    // Al cambiar de cuenta se revalida en cada login con las credenciales reales.
  });
  refreshButton();
})();
