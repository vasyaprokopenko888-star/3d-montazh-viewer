(() => {
 const dialog = $('#receiptsDialog');
 const form = $('#receiptForm');
 const preview = $('#receiptPreview');
 const status = $('#receiptStatus');
 const selected = new Set();
 const thumbnailUrls = [];
 let context;
 let database, scope, records = [], pending = null, photoVersion = 0, busy = false;

 // Capture the account and workspace for each operation; never mix sessions.
 function assertContext() {
  if (!context || !cloudSession || cloudConfig.url !== context.url ||
      cloudConfig.workspace !== context.board ||
      (cloudSession.user?.id && cloudSession.user.id !== context.user)) {
   throw Error('Обліковий запис змінився. Відкрий чеки повторно.');
  }
 }
 async function ready() {
  assertContext();
  await cloudRequest('/rest/v1/planning_boards?id=eq.' + encodeURIComponent(context.board) + '&select=id');
  assertContext();
 }
 async function request(path, options = {}, blob = false) {
  assertContext();
  const response = await fetch(context.url + path, {...options, headers:{
   apikey:cloudConfig.key, Authorization:'Bearer ' + cloudSession.access_token,
   'Content-Type':'application/json', ...options.headers
  }});
  assertContext();
  if (!response.ok) {
   const error = Error('Не вдалося виконати запит (' + response.status + '). Перевір інтернет і вхід та спробуй ще раз.');
   error.status = response.status;
   throw error;
  }
  if (response.status === 204) return null;
  return blob ? response.blob() : response.json();
 }
 function query(params) {
  return '/rest/v1/planning_receipts?' + new URLSearchParams(params);
 }
 function identity(record) {
  return {board_id:'eq.' + context.board, created_by:'eq.' + record.creator, id:'eq.' + record.cloudId};
 }
 function objectUrl(path) {
  return '/storage/v1/object/planning-receipts/' + path.split('/').map(encodeURIComponent).join('/');
 }
 async function upload(record) {
  const key = {board_id:'eq.' + context.board, created_by:'eq.' + context.user, id:'eq.' + record.id};
  const existing = await request(query({...key,select:'id'}));
  if (existing.length) return; // Includes tombstones: never resurrect a removed receipt.
  const path = context.board + '/' + context.user + '/' + record.id + '.jpg';
  // An immutable object may remain after a metadata request failed. Verify it before retry.
  try {
   await request(objectUrl(path), {method:'POST',headers:{'Content-Type':'image/jpeg','x-upsert':'false'},body:record.photo});
  } catch (error) {
   if (![400,409].includes(error.status)) throw error;
   const previous = await request(objectUrl(path), {}, true);
   const digest = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(',');
   if (await digest(previous) !== await digest(record.photo)) throw Error('Конфлікт фото. Оригінал залишено на пристрої.');
  }
  try {
   await request(query({}), {method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
    board_id:context.board, created_by:context.user, id:record.id, receipt_date:record.date,
    order_id:record.orderId || '', order_title:record.orderTitle || '', width:record.width,height:record.height
   })});
  } catch (error) {
   if (error.status !== 409 || !(await request(query({...key,select:'id'}))).length) throw error;
  }
 }
 async function loadRecords() {
  await ready();
  const params = {board_id:'eq.' + context.board,deleted_at:'is.null',select:'*',order:'receipt_date.asc,created_by.asc,id.asc',limit:'500'};
  const from = $('#receiptsFrom').value, to = $('#receiptsTo').value;
  if (from) params.receipt_date = 'gte.' + from;
  if (to) params.and = '(receipt_date.lte.' + to + ')';
  const rows = [];
  for (let offset = 0; ; offset += 500) {
   const page = await request(query({...params,offset:String(offset)}));
   rows.push(...page);
   if (page.length < 500) break;
  }
  const next = [];
  for (let offset = 0; offset < rows.length; offset += 4) {
   next.push(...await Promise.all(rows.slice(offset,offset+4).map(async row => ({
    id:row.created_by + '/' + row.id, cloudId:row.id, creator:row.created_by,
    date:row.receipt_date,orderId:row.order_id,orderTitle:row.order_title,
    width:row.width,height:row.height,photo:await request(objectUrl(row.object_path),{},true)
   }))));
  }
  assertContext();
  records = next;
  renderList();
  status.textContent = 'Спільне сховище · чеків за період: ' + records.length;
 }

 function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
   const request = indexedDB.open('masterplan-receipts', 1);
   request.onupgradeneeded = () => {
    request.result.createObjectStore('receipts', {keyPath:'id'}).createIndex('scope', 'scope');
   };
   request.onsuccess = () => resolve(request.result);
   request.onerror = () => reject(request.error);
  }).catch(error => { database = null; throw error; });
  return database;
 }

 async function access(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
   const transaction = db.transaction('receipts', mode);
   const request = operation(transaction.objectStore('receipts'));
   transaction.oncomplete = () => resolve(request.result);
   transaction.onabort = () => reject(transaction.error);
  });
 }

 async function imageToJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
   const image = new Image();
   image.src = url;
   await image.decode();
   const scale = Math.min(1, 2800 / Math.max(image.naturalWidth, image.naturalHeight));
   const canvas = document.createElement('canvas');
   canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
   canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
   const context = canvas.getContext('2d', {alpha:false});
   context.fillStyle = '#fff';
   context.fillRect(0, 0, canvas.width, canvas.height);
   context.drawImage(image, 0, 0, canvas.width, canvas.height);
   const photo = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .91));
   if (!photo) throw Error('Не вдалося підготувати фото.');
   return {photo, width:canvas.width, height:canvas.height};
  } finally { URL.revokeObjectURL(url); }
 }

 function resetPhoto() {
  photoVersion++;
  pending = null;
  if (preview.hasAttribute('src')) URL.revokeObjectURL(preview.src);
  preview.removeAttribute('src');
  preview.hidden = true;
  for (const input of [$('#receiptCamera'), $('#receiptFile')]) input.value = '';
  $('#receiptSave').disabled = true;
 }

 for (const input of [$('#receiptCamera'), $('#receiptFile')]) input.onchange = async () => {
  const file = input.files[0];
  if (!file) return;
  resetPhoto();
  const version = photoVersion;
  status.textContent = 'Готую фото…';
  try {
   const image = await imageToJpeg(file);
   if (version !== photoVersion) return;
   pending = {...image, id:uid()};
   preview.src = URL.createObjectURL(image.photo);
   preview.hidden = false;
   updateButtons();
   status.textContent = 'Перевір, чи весь чек у кадрі й текст читається.';
  } catch {
   if (version === photoVersion) status.textContent = 'Не вдалося відкрити фото. Спробуй JPG або PNG.';
  }
 };

 function visibleRecords() {
  const from = $('#receiptsFrom').value;
  const to = $('#receiptsTo').value;
  return records.filter(record => (!from || record.date >= from) && (!to || record.date <= to));
 }

 function updateButtons() {
  const hasSelection = visibleRecords().some(record => selected.has(record.id));
  $('#receiptDownload').disabled = busy || !hasSelection;
  $('#receiptShare').disabled = busy || !hasSelection;
  $('#receiptSelectAll').disabled = busy || !visibleRecords().length;
  $('#receiptSave').disabled = busy || !pending;
  for (const id of ['receiptRefresh','receiptMigrate','receiptsFrom','receiptsTo','receiptCamera','receiptFile']) $('#'+id).disabled = busy;
 }

 function renderList() {
  thumbnailUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
  const list = $('#receiptList');
  list.replaceChildren();
  const visible = visibleRecords();
  if (!visible.length) list.textContent = 'За цей період чеків немає.';
  for (const record of visible) {
   const row = document.createElement('div');
   row.className = 'row';
   const label = document.createElement('label');
   const checkbox = document.createElement('input');
   checkbox.type = 'checkbox';
   checkbox.style.width = 'auto';
   checkbox.checked = selected.has(record.id);
   checkbox.onchange = () => {
    if (checkbox.checked) selected.add(record.id);
    else selected.delete(record.id);
    updateButtons();
   };
   const title = orders.find(order => order.id === record.orderId)?.title || record.orderTitle || 'Загальні витрати';
   label.append(checkbox, ' ' + record.date + ' · ' + title);
   const link = document.createElement('a');
   link.href = URL.createObjectURL(record.photo);
   thumbnailUrls.push(link.href);
   link.target = '_blank';
   link.rel = 'noopener';
   link.textContent = 'Фото';
   const remove = document.createElement('button');
   remove.textContent = 'Видалити';
   remove.onclick = () => {
    if (!busy && confirm('Прибрати цей чек зі спільного списку для обох учасників?')) run(async () => {
     await ready();
     const removed = await request(query(identity(record)),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({deleted_at:new Date().toISOString()})});
     if (removed.length !== 1) throw Error('Чек не змінено. Онови список.');
     records = records.filter(item => item.id !== record.id);
     selected.delete(record.id);
     renderList();
     status.textContent = 'Чек видалено.';
    });
   };
   row.append(label, link, remove);
   list.append(row);
  }
  updateButtons();
 }

 async function run(action) {
  if (busy) return;
  busy = true;
  updateButtons();
  try { await action(); }
  catch (error) { status.textContent = error.message || 'Не вдалося виконати дію. Спробуй ще раз.'; }
  finally { busy = false; updateButtons(); }
 }

 function openReceipts(takePhoto) {
  if (!cloudSession || cloudRevision === null) return toast('Спочатку увійди й завантаж дані.');
  let userId = cloudSession.user?.id;
  if (!userId) {
   try {
    const payload = cloudSession.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    userId = JSON.parse(atob(payload)).sub;
   } catch {}
  }
  if (!userId) return toast('Увійди повторно, щоб відкрити чеки.');
  context = {url:cloudConfig.url,board:cloudConfig.workspace,user:userId};
  scope = JSON.stringify([context.url, context.board, context.user]);
  form.reset();
  resetPhoto();
  records = [];
  selected.clear();
  const date = localToday();
  $('#receiptDate').value = date;
  $('#receiptsFrom').value = date.slice(0, 7) + '-01';
  $('#receiptsTo').value = '';
  $('#receiptOrder').replaceChildren(new Option('Загальні витрати', ''), ...orders
   .filter(order => order.id !== DAY_NOTES_ID && !order.standalone)
   .map(order => new Option(order.title + (order.archived ? ' · архів' : ''), order.id)));
  status.textContent = '';
  renderList();
  dialog.showModal();
  if (takePhoto) document.getElementById('receiptCamera').click();
  run(loadRecords);
 }
 document.getElementById('receiptsOpen').onclick = () => openReceipts(false);
 document.getElementById('receiptsCameraOpen').onclick = () => openReceipts(true);
 $('#receiptsClose').onclick = () => { if (!busy) dialog.close(); };
 dialog.oncancel = event => { if (busy) event.preventDefault(); };
 dialog.onclose = () => {
  resetPhoto();
  thumbnailUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
  records = [];
  $('#receiptList').replaceChildren();
 };
 form.onsubmit = event => {
  event.preventDefault();
  if (!pending) return;
  run(async () => {
   const orderId = $('#receiptOrder').value;
   const record = {...pending, scope, date:$('#receiptDate').value, orderId,
    orderTitle:orders.find(order => order.id === orderId)?.title || ''};
   await ready();
   await upload(record);
   $('#receiptsFrom').value = record.date.slice(0, 7) + '-01';
   $('#receiptsTo').value = '';
   resetPhoto();
   await loadRecords();
   status.textContent = 'Чек збережено у спільному сховищі.';
  });
 };
 for (const input of [$('#receiptsFrom'), $('#receiptsTo')]) input.onchange = () => run(loadRecords);
 $('#receiptRefresh').onclick = () => run(loadRecords);
 $('#receiptMigrate').onclick = () => run(async () => {
  await ready();
  const local = await access('readonly', store => store.index('scope').getAll(scope));
  if (!local.length) { status.textContent = 'У цьому браузері для цього акаунта старих чеків немає.'; return; }
  if (!confirm('Перенести ' + local.length + ' чеків у спільне сховище? Оригінали залишаться на цьому пристрої.')) return;
  let done = 0;
  for (const record of local) {
   status.textContent = 'Перенесення: ' + done + ' / ' + local.length;
   await upload(record);
   done++;
  }
  await loadRecords();
  status.textContent = 'Перевірено та перенесено: ' + done + '. Оригінали залишено на пристрої. Повторне перенесення не створює дублікатів.';
 });
 $('#receiptSelectAll').onclick = () => {
  visibleRecords().forEach(record => selected.add(record.id));
  renderList();
 };

 // Embed each JPEG on a separate A4 page without a remote PDF library.
 function makePdf(items) {
  const encoder = new TextEncoder();
  const parts = [], offsets = [0];
  let size = 0;
  function append(value) {
   const part = typeof value === 'string' ? encoder.encode(value) : value;
   parts.push(part);
   size += part.size ?? part.byteLength;
  }
  function object(id, ...contents) {
   offsets[id] = size;
   append(id + ' 0 obj\n');
   contents.forEach(append);
   append('\nendobj\n');
  }
  append('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Count ' + items.length + ' /Kids [' +
   items.map((_, index) => (3 + index * 3) + ' 0 R').join(' ') + '] >>');
  items.forEach(({photo,width,height}, index) => {
   const page = 3 + index * 3;
   const scale = Math.min(555 / width, 802 / height);
   const w = width * scale, h = height * scale;
   const drawing = 'q\n' + [w,0,0,h,(595-w)/2,(842-h)/2].map(n => n.toFixed(3)).join(' ') + ' cm\n/Receipt Do\nQ\n';
   object(page, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Receipt ' +
    (page+1) + ' 0 R >> >> /Contents ' + (page+2) + ' 0 R >>');
   object(page+1, '<< /Type /XObject /Subtype /Image /Width ' + width + ' /Height ' + height +
    ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + photo.size + ' >>\nstream\n', photo, '\nendstream');
   object(page+2, '<< /Length ' + drawing.length + ' >>\nstream\n', drawing, 'endstream');
  });
  const xref = size;
  append('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n' +
   offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') +
   'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new File(parts, 'MasterPlan-cheky-' + items[0].date + '_' + items.at(-1).date + '.pdf', {type:'application/pdf'});
 }

 function download(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
 }

 function exportPdf(share) {
  if (busy) return;
  const items = visibleRecords().filter(record => selected.has(record.id));
  if (!items.length) return;
  let file;
  try { file = makePdf(items); }
  catch { status.textContent = 'Не вдалося зібрати PDF. Спробуй вибрати менше чеків.'; return; }
  if (share && navigator.canShare?.({files:[file]})) {
   navigator.share({files:[file]}).catch(error => {
    if (error.name !== 'AbortError') status.textContent = 'Завантаж PDF і прикріпи його до листа.';
   });
   return;
  }
  download(file);
  status.textContent = share ? 'PDF завантажується. Прикріпи його до листа бухгалтеру.' : 'PDF завантажується.';
 }
 $('#receiptDownload').onclick = () => exportPdf(false);
 $('#receiptShare').onclick = () => exportPdf(true);
})();
