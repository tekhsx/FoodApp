/* Publicidad del día: horarios en America/Panama, imagen JPG compacta dentro del registro. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const PANAMA_OFFSET_MS = 5 * 60 * 60 * 1000;
  let administratorPassword = '';
  let advertisements = [];
  let editingId = null;
  let publicAd = null;
  let dismissedId = null;
  let pendingPreviewUrl = null;
  let queryInProgress = false;

  function isAdmin() { return typeof currentUser !== 'undefined' && currentUser?.role === 'admin'; }
  function adminEmail() { return isAdmin() ? currentUser.email : ''; }
  function errorText(message) {
    return message?.message || String(message || 'No se pudo completar la operación.');
  }
  function toast(message) { if (typeof showToast === 'function') showToast(message); }
  function localPanamaValue(iso) {
    const d = new Date(iso);
    return new Date(d.getTime() - PANAMA_OFFSET_MS).toISOString().slice(0,16);
  }
  function defaultDates() {
    const rounded = Math.floor(Date.now() / 60000) * 60000;
    $('adsStartsAt').value = localPanamaValue(new Date(rounded).toISOString());
    $('adsEndsAt').value = localPanamaValue(new Date(rounded + 86400000).toISOString());
  }
  function enteredDate(elementId) {
    const value = $(elementId).value;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
    const date = new Date(value + ':00-05:00');
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  function formatPanama(iso) {
    return new Intl.DateTimeFormat('es-PA', {
      timeZone: 'America/Panama', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(new Date(iso));
  }
  function showPublicAdvertisement(ad) {
    const banner = $('adPublicBanner');
    if (!banner) return;
    if (!ad || dismissedId === ad.id || new Date(ad.ends_at).getTime() <= Date.now()
        || new Date(ad.starts_at).getTime() > Date.now()) {
      banner.hidden = true;
      return;
    }
    $('adPublicImage').src = ad.image_data;
    $('adPublicTitle').textContent = ad.title;
    banner.hidden = false;
  }
  async function refreshPublicAdvertisement() {
    const now = Date.now();
    if (publicAd && now >= new Date(publicAd.ends_at).getTime()) {
      publicAd = null;
      $('adPublicBanner').hidden = true;
    }
    if (queryInProgress || !navigator.onLine) return;
    queryInProgress = true;
    try {
      const instant = new Date().toISOString();
      const { data, error } = await supabaseClient.from('foodapp_advertisements')
        .select('id,title,starts_at,ends_at,updated_at')
        .lte('starts_at', instant).gt('ends_at', instant)
        .order('starts_at', { ascending: false }).limit(1);
      if (error) throw error;
      const latest = data?.[0] || null;
      if (!latest) {
        publicAd = null;
      } else if (publicAd?.id !== latest.id || publicAd.updated_at !== latest.updated_at) {
        const { data: imageRow, error: imageError } = await supabaseClient.from('foodapp_advertisements')
          .select('image_data').eq('id', latest.id).single();
        if (imageError) throw imageError;
        publicAd = Object.assign({}, latest, { image_data: imageRow.image_data });
      } else {
        publicAd = Object.assign({}, publicAd, latest);
      }
      showPublicAdvertisement(publicAd);
    } catch (error) {
      console.warn('Publicidad: no se pudo actualizar el banner.', error);
    } finally {
      queryInProgress = false;
    }
  }
  function dismiss() {
    if (publicAd) dismissedId = publicAd.id;
    $('adPublicBanner').hidden = true;
  }
  function renderUnlock() {
    $('adsAdminUnlock').hidden = Boolean(administratorPassword);
    $('adsAdminContent').hidden = !administratorPassword;
  }
  async function rpc(action, params = {}, passwordOverride = null) {
    if (!isAdmin()) throw new Error('Acceso reservado al administrador.');
    const password = passwordOverride === null ? administratorPassword : passwordOverride;
    if (!password) throw new Error('Confirma tu contraseña para administrar anuncios.');
    const { data, error } = await supabaseClient.rpc('foodapp_advertisements_admin', Object.assign({
      p_email: adminEmail(), p_password: password, p_action: action
    }, params));
    if (error) throw error;
    return data;
  }
  function showManagerError(message) {
    $('adsManagerError').textContent = message || '';
  }
  async function loadManager() {
    if (!administratorPassword || !isAdmin()) return;
    try {
      advertisements = await rpc('list') || [];
      advertisements.sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
      renderList();
      showManagerError('');
    } catch (error) {
      showManagerError(errorText(error));
      advertisements = [];
      renderList();
    }
  }
  async function unlock() {
    const password = $('adsAdminPassword').value;
    if (!password) return toast('Escribe tu contraseña de administrador.');
    const button = $('adsUnlockBtn');
    button.disabled = true;
    try {
      advertisements = await rpc('list', {}, password) || [];
      administratorPassword = password;
      $('adsAdminPassword').value = '';
      renderUnlock();
      renderList();
      showManagerError('');
    } catch (error) {
      toast('Contraseña incorrecta o acceso no autorizado.');
      console.warn('No se pudo autorizar el panel de publicidad:', error);
    } finally {
      button.disabled = false;
    }
  }
  function adminOpened() {
    if (!isAdmin()) return;
    if (!$('adsStartsAt').value) defaultDates();
    renderUnlock();
    if (administratorPassword) void loadManager();
  }
  function revokePreviewUrl() {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    pendingPreviewUrl = null;
  }
  function previewFile() {
    const file = $('adsImageFile').files?.[0];
    revokePreviewUrl();
    if (file) {
      if (!file.type.startsWith('image/')) {
        $('adsImageFile').value = '';
        return toast('Selecciona una imagen JPG, PNG o WebP.');
      }
      pendingPreviewUrl = URL.createObjectURL(file);
      $('adsImagePreview').src = pendingPreviewUrl;
      $('adsImagePreview').hidden = false;
    } else if (editingId) {
      const previous = advertisements.find(ad => ad.id === editingId);
      $('adsImagePreview').src = previous?.image_data || '';
      $('adsImagePreview').hidden = !previous;
    } else {
      $('adsImagePreview').hidden = true;
      $('adsImagePreview').removeAttribute('src');
    }
  }
  function clearEditor() {
    editingId = null;
    $('adsFormTitle').textContent = 'Nueva publicidad';
    $('adsSaveBtn').textContent = 'Programar publicidad';
    $('adsAdTitle').value = '';
    $('adsImageFile').value = '';
    revokePreviewUrl();
    $('adsImagePreview').hidden = true;
    $('adsImagePreview').removeAttribute('src');
    defaultDates();
    showManagerError('');
  }
  function editAdvertisement(id) {
    const item = advertisements.find(a => a.id === id);
    if (!item) return;
    editingId = id;
    $('adsFormTitle').textContent = 'Editar publicidad';
    $('adsSaveBtn').textContent = 'Guardar cambios';
    $('adsAdTitle').value = item.title;
    $('adsStartsAt').value = localPanamaValue(item.starts_at);
    $('adsEndsAt').value = localPanamaValue(item.ends_at);
    $('adsImageFile').value = '';
    revokePreviewUrl();
    $('adsImagePreview').src = item.image_data;
    $('adsImagePreview').hidden = false;
    $('mainContent').scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function compactImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('El archivo debe ser una imagen.');
    if (file.size > 8 * 1024 * 1024) throw new Error('La imagen no debe superar los 8 MB.');
    const objectURL = URL.createObjectURL(file);
    let image;
    try {
      image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
        img.src = objectURL;
      });
      let ratio = Math.min(1, 1200 / image.naturalWidth, 720 / image.naturalHeight);
      const canvas = document.createElement('canvas');
      let output;
      for (let tries = 0; tries < 7; tries++) {
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        output = canvas.toDataURL('image/jpeg', Math.max(.52, .82 - tries * .05));
        if (output.length <= 600000) return output;
        ratio *= .8;
      }
      throw new Error('La imagen es demasiado grande. Elige otra con menos detalle.');
    } finally { URL.revokeObjectURL(objectURL); }
  }
  async function save() {
    if (!administratorPassword || !isAdmin()) return toast('Debes autorizar el panel.');
    const title = $('adsAdTitle').value.trim();
    const starts_at = enteredDate('adsStartsAt');
    const ends_at = enteredDate('adsEndsAt');
    const file = $('adsImageFile').files?.[0];
    if (!title || title.length > 80) return toast('Escribe un título de hasta 80 caracteres.');
    if (!starts_at || !ends_at || new Date(ends_at) <= new Date(starts_at))
      return toast('La fecha final debe ser posterior al inicio.');
    if (new Date(ends_at).getTime() <= Date.now())
      return toast('La publicidad debe terminar en una fecha futura.');
    const previous = advertisements.find(a => a.id === editingId);
    if (!file && !previous?.image_data) return toast('Selecciona una imagen para la publicidad.');
    const button = $('adsSaveBtn');
    button.disabled = true;
    button.textContent = 'Guardando...';
    try {
      const image_data = file ? await compactImage(file) : previous.image_data;
      await rpc('save', {
        p_ad_id: editingId, p_title: title, p_image_data: image_data,
        p_starts_at: starts_at, p_ends_at: ends_at
      });
      toast('Publicidad guardada y programada correctamente.');
      clearEditor();
      await Promise.all([loadManager(), refreshPublicAdvertisement()]);
    } catch (error) {
      showManagerError(errorText(error));
      toast('No se pudo guardar la publicidad.');
    } finally {
      button.disabled = false;
      button.textContent = editingId ? 'Guardar cambios' : 'Programar publicidad';
    }
  }
  async function remove(id) {
    const item = advertisements.find(a => a.id === id);
    if (!item) return;
    if (!await showAppConfirm('¿Eliminar definitivamente la publicidad "' + item.title + '"?', {
      title: 'Eliminar publicidad', confirmText: 'Eliminar', danger: true
    })) return;
    try {
      await rpc('delete', { p_ad_id: id });
      if (editingId === id) clearEditor();
      toast('Publicidad eliminada.');
      await Promise.all([loadManager(), refreshPublicAdvertisement()]);
    } catch (error) { toast('No se pudo eliminar. ' + errorText(error)); }
  }
  function renderList() {
    const list = $('adsCampaignList');
    list.replaceChildren();
    if (!advertisements.length) {
      const placeholder = document.createElement('div');
      placeholder.className = 'ads-admin-card';
      placeholder.textContent = 'No hay publicidades programadas. Crea la primera arriba.';
      list.append(placeholder);
      return;
    }
    for (const ad of advertisements) {
      const card = document.createElement('article');
      card.className = 'ads-admin-card';
      const image = document.createElement('img');
      image.className = 'ads-list-photo';
      image.src = ad.image_data;
      image.alt = ad.title;
      const info = document.createElement('div');
      info.className = 'ads-list-info';
      const title = document.createElement('strong');
      title.textContent = ad.title;
      const status = document.createElement('span');
      const started = new Date(ad.starts_at).getTime() <= Date.now();
      status.className = 'ads-status' + (started ? ' live' : '');
      status.textContent = started ? 'En pantalla' : 'Programada';
      const times = document.createElement('small');
      times.textContent = 'Inicio: ' + formatPanama(ad.starts_at) + ' · Fin: ' + formatPanama(ad.ends_at);
      const actions = document.createElement('div');
      actions.className = 'ads-list-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Editar';
      edit.onclick = () => editAdvertisement(ad.id);
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Eliminar';
      del.onclick = () => void remove(ad.id);
      actions.append(edit, del);
      info.append(title, status, times, actions);
      card.append(image, info);
      list.append(card);
    }
  }
  function setAdminPassword(password) {
    if (isAdmin() && password) administratorPassword = String(password);
  }
  function clearPassword() {
    administratorPassword = '';
    advertisements = [];
    editingId = null;
    const field = $('adsAdminPassword');
    if (field) field.value = '';
  }
  window.FoodAppAds = {
    adminOpened, setAdminPassword, clearPassword, unlock, previewFile,
    clearEditor, save, dismiss, refresh: refreshPublicAdvertisement
  };
  const unlockInput = $('adsAdminPassword');
  if (unlockInput) unlockInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); void unlock(); }
  });
  void refreshPublicAdvertisement();
  // Hide precisely when the end time is reached, even if there is no network.
  setInterval(() => {
    if (publicAd && new Date(publicAd.ends_at).getTime() <= Date.now()) {
      publicAd = null;
      $('adPublicBanner').hidden = true;
    }
  }, 5000);
  setInterval(() => void refreshPublicAdvertisement(), 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshPublicAdvertisement();
  });
})();
