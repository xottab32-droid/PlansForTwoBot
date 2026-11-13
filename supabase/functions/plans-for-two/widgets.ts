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
function ask(d,f){if(!W||busy){if(f)f({err:'Запрос занят. Попробуй ещё раз.'});return}busy=1;W.request(d).then(r=>{busy=0;const j=J(r.result);if(f)f(j||{err:'Нет ответа от бота, попробуй ещё раз'})},e=>{busy=0;if(f)f({err:e.code==='RATE_LIMITED'?'Слишком много запросов. Повтори через несколько секунд.':'Не удалось связаться с ботом, попробуй ещё раз'})})}
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
if(s.f){const f=el('div','r',null,A);el('span',null,'🎁',f);el('b',null,'Желания и подарки',f);el('span','m',s.f[1]!=null?'мои '+s.f[0]+' · '+s.b+' '+s.f[1]:String(s.f[0]),f);const status=el('div','m','',A);f.onclick=()=>{hap();status.textContent='Открываю подарки…';ask('o:p',r=>{status.textContent=r.err|| (r.opened==='widget'?'🎁 Виджет подарков отправлен ниже в чат ↓':'🎁 Список подарков отправлен ниже в чат ↓')})}}
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

// ---------- Админ: статистика (только агрегаты) ----------
export const ADMIN_HTML = page(
  `.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.tl{background:var(--tg-theme-secondary-bg-color);border-radius:12px;padding:8px 9px}
.tl .v{font-weight:700;font-size:1.35em;line-height:1.15}.tl .m{font-size:.75em}.sg{display:flex;gap:4px;margin:6px 0}.sg button{flex:1;padding:5px 0;font-size:.85em}
.sg .on{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}.ch{display:flex;align-items:flex-end;gap:3px;height:96px;padding-top:4px}
.ch div{flex:1;border-radius:4px 4px 0 0;background:linear-gradient(0deg,#ff5f8f,#ffa463);min-height:2px;transition:height .5s}.ch div.z{background:var(--tg-theme-section-separator-color)}
.ch div.s{outline:2px solid var(--tg-theme-button-color)}.ax{display:flex;justify-content:space-between;font-size:.72em;color:var(--tg-theme-hint-color);margin-top:3px}
.st{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--tg-theme-section-separator-color)}.st i{display:block;height:100%}
.lg{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:.8em;margin-top:5px}.lg span:before{content:'';display:inline-block;width:8px;height:8px;border-radius:4px;margin-right:4px;background:var(--c)}
.hb{margin-top:6px}.hb .l{display:flex;justify-content:space-between;font-size:.85em}.hb .bar{height:8px;border-radius:4px}`,
  `let MD=0,SD=-1,TB=0;const P=(a,b)=>b>0?Math.round(a/b*100):0,F=n=>String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,' ');
function tile(p,v,l){const t=el('div','tl',null,p);el('div','v',v,t);el('div','m',l,t)}
function stack(p,a){const s=el('div','st',null,p),T=a.reduce((x,y)=>x+y[1],0),g=el('div','lg',null,p);a.forEach(x=>{if(T&&x[1]){const i=el('i',null,null,s);i.style.width=x[1]/T*100+'%';i.style.background=x[2]}const l=el('span',null,x[0]+' '+F(x[1]),g);l.style.setProperty('--c',x[2])})}
function hbar(p,l,v,t){const h=el('div','hb',null,p),r=el('div','l',null,h);el('span',null,l,r);el('b',null,F(v)+(t!=null?' · '+P(v,t)+'%':''),r);const b=el('div','bar',null,h);el('i',null,null,b).style.width=(t!=null?P(v,t):100)+'%'}
function day(i){const d=new Date(S.de+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(13-i));return String(d.getUTCDate()).padStart(2,'0')+'.'+String(d.getUTCMonth()+1).padStart(2,'0')}
function draw(s){if(!s)return;if(s.err&&!S){A.textContent='';el('div','e',s.err,A);return}if(s.u!=null)S=s;if(!S)return;A.textContent='';const s0=S;
const tb=el('div','sg',null,A);['Обзор','Пары','Функции','Всего'].forEach((x,i)=>{el('button',i===TB?'on':null,x,tb).onclick=()=>{hap();TB=i;draw({})}});
if(TB===0){const g=el('div','g3',null,A);tile(g,F(s0.u),'пользователей');tile(g,F(s0.c),'пар');tile(g,F(s0.cs[0]),'полных пар');
el('div','k','Были в боте',A);const g2=el('div','g3',null,A);tile(g2,F(s0.a[0]),'сегодня');tile(g2,F(s0.a[1]),'за 7 дней');tile(g2,F(s0.a[2]),'за 30 дней');
el('div','m','Новых: сегодня '+s0.n[0]+' · 7 дн. '+s0.n[1]+' · 30 дн. '+s0.n[2]+(s0.a[2]?' · DAU/MAU '+P(s0.a[0],s0.a[2])+'%':''),A);
el('div','k','14 дней',A);const sg=el('div','sg',null,A);['Люди','Действия'].forEach((x,i)=>{el('button',i===MD?'on':null,x,sg).onclick=()=>{hap();MD=i;draw({})}});
const v=s0.d.map(x=>x[MD]),mx=Math.max(1,...v),ch=el('div','ch',null,A);v.forEach((x,i)=>{const b=el('div',(x?'':'z')+(i===SD?' s':''),null,ch);b.style.height=Math.max(2,x/mx*100)+'%';b.onclick=()=>{hap();SD=SD===i?-1:i;draw({})}});
const ax=el('div','ax',null,A);el('span',null,day(0),ax);el('span',null,SD<0?'макс '+mx:day(SD)+': '+s0.d[SD][0]+' чел. · '+s0.d[SD][1]+' действий',ax);el('span',null,day(13),ax)}
if(TB===1){el('div','k','Полные пары по активности',A);stack(A,[['≤7 дн.',s0.pa[0],'#34c759'],['8–30 дн.',s0.pa[1],'#ffcc00'],['30+ дн.',s0.pa[2],'#ff3b30']]);
el('div','m','Пользуются (есть записи): '+s0.cu+' из '+s0.cs[0]+' · ждут партнёра '+s0.cs[1]+' · распались '+s0.cs[2],A);
el('div','k','Частота за 30 дней',A);stack(A,[['почти каждый день',s0.fq[0],'#34c759'],['каждую неделю',s0.fq[1],'#5ac8fa'],['изредка',s0.fq[2],'#8e8e93']]);
el('div','m','В среднем '+s0.ad+' дн. с ботом, ~'+s0.ah+' действий в такой день',A);
el('div','k','Удержание',A);const g3=el('div','g3',null,A);tile(g3,P(s0.fg[0],s0.fg[1])+'%','запустили и забыли ('+s0.fg[0]+' из '+s0.fg[1]+')');
tile(g3,s0.rt[1]?P(s0.rt[0],s0.rt[1])+'%':'—','вернулись через неделю');tile(g3,F(s0.h[1]),'действий за 7 дней')}
if(TB===2){el('div','k','Воронка',A);const fn=s0.fn;[['Запустили',fn[0]],['В паре',fn[1]],['Полная пара',fn[2]],['Есть записи',fn[3]]].forEach(x=>hbar(A,x[0],x[1],fn[0]));
el('div','k','Функции · доля пар из '+s0.fe[4],A);[['📅 События',0],['🎯 Цели',1],['💰 Пополнения',2],['📍 Хочу сходить',3],['🎁 Желания',5]].forEach(x=>hbar(A,x[0],s0.fe[x[1]],s0.fe[4]))}
if(TB===3){const t=s0.tt,g4=el('div','g3',null,A);tile(g4,F(t[0]),'событий');tile(g4,F(t[1]),'целей, достигнуто '+t[2]);tile(g4,F(t[3]),'операций по целям');
tile(g4,F(t[4]),'мест, посетили '+t[5]);tile(g4,F(t[6]),'связей с событиями');tile(g4,F(t[7]),'напоминаний за 7 дн.');tile(g4,F(t[8]||0),'желаний, подарено '+(t[9]||0));
el('div','k','Настройки и отток',A);const g5=el('div','g3',null,A);tile(g5,F(s0.o[0]),'заблокировали');tile(g5,F(s0.o[1]),'без новостей');tile(g5,F(s0.o[2]+s0.o[3]),'без карточек / звука')}
el('div','m','Обновлено '+s0.at+' UTC · только обезличенные цифры',A).style.marginTop='10px';if(W)W.ready()}
draw(W?J(W.chatData):null);bg('as',draw);if(W)W.onEvent('activated',()=>bg('as',draw));`,
);

