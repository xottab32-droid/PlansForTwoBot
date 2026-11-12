// HTML-виджеты Telegram (Bot API 10.4, sendWidget). Код виджета фиксирован, данные приходят
// через chat_data и ответы бота на TelegramWidget.request(). Пользовательский текст выводится
// только через textContent (никакого innerHTML с данными). Лимит: 4096 байт после zlib.

const CSS = `body{margin:0;padding:10px 12px max(10px,env(safe-area-inset-bottom))}
.m{color:var(--tg-theme-hint-color);font-size:.85em}.k{font-size:.75em;letter-spacing:.05em;text-transform:uppercase;color:var(--tg-theme-hint-color);margin:12px 0 4px}
.r{display:flex;align-items:center;gap:8px;padding:7px 9px;margin-top:5px;border-radius:12px;background:var(--tg-theme-secondary-bg-color)}
.r b{flex:1;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p{font-size:.78em;padding:2px 8px;border-radius:10px;background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color);white-space:nowrap}
.bar{height:6px;border-radius:3px;background:var(--tg-theme-section-separator-color);overflow:hidden;margin-top:5px}
.bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#ff5f8f,#ffa463);transition:width .6s}
.e{color:var(--tg-theme-destructive-text-color);font-size:.85em}`;

// Общие хелперы: el(tag, class, text, parent), load(), ask(data, cb)
const JS = `const W=window.TelegramWidget,A=document.getElementById('a');let S=null,busy=0;
function el(t,c,x,p){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;if(p)p.appendChild(e);return e}
function J(s){try{return JSON.parse(s)}catch(e){return null}}
function hap(){try{W.HapticFeedback.impactOccurred('light')}catch(e){}}
function ask(d,f){if(!W||busy)return;busy=1;W.request(d).then(r=>{busy=0;const j=J(r.result);if(j&&f)f(j)},e=>{busy=0;if(f&&e.code!=='RATE_LIMITED'&&e.code!=='NOT_ALLOWED')f({err:'Нет связи с ботом, попробуй ещё раз'})})}
function bg(d,f){if(!W)return;W.request(d).then(r=>{const j=J(r.result);if(j)f(j)},()=>{})}`;

const page = (body: string, script: string) =>
  `<!doctype html><html><head><style>${CSS}${body}</style></head><body><div id="a"></div><script>${JS}${script}</script></body></html>`;

// ---------- Главная ----------
export const HOME_HTML = page(
  `.h{display:flex;align-items:center;gap:12px}.av{width:46px;height:46px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:24px;background:linear-gradient(135deg,#ff5f8f,#ffa463)}
.t{font-weight:700;font-size:1.2em}.n{font-weight:700;font-size:1.6em;line-height:1.1}`,
  `function draw(s){if(!s)return;if(s.err){A.textContent='';el('div','e',s.err,A);return}S=s;A.textContent='';
const h=el('div','h',null,A);el('div','av','💞',h);const c=el('div',null,null,h);el('div','t',s.n,c);
if(s.t!=null){el('div','m','Вместе '+s.t+(s.s?' · с '+s.s:''),c)}else el('div','m','Добавь дату начала отношений',c);
if(s.p)el('div','m','Партнёр ещё не присоединился — /addpart',A);
el('div','k','Ближайшее',A);if(!s.e.length)el('div','m','Пока пусто — добавь свидание или важную дату',A);
s.e.forEach(x=>{const r=el('div','r',null,A);el('span',null,x[1],r);el('b',null,x[2],r);el('span','m',x[3],r);el('span','p',x[4],r);r.onclick=()=>{hap();ask('e:'+x[0])}});
el('div','k','Цели',A);if(!s.g.length)el('div','m','Целей пока нет — /addgoal',A);
s.g.forEach(x=>{const r=el('div','r',null,A);r.style.display='block';const t=el('div',null,null,r);t.style.display='flex';t.style.gap='8px';
el('span',null,x[1],t);el('b',null,x[2],t);el('span','m',x[3]+'%',t);const br=el('div','bar',null,r);el('i',null,null,br).style.width=Math.min(100,x[3])+'%';
el('div','m',x[4],r);r.onclick=()=>{hap();ask('g:'+x[0])}});
const w=el('div','r',null,A);w.style.marginTop='12px';el('span',null,'📍',w);el('b',null,'Хочу сходить',w);el('span','p',String(s.w),w);w.onclick=()=>{hap();ask('o:w')};
if(W)W.ready()}
draw(W?J(W.chatData):null);bg('h',draw);if(W)W.onEvent('activated',()=>bg('h',draw));`,
);

