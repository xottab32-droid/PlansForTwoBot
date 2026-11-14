// Android home-screen widget read-only API. Independent of the Telegram webhook.
// No Supabase secret or bot token is ever sent to Android.
import postgres from 'npm:postgres@3.4.5';

let sql: ReturnType<typeof postgres> | null = null;
function db() {
  if (!sql) {
    const url = Deno.env.get('SUPABASE_DB_URL');
    if (!url) throw new Error('Database connection not configured');
    sql = postgres(url, {prepare:false,max:3,idle_timeout:20,connect_timeout:10,onnotice:()=>{}});
  }
  return sql;
}
async function hexHash(value: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function reply(value: unknown, code=200) {
  return new Response(JSON.stringify(value),{status:code,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
function inYear(value: string,year:number):string {
  const month=value.slice(5,7),day=value.slice(8,10);
  // February 29 anniversaries roll back to Feb 28 in a non-leap year (same rule as bot).
  if(month==='02'&&day==='29'&&new Date(Date.UTC(year,1,29)).getUTCMonth()!==1) return year+'-02-28';
  return year+'-'+month+'-'+day;
}
function occurrence(value:string,yearly:boolean,today:string) {
  if(!yearly)return value;
  let year=Number(today.slice(0,4));
  let date=inYear(value,year);
  if(date<today)date=inYear(value,++year);
  return date;
}
type EventRow = {kind:string;title:string;event_date:string;yearly:boolean};
function nextEvent(rows:EventRow[],today:string,meeting:boolean) {
  const filtered=rows.filter(e=>(e.kind==='date')===meeting)
    .map(e=>({...e,date:occurrence(e.event_date,e.yearly,today)}))
    .filter(e=>e.date>=today)
    .sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));
  const row=filtered[0];
  return row?{date:row.date,title:row.title,kind:row.kind}:null;
}

Deno.serve(async req=>{
  if(req.method!=='POST')return reply({error:'POST only'},405);
  try {
    const raw=await req.text();
    if(raw.length>2048)return reply({error:'Request too large'},413);
    const body=JSON.parse(raw) as Record<string,unknown>;
    const action=body.action;
    const token=typeof body.token==='string'?body.token:'';
    if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'Invalid token'},400);
    const tokenHash=await hexHash(token);
    const dbs=db();
    if(action==='register') {
      const code=typeof body.code==='string'?body.code:'';
      if(!/^[a-f0-9]{48}$/.test(code))return reply({error:'Invalid code'},400);
      const ip=req.headers.get('cf-connecting-ip')??req.headers.get('x-real-ip')??req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()??'unknown';
      const ipHash=await hexHash('p4t-widget-ip:'+ip);
      const [rate]=await dbs`select count(*)::int as n from p4t.widget_devices where ip_hash=${ipHash} and created_at>now()-interval '1 hour'`;
      if(Number(rate?.n??0)>=12)return reply({error:'Слишком много попыток. Повтори через час.'},429);
      await dbs`delete from p4t.widget_devices where linked_at is null and expires_at<now()-interval '1 day'`;
      await dbs`insert into p4t.widget_devices(code_hash,token_hash,ip_hash) values (${await hexHash(code)},${tokenHash},${ipHash})`;
      return reply({status:'pending'});
    }
    if(action!=='snapshot')return reply({error:'Unknown action'},400);
    const [device]=await dbs`select tg_id,couple_id,linked_at,expires_at,revoked_at from p4t.widget_devices where token_hash=${tokenHash}`;
    if(!device||device.revoked_at||new Date(device.expires_at).getTime()<Date.now())
      return reply({error:'Привязка недействительна. Подключи Telegram заново.'},401);
    if(!device.linked_at||!device.tg_id||!device.couple_id)return reply({status:'pending'});
    const [member]=await dbs`select u.tg_id,c.tz from p4t.users u join p4t.couples c on c.id=u.couple_id where u.tg_id=${device.tg_id} and u.couple_id=${device.couple_id}`;
    if(!member)return reply({error:'Доступ к паре больше не разрешён'},403);
    const [stamp]=await dbs`select (now() at time zone ${member.tz})::date::text as today`;
    const today=String(stamp.today);
    const events=await dbs.begin(async tx=>{
      await tx`select set_config('p4t.couple',${String(device.couple_id)},true),set_config('p4t.user',${String(device.tg_id)},true)`;
      await tx`set local role p4t_app`;
      return await tx`select kind,title,event_date::text as event_date,yearly from p4t.events order by event_date limit 1000`;
    }) as EventRow[];
    const relationship=events.filter(e=>e.kind==='relationship'&&e.event_date<=today).sort((a,b)=>a.event_date.localeCompare(b.event_date))[0];
    return reply({
      status:'ready',timezone:member.tz,
      relationship_start:relationship?.event_date??null,
      meeting:nextEvent(events,today,true),
      event:nextEvent(events,today,false)
    });
  } catch(err) {
    console.error('android_widget_error',String(err));
    return reply({error:'Сервер временно недоступен'},500);
  }
});
