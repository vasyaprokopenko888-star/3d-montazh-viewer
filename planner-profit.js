/* Master Plan profit calculator. Inputs are stored in the existing order costs/draft. */
(function(root){
'use strict';
const VAT=21/121, TAX=.21;
const number=x=>Number.isFinite(Number(x))?Math.max(0,Number(x)):0;
function normalize(raw={}){return {price:number(raw.price),cost:number(raw.cost),mode:raw.mode==='percent'?'percent':'czk',extra:number(raw.extra),discount:Math.min(100,number(raw.discount)),tax:raw.tax!==false,nonCost:number(raw.nonCost),nonExtra:number(raw.nonExtra)}}
function calculate(raw){
 const s=normalize(raw),cost=s.mode==='percent'?s.price*s.cost/100:s.cost,total=cost+s.extra;
 const nonCost=Math.min(cost,s.nonCost),nonExtra=Math.min(s.extra,s.nonExtra);
 const inputVAT=(cost-nonCost+s.extra-nonExtra)*VAT,costs=total-inputVAT;
 const sale=s.price*(1-s.discount/100),outputVAT=sale*VAT,revenue=sale-outputVAT;
 const profit=revenue-costs,tax=s.tax?Math.max(0,profit)*TAX:0,net=profit-tax;
 const baselineProfit=s.price/1.21-costs,baselineNet=baselineProfit-(s.tax?Math.max(0,baselineProfit)*TAX:0);
 const loss=baselineNet-net;
 return {price:s.price,discountAmount:s.price-sale,sale,total,inputVAT,outputVAT,vatPayable:outputVAT-inputVAT,revenue,costs,profit,tax,net,roi:costs===0?null:net/costs*100,margin:revenue===0?null:net/revenue*100,loss,lossPercent:baselineNet>0?loss/baselineNet*100:null,baselineNet,cost,nonCost,nonExtra};
}
function switchMode(raw,mode){const s=normalize(raw);if(s.mode===mode)return s;if(mode==='percent'&&s.price===0&&s.cost>0)return null;const amount=s.mode==='percent'?s.price*s.cost/100:s.cost;return {...s,mode,cost:mode==='percent'?(s.price?amount/s.price*100:0):amount}}
const api={calculate,normalize,switchMode};root.MasterPlanProfit=api;
if(typeof module!=='undefined')module.exports=api;
if(typeof document==='undefined')return;
const fmt=new Intl.NumberFormat('uk-UA',{minimumFractionDigits:2,maximumFractionDigits:2});
const money=n=>fmt.format(Object.is(n,-0)?0:n)+' Kč',percent=n=>n===null?'—':fmt.format(n)+'%';
api.mount=function(){
 document.getElementById('mp-profit')?.remove();
 let state=normalize(costDraft.profitCalculator||{});
 let seedNote='';
 if(!costDraft.profitCalculator){
  const summary=costSummary(costDraft),rate=costDraft.currency==='CZK'?1:Number(costDraft.rates[costDraft.currency]);
  if(!summary.missing&&!summary.unknown&&rate>0){state.cost=summary.total*rate;state.price=number(costDraft.agreedPrice)*rate;seedNote='Початкові суми взято з таблиці та погодженої ціни. Далі редагуються окремо.'}
  else seedNote='Введіть суми у Kč: у таблиці бракує даних або курсу для початкового заповнення.';
 }
 if(!document.getElementById('mp-profit-style')){
  const style=document.createElement('style');style.id='mp-profit-style';style.textContent=`
#mp-profit{padding:14px;background:#f3f7fb;border:1px solid #d6e0ed;border-radius:14px;margin:8px 0 18px;color:#172e40}
#mp-profit h3{margin:0 0 10px}#mp-profit .mp-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px}
#mp-profit label{display:flex;flex-direction:column;gap:4px;font-size:13px;min-width:0}#mp-profit input,#mp-profit select{width:100%;min-width:0;min-height:44px;padding:9px;font-size:16px;border:1px solid #bdccdd;border-radius:8px;background:white;color:#172e40}
#mp-profit .mp-cost-head{display:flex;justify-content:space-between;align-items:center;gap:4px}#mp-profit .mp-cost-head select{width:66px;min-height:28px;padding:2px;font-size:13px}
#mp-profit .mp-tax{display:flex;flex-direction:row;align-items:center;gap:8px;margin:10px 0}#mp-profit input[type=checkbox]{width:22px;min-height:22px;height:22px;accent-color:#1266d5}
#mp-profit .mp-hero{background:#e0f3ed;border-radius:10px;padding:12px;display:flex;align-items:center;justify-content:space-between;gap:8px}#mp-profit .mp-hero strong{font-size:24px;color:#116546}#mp-profit .mp-hero.mp-negative{background:#fff0ee}#mp-profit .mp-hero.mp-negative strong{color:#b42318}
#mp-profit .mp-metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}#mp-profit .mp-metrics b{display:block;font-size:19px}#mp-profit small{font-size:12px;line-height:1.4}#mp-profit details{margin-top:8px}#mp-profit summary{cursor:pointer;font-weight:650;padding:7px 0}
#mp-profit dl{margin:10px 0}#mp-profit dl>div{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #d6e0ed;font-size:13px}#mp-profit dt{min-width:0}#mp-profit dd{margin:0;text-align:right;font-weight:650;white-space:nowrap}#mp-profit .mp-warning{color:#a32a18}#mp-profit .mp-note{display:block;margin:8px 0 0}#mp-profit [hidden]{display:none!important}
@media(max-width:400px){#mp-profit{padding:10px}#mp-profit .mp-hero strong{font-size:21px}#mp-profit dl>div{font-size:12px;gap:6px}}
`;document.head.append(style);
 }
 const panel=document.createElement('section');panel.id='mp-profit';panel.setAttribute('aria-label','Калькулятор прибутку');
 const field=(name,label)=>`<label>${label}<input data-mp="${name}" type="number" inputmode="decimal" min="0" step="any" ${name==='discount'?'max="100"':''}></label>`;
 panel.innerHTML=`<h3>Прибуток замовлення · Kč</h3><div class="mp-fields">${field('price','Ціна з DPH, Kč')}<label><span class="mp-cost-head">Собівартість<select data-mp="mode" aria-label="Одиниця собівартості"><option value="czk">Kč</option><option value="percent">%</option></select></span><input data-mp="cost" aria-label="Початкова собівартість" type="number" inputmode="decimal" min="0" step="any"></label>${field('extra','Непередбачені, Kč')}${field('discount','Знижка, %')}</div><label class="mp-tax"><input data-mp="tax" type="checkbox">Прогноз податку s.r.o. · 21%</label><div class="mp-hero"><span id="mp-net-label">Чистий прибуток</span><strong id="mp-net" role="status" aria-live="polite"></strong></div><div class="mp-metrics"><div><small>Рентабельність витрат</small><b id="mp-roi"></b></div><div><small>Маржа від продажу</small><b id="mp-margin"></b></div></div><small id="mp-loss"></small><small id="mp-validation" class="mp-warning mp-note" role="status"></small><details><summary>Деталі · DPH та розрахунок</summary><div class="mp-fields">${field('nonCost','Із собівартості без відрахування DPH, Kč')}${field('nonExtra','Із непередбачених без відрахування DPH, Kč')}</div><small class="mp-note">Це частини введених витрат, а не додаткові суми. Решта містить DPH 21% із повним правом відрахування.</small><dl id="mp-breakdown"></dl><small>Податок s.r.o. — спрощений прогноз. Фактичний річний податок залежить від загального податкового результату компанії. Втрата від знижки порівнюється з чистим прибутком без знижки; відсоток доступний лише за додатного базового прибутку.</small><small class="mp-note">${seedNote} Параметри зберігаються разом із замовленням; автоматична локальна чернетка — на цьому пристрої.</small></details>`;
 document.querySelector('#costDialog>.tools').after(panel);
 const controls=[...panel.querySelectorAll('[data-mp]')];
 function fill(){for(const el of controls){const key=el.dataset.mp;if(el.type==='checkbox')el.checked=state[key];else el.value=state[key]}}
 function draw(){const r=calculate(state);panel.querySelector('#mp-net').textContent=money(r.net);panel.querySelector('.mp-hero').classList.toggle('mp-negative',r.net<0);panel.querySelector('#mp-net-label').textContent=state.tax?'Чистий прибуток':'Прибуток без податку';panel.querySelector('#mp-roi').textContent=percent(r.roi);panel.querySelector('#mp-margin').textContent=percent(r.margin);panel.querySelector('#mp-loss').textContent='Втрата через знижку: '+money(r.loss)+' · '+percent(r.lossPercent);
 const rows=[['Початкова ціна з DPH',r.price],['Знижка',r.discountAmount],['Продаж після знижки з DPH',r.sale],['Загальна собівартість',r.total],['DPH із продажу',r.outputVAT],['Вхідний DPH до відрахування',r.inputVAT],[r.vatPayable<0?'Перевищення вхідного DPH':'Розрахунковий DPH до сплати',Math.abs(r.vatPayable)],['Прибуток до податку',r.profit],['Прогнозований податок s.r.o.'+(state.tax?'':' · вимкнено'),r.tax],['Чистий прибуток',r.net]];
 panel.querySelector('#mp-breakdown').innerHTML=rows.map(([label,value])=>`<div><dt>${label}</dt><dd>${money(value)}</dd></div>`).join('')+(r.vatPayable<0?'<div><small>Перевищення вхідного DPH не означає автоматичного повернення.</small></div>':'');
 }
 function commit(){costDraft.profitCalculator={...state};saveLocalDraft()}
 function change(e){const el=e.target,key=el.dataset.mp;if(!key)return;const warning=panel.querySelector('#mp-validation');warning.textContent='';
 if(key==='mode'){const next=switchMode(state,el.value);if(!next){el.value=state.mode;warning.textContent='За нульової ціни додатну собівартість неможливо виразити у %. Спочатку введіть ціну.';return}state=next;fill()}
 else if(key==='tax')state.tax=el.checked;
 else{const value=el.valueAsNumber;const safe=Number.isFinite(value)?Math.max(0,value):0;state[key]=key==='discount'?Math.min(100,safe):safe;if(!Number.isFinite(value)&&el.validity.badInput){warning.textContent='Введіть коректне число.';return}if(el.value!==''&&(safe!==value||(key==='discount'&&value>100))){el.value=state[key];if(el.value!=='')warning.textContent='Значення обмежено допустимим діапазоном.'}}
 const r=calculate(state);if(state.nonCost>r.cost||state.nonExtra>state.extra){state.nonCost=r.nonCost;state.nonExtra=r.nonExtra;controls.find(x=>x.dataset.mp==='nonCost').value=state.nonCost;controls.find(x=>x.dataset.mp==='nonExtra').value=state.nonExtra;warning.textContent='Частину без відрахування обмежено відповідною сумою витрат.'}
 draw();commit();
 }
 panel.addEventListener('input',e=>{if(e.target.tagName!=='SELECT'&&e.target.type!=='checkbox')change(e)});panel.addEventListener('change',e=>{if(e.target.tagName==='SELECT'||e.target.type==='checkbox')change(e)});
 fill();draw();
};
})(typeof globalThis!=='undefined'?globalThis:this);