// ---------- Календарь ----------
export const CAL_HTML = page(
  `.nav{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px}.nav b{font-size:1.1em}
.nav button{min-width:40px}.g{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center}
.w{font-size:.72em;color:var(--tg-theme-hint-color)}.d{border-radius:10px;padding:4px 0 2px;min-height:34px}
.d.x{background:var(--tg-theme-secondary-bg-color)}.d.t{outline:2px solid var(--tg-theme-button-color)}
.d.s{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}.d i{display:block;font-style:normal;font-size:.62em;line-height:1.2;height:1.2em;overflow:hidden}
.nav .ti{flex:1;margin:0 6px;font-weight:700;font-size:1.05em}.ms{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:4px}
.ms button{padding:10px 0}.ms .s{outline:2px solid var(--tg-theme-button-color)}.td{width:100%;margin-top:8px}`,
  `const MN=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];let sel=null,L=null;
function mk(y,m){return y+'-'+String(m).padStart(2,'0')}
let P=0,py=0;
function go(y,m){if(y<1900||y>2200)return;P=0;sel=null;L=null;ask('m:'+mk(y,m),draw)}
function shift(k){let y=S.y,m=S.m+k;if(m<1){m=12;y--}if(m>12){m=1;y++}go(y,m)}
function pick(){A.textContent='';const n=el('div','nav',null,A);el('button',null,'‹',n).onclick=()=>{hap();if(py>1900){py--;pick()}};
el('b',null,String(py),n);el('button',null,'›',n).onclick=()=>{hap();if(py<2200){py++;pick()}};
const g=el('div','ms',null,A);MN.forEach((x,i)=>{el('button',py===S.y&&i+1===S.m?'s':null,x.slice(0,3),g).onclick=()=>{hap();go(py,i+1)}});
const r=el('div','nav',null,A);el('button','td','Сегодня',r).onclick=()=>{hap();go(+S.t.slice(0,4),+S.t.slice(5,7))};
el('button','td','Отмена',r).onclick=()=>{hap();P=0;draw({})};if(W)W.ready()}
function draw(s){if(!s)return;if(s.err){A.textContent='';el('div','e',s.err,A);return}if(s.y){if(!S||S.y!==s.y||S.m!==s.m){sel=null;L=null}S=s}if(!S)return;if(P)return pick();A.textContent='';
const n=el('div','nav',null,A);el('button',null,'‹',n).onclick=()=>{hap();shift(-1)};el('button','ti',MN[S.m-1]+' '+S.y+' ▾',n).onclick=()=>{hap();P=1;py=S.y;pick()};el('button',null,'›',n).onclick=()=>{hap();shift(1)};
const g=el('div','g',null,A);['пн','вт','ср','чт','пт','сб','вс'].forEach(x=>el('div','w',x,g));
const f=(new Date(Date.UTC(S.y,S.m-1,1)).getUTCDay()+6)%7,N=new Date(Date.UTC(S.y,S.m,0)).getUTCDate();for(let i=0;i<f;i++)el('div',null,null,g);
for(let d=1;d<=N;d++){const k=mk(S.y,S.m)+'-'+String(d).padStart(2,'0'),e=S.d[d];const c=el('div','d'+(e?' x':'')+(k===S.t?' t':'')+(k===sel?' s':''),String(d),g);el('i',null,e||'',c);
c.onclick=()=>{hap();sel=k;L={l:null};draw({});ask('d:'+k,j=>{L=j;draw({})})}}
if(sel&&L){el('div','k',L.x||'…',A);if(L.err)el('div','e',L.err,A);else if(L.l){if(!L.l.length)el('div','m','В этот день ничего нет',A);
L.l.forEach(x=>{const r=el('div','r',null,A);el('span',null,x[1],r);el('b',null,x[2],r);if(x[3])el('span','m',x[3],r);r.onclick=()=>{hap();ask('e:'+x[0])}})}}
if(W)W.ready()}
draw(W?J(W.chatData):null);if(S)bg('m:'+mk(S.y,S.m),draw);if(W)W.onEvent('activated',()=>{if(S&&!sel&&!P)bg('m:'+mk(S.y,S.m),draw)});`,
);

