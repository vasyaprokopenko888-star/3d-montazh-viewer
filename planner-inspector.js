'use strict';
// MASTERPLAN-ORDER-INSPECTOR-04. Reads saved costs only; never writes orders.
const orderInspectorState={query:'',scope:'all',searched:false,batch:'',batchSearched:false,ocrStatus:'',ocrJob:null,preview:''};
function inspectorNumber(value){
 const text=String(value??'').normalize('NFKC').trim();
 const match=text.match(/^(?:[\p{L}]+\s*[-–—]?\s*)?(\d+)$/u);
 return match?match[1]:'';
}
function inspectOrderNumbers(data,query,scope='all'){
 const number=inspectorNumber(query);
 if(!number)return [];
 const hits=[];
 for(const order of data){
  if(!order||order.standalone||order.id==='meisterplan-day-notes')continue;
  const archived=Boolean(order.archived);
  if(scope==='current'&&archived||scope==='archive'&&!archived)continue;
  for(const [rowIndex,row] of (order.costs?.rows||[]).entries()){
   if(!row)continue;
   // Compare complete digit sequences: 141946 never matches 1141946 or 1419460.
   if(!(String(row.number??'').match(/\d+/g)||[]).includes(number))continue;
   const group=String(order.groupName??'').trim(),title=String(order.title??'').trim();
   const label=order.isGroup?(group||title):(group&&group!==title?group+' · '+title:title);
   const amount=String(row.amount??'').trim();
   hits.push({orderId:order.id,rowIndex,number:String(row.number),order:label,
    material:[row.name,row.detail].map(v=>String(v??'').trim()).filter(Boolean).join(' · ')||'Матеріал не вказано',
    amount:amount!==''&&Number.isFinite(Number(amount))?Number(amount):null,
    currency:row.currency||order.costs.currency||'',archived,common:Boolean(order.isGroup)});
  }
 }
 return hits.sort((a,b)=>Number(a.archived)-Number(b.archived)||a.order.localeCompare(b.order,'uk')||a.rowIndex-b.rowIndex);
}
function renderOrderInspector(){
 const state=orderInspectorState;
 $('#content').innerHTML='<section class="inspector-panel"><h2>Інспектор замовлень</h2><p class="muted">Пошук у матеріалах і витратах замовлень.</p><form id="inspectorForm"><div class="inspector-controls"><label>Номер замовлення<input id="inspectorNumber" type="text" inputmode="numeric" maxlength="120" placeholder="Наприклад: 141946" autocomplete="off" spellcheck="false"></label><label>Де шукати<select id="inspectorScope"><option value="all">Усі: поточні та архів</option><option value="current">Поточні замовлення</option><option value="archive">Лише архів</option></select></label><button class="primary" type="submit">Перевірити</button></div><small>Без префікса mkf- · Повний номер</small></form><p id="inspectorSummary" role="status" aria-live="polite"></p><div id="inspectorResults" class="grid"></div><p class="hint">Пошук у збережених даних · Останні зміни: «Оновити дані».</p></section>';
 $('#inspectorNumber').value=state.query;$('#inspectorScope').value=state.scope;
 function search(){
  const summary=$('#inspectorSummary'),results=$('#inspectorResults');results.replaceChildren();
  if(!state.searched){summary.textContent='Введіть номер замовлення та натисніть «Перевірити».';return;}
  const number=inspectorNumber(state.query);
  if(!number){summary.textContent='Введіть повний номер цифрами, наприклад 141946 або mkf-141946.';return;}
  if(cloudRevision===null){summary.textContent='Дані ще не завантажено. Увійдіть і натисніть «Оновити дані».';return;}
  const hits=inspectOrderNumbers(orders,state.query,state.scope);
  const area={all:'у поточних замовленнях та архіві',current:'у поточних замовленнях',archive:'в архіві'}[state.scope];
  summary.textContent=hits.length?'Номер '+number+' знайдено '+area+'. Збігів: '+hits.length+'.':'Номер '+number+' не знайдено '+area+'.';
  results.innerHTML=hits.map(hit=>'<article class="card inspector-result"><span class="tag">'+(hit.archived?'Архів':'Поточне замовлення')+(hit.common?' · Спільна витрата':'')+'</span><h3>'+esc(hit.number)+'</h3><p><b>Замовлення:</b> '+esc(hit.order)+'</p><p><b>Матеріал / витрата:</b> '+esc(hit.material)+'</p><p><b>Сума:</b> '+(hit.amount===null?'Не вказана':esc(money(hit.amount,hit.currency)))+'</p></article>').join('');
 }
 $('#inspectorNumber').oninput=e=>{state.query=e.target.value;state.searched=false;search();};
 $('#inspectorScope').onchange=e=>{state.scope=e.target.value;search();renderInspectorBatch();};
 $('#inspectorForm').onsubmit=e=>{e.preventDefault();state.query=$('#inspectorNumber').value;state.searched=true;search();};
 search();
 mountInspectorScreenshot();
}