// ---------- Желания и подарки ----------
// Данные собраны под зрителя: на своих желаниях отметок дарителя нет совсем (их не отдаёт база).
// m/p: [строка повода, всего, [[id, приоритет, название, цена, (отметка 0/1/2)]]]
export const GIFT_HTML = page(
  `.sg{display:flex;gap:4px;margin-bottom:8px}.sg button{flex:1;padding:6px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sg .on{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}.q{display:flex;gap:6px;margin-top:10px}.q button{flex:1}
.r{cursor:pointer}.p.o{background:none;color:var(--tg-theme-link-color);box-shadow:inset 0 0 0 1px var(--tg-theme-link-color)}.p.b{background:#34c759;color:#fff}
.bg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin:5px 0 8px}.bg button{min-width:0;padding:7px 1px;font-size:.75em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bg .on{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}`,
  `let T=0;const PS=['＋ отметить','🤫 выбрал','🛍 купил'],NX=['p','b','n'];
function row(x,t){const r=el('div','r',null,A);el('span',null,x[1],r);el('b',null,x[2],r);if(x[3])el('span','m',x[3],r);r.onclick=()=>{hap();ask('go:'+x[0])};
if(t){const s=el('span','p'+(x[4]===2?' b':x[4]?'':' o'),PS[x[4]],r);s.onclick=e=>{e.stopPropagation();hap();ask('gs:'+x[0]+':'+NX[x[4]],draw)}}}
function draw(s){if(!s)return;if(s.m)S=s;if(!S){if(s.err){A.textContent='';el('div','e',s.err,A)}return}A.textContent='';if(!S.p)T=0;
if(S.p){const tb=el('div','sg',null,A);['🙋 Мои','💞 '+S.b].forEach((x,i)=>{el('button',i===T?'on':null,x,tb).onclick=()=>{hap();T=i;draw({})}})}
else el('div','k','Мои желания',A);
const d=T?S.p:S.m;
if(T){el('div','k','Подобрать по бюджету',A);const filters=el('div','bg',null,A),chosen=S.f||0;
[['Все',0],...(S.q||[]).map(n=>['до '+(n>=1000?Math.round(n/1000)+'к':n)+(S.cc||''),n])].forEach(x=>{
el('button',chosen===x[1]?'on':null,x[0],filters).onclick=()=>{hap();ask('gb:'+x[1],draw)}});
}
if(d[0])el('div','m',d[0],A);if(s.err)el('div','e',s.err,A);
if(!d[2].length)el('div','m',T?S.b+' пока ничего не добавил(а) — можно намекнуть 😉':'Добавь, что хочешь получить в подарок — с ценой и ссылкой',A);
d[2].forEach(x=>row(x,T));
const f=el('div','q',null,A);if(!T)el('button',null,'➕ Добавить',f).onclick=()=>{hap();ask('ga')};
if(T&&d[1])el('button',null,'🎲 Случайный',f).onclick=()=>{hap();ask('gx:'+(S.f||0))};
if(d[1])el('button',null,'📋 Все ('+d[1]+') ›',f).onclick=()=>{hap();ask('gl:'+(T?'p':'m'))};
el('div','m',T?'🤫 '+S.b+' не видит твои отметки «выбрал» и «купил»':(S.p?S.b+' видит список, но не видит, что выбрано':'Партнёр увидит список, когда присоединится'),A).style.marginTop='8px';
if(W)W.ready()}
draw(W?J(W.chatData):null);bg('gw',draw);
if(W)W.onEvent('activated',()=>bg(S&&S.f?'gb:'+S.f:'gw',draw));`,
);