// ---------- Цель ----------
export const GOAL_HTML = page(
  `.h{display:flex;align-items:center;gap:14px}.ring{position:relative;width:86px;height:86px;flex:none}.ring svg{transform:rotate(-90deg)}
.ring circle{fill:none;stroke-width:9}.ring .bgc{stroke:var(--tg-theme-section-separator-color)}.ring .fg{stroke:url(#gr);stroke-linecap:round;transition:stroke-dashoffset .8s}
.pc{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.15em}
.t{font-weight:700;font-size:1.15em}.v{font-weight:700;font-size:1.3em}.q{display:flex;gap:6px;margin-top:10px}.q button{flex:1}
.ok{margin-top:8px;padding:7px 9px;border-radius:12px;background:var(--tg-theme-secondary-bg-color);display:flex;align-items:center;gap:8px}.ok b{flex:1}`,
  `const C=2*Math.PI*38;let OK=null;
function draw(s){if(!s)return;if(s.i)S=s;if(!S){if(s.err){A.textContent='';el('div','e',s.err,A)}return}A.textContent='';
const h=el('div','h',null,A),rg=el('div','ring',null,h);
rg.innerHTML='<svg width="86" height="86"><defs><linearGradient id="gr"><stop offset="0" stop-color="#ff5f8f"/><stop offset="1" stop-color="#ffa463"/></linearGradient></defs><circle class="bgc" cx="43" cy="43" r="38"/><circle class="fg" cx="43" cy="43" r="38"/></svg>';
const fg=rg.querySelector('.fg');fg.style.strokeDasharray=C;fg.style.strokeDashoffset=C*(1-Math.min(100,S.p)/100);el('div','pc',S.p+'%',rg);
const c=el('div',null,null,h);el('div','t',S.e+' '+S.t,c);el('div','v',S.sv,c);el('div','m','из '+S.tg+(S.a?' · цель достигнута 🎉':' · осталось '+S.lf),c);if(S.dl)el('div','m',S.dl,c);
if(S.ar)el('div','m','Цель в архиве',A);else{const q=el('div','q',null,A);S.q.forEach(x=>{el('button',null,'+'+x[1],q).onclick=()=>{hap();ask('t:'+S.i+':'+x[0],j=>{if(j.i){OK=j.ok?[j.ok,j.u]:null;try{W.HapticFeedback.notificationOccurred('success')}catch(e){}}else OK=[j.err,0];draw(j)})}});
const q2=el('div','q',null,A);el('button',null,'✍️ Своя сумма',q2).onclick=()=>{hap();ask('c:'+S.i)};el('button',null,'📜 История',q2).onclick=()=>{hap();ask('l:'+S.i)}}
if(OK){const o=el('div','ok',null,A);el('b',null,OK[0],o);if(OK[1]){el('button',null,'Отменить',o).onclick=()=>{hap();ask('x:'+OK[1],j=>{OK=j.i?['Пополнение отменено',0]:[j.err,0];draw(j)})}}}
if(S.h.length){el('div','k','Последние операции',A);S.h.forEach(x=>{const r=el('div','r',null,A);el('b',null,x[0]+(x[2]?' · '+x[2]:''),r);el('span','m',x[1]+' · '+x[3],r)})}
if(W)W.ready()}
draw(W?J(W.chatData):null);if(S)bg('r:'+S.i,draw);if(W)W.onEvent('activated',()=>{if(S)bg('r:'+S.i,draw)});`,
);
