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
  const lastAdKey='foodapp_ads_last_shown_id';
  let newEntry=true, backgroundAt=0, redirectToCartAfterLogin=false;

  function isAdmin() { return typeof currentUser !== 'undefined' && ['admin','publicidad'].includes(currentUser?.role); }
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
    if ($('adPublicImage').src !== ad.image_data) $('adPublicImage').src = ad.image_data;
    $('adPublicTitle').textContent = ad.title;
    $('adPublicPrice').textContent = Number(ad.price) > 0
      ? 'Pedir por $'+Number(ad.price).toFixed(2)+' →' : 'Promoción sin precio';
    banner.hidden = false;
  }

  async function refreshPublicAdvertisement() {
    if(publicAd && new Date(publicAd.ends_at).getTime()<=Date.now()){
      publicAd=null; $('adPublicBanner').hidden=true;
      if(typeof renderCarousel==='function')renderCarousel();
    }
    if(queryInProgress||!navigator.onLine)return;
    queryInProgress=true;
    try {
      const instant=new Date().toISOString();
      const {data,error}=await supabaseClient.from('foodapp_advertisements')
        .select('id,title,price,starts_at,ends_at,updated_at')
        .lte('starts_at',instant).gt('ends_at',instant)
        .order('starts_at',{ascending:true}).order('id',{ascending:true});
      if(error)throw error;
      const live=data||[];
      if(!live.length){const previouslyShown=!!publicAd;publicAd=null;$('adPublicBanner').hidden=true;if(previouslyShown&&typeof renderCarousel==='function')renderCarousel();return;}
      let selected=live.find(ad=>ad.id===publicAd?.id);
      if(newEntry||!selected){
        const priorIndex=live.findIndex(ad=>ad.id===localStorage.getItem(lastAdKey));
        selected=live[(priorIndex+1)%live.length];
        if(live.length>1&&selected.id===publicAd?.id)
          selected=live[(live.findIndex(ad=>ad.id===selected.id)+1)%live.length];
        newEntry=false;
        localStorage.setItem(lastAdKey,selected.id);
      }
      const changed=publicAd?.id!==selected.id||publicAd.updated_at!==selected.updated_at;
      if(changed){
        const {data:picture,error:pictureError}=await supabaseClient
          .from('foodapp_advertisements').select('image_data').eq('id',selected.id).single();
        if(pictureError)throw pictureError;
        publicAd={...selected,image_data:picture.image_data};
      } else publicAd={...publicAd,...selected};
      showPublicAdvertisement(publicAd);
      if(changed && typeof renderCarousel==='function')renderCarousel();
    } catch(error){console.warn('Publicidad: no se pudo actualizar el banner.',error);}
    finally{queryInProgress=false;}
  }

  async function orderAdvertisement(){
    const ad=publicAd;
    if(!ad)return;
    if(new Date(ad.starts_at).getTime()>Date.now()||new Date(ad.ends_at).getTime()<=Date.now()){
      $('adPublicBanner').hidden=true;
      return toast('Esta promoción ya finalizó.');
    }
    try {
      const instant=new Date().toISOString();
      const {data,error}=await supabaseClient.from('foodapp_advertisements')
        .select('id,title,price').eq('id',ad.id)
        .lte('starts_at',instant).gt('ends_at',instant).maybeSingle();
      if(error)throw error;
      if(!data||!(Number(data.price)>0))
        return toast('Esta promoción no está disponible para pedidos.');
      if(typeof cart==='undefined')throw new Error('El carrito no está disponible.');
      const current=cart.find(item=>item.advertisementId===data.id);
      if(current){
        current.qty++;current.price=Number(data.price);current.name=data.title;
      } else {
        cart.push({id:'ad:'+data.id,advertisementId:data.id,name:data.title,
          image:ad.image_data,price:Number(data.price),qty:1});
      }
      saveState();updateCartBadge();dismiss();
      if(typeof currentUser==='undefined'||!currentUser){
        redirectToCartAfterLogin=true;
        navigate('login');
        loginAsGuest();
        toast('Promoción agregada. Indica tu nombre para continuar al carrito.');
      } else {
        navigate('cart');
        toast('¡Promoción agregada al carrito!');
      }
    } catch(error){
      console.warn('No se pudo agregar la promoción:',error);
      toast('No se pudo agregar la promoción. Intenta de nuevo.');
    }
  }

  async function validateCartAdvertisements(){
    const campaignItems=cart.filter(item=>item.advertisementId);
    if(!campaignItems.length)return true;
    try {
      const instant=new Date().toISOString();
      const ids=[...new Set(campaignItems.map(item=>item.advertisementId))];
      const {data,error}=await supabaseClient.from('foodapp_advertisements')
        .select('id,title,price').in('id',ids)
        .lte('starts_at',instant).gt('ends_at',instant);
      if(error)throw error;
      const active=new Map((data||[]).map(ad=>[ad.id,ad]));
      let removed=false,adjusted=false;
      for(let i=cart.length-1;i>=0;i--){
        const item=cart[i];if(!item.advertisementId)continue;
        const ad=active.get(item.advertisementId);
        if(!ad||!(Number(ad.price)>0)){cart.splice(i,1);removed=true;}
        else if(Number(item.price)!==Number(ad.price)||item.name!==ad.title){
          item.price=Number(ad.price);item.name=ad.title;adjusted=true;
        }
      }
      if(removed||adjusted){
        saveState();updateCartBadge();renderCart();
        toast(removed?'Promoción vencida retirada del carrito. Revisa tu pedido.':
          'El precio de una promoción cambió. Revisa el total antes de confirmar.');
        return false;
      }
      return true;
    }catch(error){
      console.warn('No fue posible verificar la promoción:',error);
      toast('No se pudo verificar la vigencia de la promoción.');
      return false;
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
    $('adsAdPrice').value = '';
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
    $('adsAdPrice').value = item.price == null ? '' : Number(item.price).toFixed(2);
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
    const rawPrice = $('adsAdPrice').value.trim();
    const price = Number(rawPrice);
    const starts_at = enteredDate('adsStartsAt');
    const ends_at = enteredDate('adsEndsAt');
    const file = $('adsImageFile').files?.[0];
    if (!title || title.length > 80) return toast('Escribe un título de hasta 80 caracteres.');
    if (!rawPrice || !Number.isFinite(price) || price <= 0 || price > 100000 || !/^\d+(?:\.\d{1,2})?$/.test(rawPrice))
      return toast('Escribe un precio válido mayor a $0.00 (máximo dos decimales).');
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
        p_starts_at: starts_at, p_ends_at: ends_at, p_price: price
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
      const price = document.createElement('strong');
      price.className = 'ads-item-price';
      price.textContent = ad.price == null ? 'Precio pendiente' : '$' + Number(ad.price).toFixed(2);
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
      info.append(title, price, status, times, actions);
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
    redirectToCartAfterLogin = false;
    const field = $('adsAdminPassword');
    if (field) field.value = '';
  }
  window.FoodAppAds = {
    adminOpened, setAdminPassword, clearPassword, unlock, previewFile,
    clearEditor, save, dismiss, orderAdvertisement, validateCartAdvertisements,
    takeCartRedirect: () => {
      const pending=redirectToCartAfterLogin;
      redirectToCartAfterLogin=false;
      return pending;
    },
    getActiveAdvertisement: () => publicAd && new Date(publicAd.starts_at).getTime() <= Date.now() && new Date(publicAd.ends_at).getTime() > Date.now() ? publicAd : null,
    refresh: refreshPublicAdvertisement
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
      if(typeof renderCarousel==='function')renderCarousel();
    }
  }, 5000);
  setInterval(() => void refreshPublicAdvertisement(), 60000);
  document.addEventListener('visibilitychange', () => {
    if(document.hidden)backgroundAt=Date.now();
    else {
      if(backgroundAt){newEntry=true;dismissedId=null;}
      void refreshPublicAdvertisement();
    }
  });
})();