function extractInspectorNumbers(raw){
 const unique=new Set();
 for(const line of String(raw??'').normalize('NFKC').split(/\r?\n/)){
  const prefixed=[...line.matchAll(/(?:^|[^\p{L}\d])(?:mkf|мкф|mkт|mкf)[\t :№–—-]*(\d(?:[\t ]*\d){3,11})(?!\d)/giu)];
  if(prefixed.length){for(const m of prefixed)unique.add(m[1].replace(/\s/g,''));continue;}
  // Bare numeric lists are accepted; dates, amounts and unrelated prose are not.
  for(const entry of line.split(/[,;]+/)){
   const match=entry.trim().match(/^[№#\s]*(\d{4,12})[.\s]*$/u);
   if(match)unique.add(match[1]);
  }
 }
 return [...unique];
}
function inspectorBatchEntries(raw){
 const numbers=[],invalid=[];
 for(const entry of String(raw??'').split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean)){
  const number=inspectorNumber(entry);
  if(!number)invalid.push(entry);else if(!numbers.includes(number))numbers.push(number);
 }
 return {numbers,invalid};
}
function inspectorOcrNote(text){
 orderInspectorState.ocrStatus=text;
 if(view==='inspector'&&$('#inspectorOcrStatus'))$('#inspectorOcrStatus').textContent=text;
}
let inspectorOcrLibraryPromise=null;
function loadInspectorOcr(){
 if(window.Tesseract?.createWorker)return Promise.resolve(window.Tesseract);
 if(!inspectorOcrLibraryPromise)inspectorOcrLibraryPromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');let finished=false;
  const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);if(error){script.remove();reject(error);}else resolve(window.Tesseract);};
  const timer=setTimeout(()=>finish(Error('Час завантаження розпізнавача вичерпано. Перевірте інтернет і повторіть.')),30000);
  script.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
  script.crossOrigin='anonymous';script.onload=()=>finish(window.Tesseract?.createWorker?null:Error('Розпізнавач не завантажився.'));script.onerror=()=>finish(Error('Не вдалося завантажити розпізнавач. Перевірте інтернет.'));
  document.head.append(script);
 }).catch(error=>{inspectorOcrLibraryPromise=null;throw error;});
 return inspectorOcrLibraryPromise;
}
function inspectorOcrControls(){
 if(view!=='inspector'||!$('#inspectorImageFile'))return;
 const busy=Boolean(orderInspectorState.ocrJob);
 $('#inspectorImageFile').disabled=busy;$('#inspectorPickImage').disabled=busy;$('#inspectorCancelOcr').hidden=!busy;
}
async function prepareInspectorImage(file){
 if(!/^image\/(png|jpeg|webp|bmp)$/i.test(file.type))throw Error('Оберіть зображення PNG, JPG, WebP або BMP.');
 if(file.size>12*1024*1024)throw Error('Зображення завелике. Оберіть скріншот до 12 МБ.');
 const url=URL.createObjectURL(file),image=new Image();
 try{
  image.src=url;await image.decode();
  const width=image.naturalWidth,height=image.naturalHeight;
  if(!width||!height||width*height>24000000)throw Error('Оберіть менше зображення або обріжте ділянку з номерами.');
  const scale=Math.min(3,1800/width,8000/height,Math.sqrt(8000000/(width*height)));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  return canvas;
 }finally{URL.revokeObjectURL(url);}
}
async function readInspectorScreenshot(file){
 const state=orderInspectorState;if(state.ocrJob){inspectorOcrNote('Спочатку дочекайтеся завершення або скасуйте розпізнавання.');return;}
 const job={worker:null,cancelled:false};state.ocrJob=job;inspectorOcrControls();
 const active=()=>state.ocrJob===job&&!job.cancelled;
 let timeout;
 try{
  inspectorOcrNote('Готую зображення…');const canvas=await prepareInspectorImage(file);if(!active())return;
  state.preview=canvas.toDataURL('image/png');if(view==='inspector'&&$('#inspectorPreview')){$('#inspectorPreview').src=state.preview;$('#inspectorPreview').hidden=false;}
  inspectorOcrNote('Завантажую розпізнавач. Перший запуск може тривати довше…');
  const library=await loadInspectorOcr();if(!active())return;
  // All recognition stays in the browser. Only program/model assets are downloaded.
  timeout=setTimeout(()=>{if(active())cancelInspectorOcr('Розпізнавання триває надто довго. Спробуйте обрізати скріншот і повторити.');},120000);
  job.worker=await library.createWorker('eng',1,{
   workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
   corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
   langPath:'https://tessdata.projectnaptha.com/4.0.0',
   errorHandler:()=>{},
   logger:message=>{if(active()&&message.status==='recognizing text')inspectorOcrNote('Зчитую номери… '+Math.round((message.progress||0)*100)+'%');}
  });
  if(!active())return;
  await job.worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1',user_defined_dpi:'300'});
  const result=await job.worker.recognize(canvas);if(!active())return;
  const numbers=extractInspectorNumbers(result.data.text);
  if(!numbers.length){inspectorOcrNote('Номерів не розпізнано. Обріжте скріншот до списку номерів або введіть їх вручну. Попередній список збережено.');return;}
  const previous=inspectorBatchEntries(state.batch),merged=[...new Set([...previous.numbers,...numbers])];
  state.batch=merged.concat(previous.invalid).join('\n');state.batchSearched=false;
  if(view==='inspector'&&$('#inspectorBatchNumbers')){$('#inspectorBatchNumbers').value=state.batch;renderInspectorBatch();}
  inspectorOcrNote('Зчитано номерів: '+numbers.length+'. Додано нових: '+(merged.length-previous.numbers.length)+'. Перевірте кожну цифру, потім натисніть «Перевірити всі».');
 }catch(error){if(active())inspectorOcrNote('Не вдалося зчитати зображення. '+(error.message||'Спробуйте інший скріншот.'));}
 finally{clearTimeout(timeout);if(job.worker)await job.worker.terminate().catch(()=>{});if(state.ocrJob===job)state.ocrJob=null;inspectorOcrControls();}
}
function cancelInspectorOcr(message='Розпізнавання скасовано. Список номерів збережено.'){
 const state=orderInspectorState,job=state.ocrJob;if(!job)return;
 job.cancelled=true;state.ocrJob=null;if(job.worker)job.worker.terminate().catch(()=>{});
 inspectorOcrNote(message);inspectorOcrControls();
}
function inspectorBatchVerdict(missing){
 if(!missing)return 'Знайдені всі';
 const last=missing%10,lastTwo=missing%100;
 const noun=lastTwo>=11&&lastTwo<=14?'замовлень':last===1?'замовлення':last>=2&&last<=4?'замовлення':'замовлень';
 return 'Не знайдено '+missing+' '+noun;
}
function renderInspectorBatch(){
 if(view!=='inspector'||!$('#inspectorBatchResults'))return;
 const state=orderInspectorState,{numbers,invalid}=inspectorBatchEntries(state.batch),summary=$('#inspectorBatchSummary'),results=$('#inspectorBatchResults');results.replaceChildren();delete summary.dataset.result;
 if(!state.batchSearched){summary.textContent=numbers.length?'Номерів у списку: '+numbers.length+'. Перевірте розпізнані цифри перед пошуком.':'Завантажте скріншот або введіть номери — по одному в рядку.';return;}
 if(invalid.length){summary.textContent='Виправте рядки з невірним номером: '+invalid.join(', ')+'. Пошук ще не виконано.';return;}
 if(!numbers.length){summary.textContent='Спочатку додайте хоча б один номер.';return;}
 if(numbers.length>500){summary.textContent='Перевіряйте до 500 різних номерів за один раз.';return;}
 if(cloudRevision===null){summary.textContent='Дані ще не завантажено. Увійдіть і натисніть «Оновити дані».';return;}
 const rows=numbers.map(number=>({number,hits:inspectOrderNumbers(orders,number,state.scope)})),found=rows.filter(row=>row.hits.length).length;
 const area={all:'поточні та архів',current:'поточні замовлення',archive:'архів'}[state.scope];
 const missing=numbers.length-found;
 summary.textContent=inspectorBatchVerdict(missing)+' · Перевірено: '+numbers.length+'. Знайдено: '+found+'. Не знайдено: '+missing+'. Область: '+area+'.';
 summary.dataset.result=missing?'missing':'complete';
 results.innerHTML=rows.map(row=>'<section class="inspector-batch-item'+(row.hits.length?'':' missing')+'"><h3>'+esc(row.number)+' · '+(row.hits.length?'Знайдено ('+row.hits.length+')':'Не знайдено')+'</h3>'+row.hits.map(hit=>'<article><span class="tag">'+(hit.archived?'Архів':'Поточне замовлення')+(hit.common?' · Спільна витрата':'')+'</span><p><b>'+esc(hit.number)+'</b> · '+esc(hit.order)+'</p><p>'+esc(hit.material)+'</p><p><b>Сума:</b> '+(hit.amount===null?'Не вказана':esc(money(hit.amount,hit.currency)))+'</p></article>').join('')+'</section>').join('');
}
function mountInspectorScreenshot(){
 const state=orderInspectorState,section=document.createElement('section');section.className='inspector-screenshot';
 section.innerHTML='<div class="inspector-capture"><h3>Зчитати зі скріншота</h3><p class="hint">Файл або Ctrl + V · Зображення обробляється на пристрої.</p><div class="row"><button type="button" id="inspectorPickImage">Вибрати скріншот…</button><button type="button" id="inspectorCancelOcr" hidden>Скасувати зчитування</button><input id="inspectorImageFile" type="file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden></div><div id="inspectorPasteArea" tabindex="0" role="group" aria-label="Область вставлення скріншота">Вставити скріншот: Ctrl + V</div><p id="inspectorOcrStatus" role="status" aria-live="polite"></p><img id="inspectorPreview" class="inspector-preview" alt="Скріншот для зчитування номерів" hidden></div><div class="inspector-review"><label>Номери — перевірте та виправте<textarea id="inspectorBatchNumbers" rows="3" spellcheck="false" placeholder="141946&#10;142103&#10;141936"></textarea></label><p class="hint">Один номер у рядку · Повтори об’єднуються</p><div class="row"><button type="button" id="inspectorCheckBatch" class="primary">Перевірити всі</button><button type="button" id="inspectorClearBatch">Очистити список</button></div><p id="inspectorBatchSummary" role="status" aria-live="polite"></p></div><div id="inspectorBatchResults"></div>';
 $('.inspector-panel').append(section);$('#inspectorBatchNumbers').value=state.batch;$('#inspectorOcrStatus').textContent=state.ocrStatus;
 if(state.preview){$('#inspectorPreview').src=state.preview;$('#inspectorPreview').hidden=false;}
 $('#inspectorPickImage').onclick=()=>$('#inspectorImageFile').click();
 $('#inspectorImageFile').onchange=e=>{const file=e.target.files?.[0];e.target.value='';if(file)readInspectorScreenshot(file);};
 $('#inspectorCancelOcr').onclick=()=>cancelInspectorOcr();
 $('#inspectorBatchNumbers').oninput=e=>{state.batch=e.target.value;state.batchSearched=false;renderInspectorBatch();};
 $('#inspectorCheckBatch').onclick=()=>{state.batch=$('#inspectorBatchNumbers').value;state.batchSearched=true;renderInspectorBatch();};
 $('#inspectorClearBatch').onclick=()=>{cancelInspectorOcr();state.batch='';state.batchSearched=false;state.preview='';state.ocrStatus='';$('#inspectorBatchNumbers').value='';$('#inspectorPreview').hidden=true;$('#inspectorPreview').removeAttribute('src');$('#inspectorOcrStatus').textContent='';renderInspectorBatch();};
 inspectorOcrControls();renderInspectorBatch();
}
document.addEventListener('paste',event=>{
 if(view!=='inspector'||!$('#inspectorPasteArea'))return;
 const image=[...(event.clipboardData?.items||[])].find(item=>item.kind==='file'&&item.type.startsWith('image/'));
 if(!image)return;
 event.preventDefault();const file=image.getAsFile();if(file)readInspectorScreenshot(file);
});
window.addEventListener('pagehide',()=>cancelInspectorOcr());
