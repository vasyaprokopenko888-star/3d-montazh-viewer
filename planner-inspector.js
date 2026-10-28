'use strict';
// MASTERPLAN-ORDER-INSPECTOR-01. Reads saved costs only; never writes orders.
const orderInspectorState={query:'',scope:'all',searched:false};
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
 $('#content').innerHTML='<section class="inspector-panel"><h2>Інспектор замовлень</h2><p class="muted">Перевірте номер у збережених матеріалах і витратах усіх замовлень, виробів та спільних витрат.</p><form id="inspectorForm"><div class="inspector-controls"><label>Номер замовлення<input id="inspectorNumber" type="text" inputmode="numeric" maxlength="120" placeholder="Наприклад: 141946" autocomplete="off" spellcheck="false"></label><label>Де шукати<select id="inspectorScope"><option value="all">Усі: поточні та архів</option><option value="current">Поточні замовлення</option><option value="archive">Лише архів</option></select></label><button class="primary" type="submit">Перевірити</button></div><small>Префікс mkf- вводити не потрібно. Пошук за повним номером, без часткових збігів.</small></form><p id="inspectorSummary" role="status" aria-live="polite"></p><div id="inspectorResults" class="grid"></div><p class="hint">Пошук використовує збережені дані планувальника. Для завантаження останніх змін натисніть «Оновити дані».</p></section>';
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
 $('#inspectorScope').onchange=e=>{state.scope=e.target.value;search();};
 $('#inspectorForm').onsubmit=e=>{e.preventDefault();state.query=$('#inspectorNumber').value;state.searched=true;search();};
 search();
}
