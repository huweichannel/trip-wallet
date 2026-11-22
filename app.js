"use strict";
(()=>{
const CFG=window.CONFIG||{};
const QS=new URLSearchParams(location.search),MOCK=QS.get("mock")==="1";
const FALLBACK_RATE=0.0264;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------- storage (try/catch, memory fallback) ---------- */
const mem={};
function sget(k,d){if(!MOCK){try{const v=localStorage.getItem(k);if(v!==null)return JSON.parse(v);}catch(_){}}return k in mem?mem[k]:d;}
function sset(k,v){mem[k]=v;if(!MOCK){try{localStorage.setItem(k,JSON.stringify(v));}catch(_){}}}
function sdel(k){delete mem[k];if(!MOCK){try{localStorage.removeItem(k);}catch(_){}}}

/* ---------- categories (from the mockup) ---------- */
const CAT={
 food:["Food & Dining","Food","var(--food)","var(--food-bg)",'<path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8M16 3c-2 2-2 7 0 9v9"/>'],
 transit:["Transit & Trains","Transit","var(--transit)","var(--transit-bg)",'<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 20l1-4M15 20l-1-4"/>'],
 tickets:["Tickets & Attractions","Tickets","var(--tickets)","var(--tickets-bg)",'<path d="M4 8h16v3a2 2 0 0 0 0 3v3H4v-3a2 2 0 0 0 0-3z"/>'],
 shop:["Shopping","Shopping","var(--shop)","var(--shop-bg)",'<path d="M5 8h14l-1 12H6zM9 8a3 3 0 0 1 6 0"/>'],
 hotel:["Hotel / Accommodation","Hotel","var(--hotel)","var(--hotel-bg)",'<path d="M3 19V7M3 14h18v5M7 11h4v3"/>'],
 flight:["Flights & Passes","Flights","var(--flight)","var(--flight-bg)",'<path d="M3 13l18-7-5 14-3-6z"/>'],
 other:["Other","Other","var(--other)","var(--other-bg)",'<circle cx="7" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="17" cy="12" r="1"/>']};
const KEYS=Object.keys(CAT);
const KEYOF={};KEYS.forEach(k=>KEYOF[CAT[k][0]]=k);

/* ---------- today (Asia/Tokyo) ---------- */
const today=()=>(MOCK&&QS.get("today"))||new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Tokyo"});
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dname=d=>new Date(d+"T00:00:00Z").toLocaleDateString("en-GB",{weekday:"short",timeZone:"UTC"});

/* ---------- state ---------- */
let data=sget("tw.cache",null);if(!data||!Array.isArray(data.rows))data=null;
let queue=sget("tw.queue",[]);if(!Array.isArray(queue))queue=[];
let view=sget("tw.view","mine")==="all"?"all":"mine";
let edit=null,pedit=null,wbusy=false;
const token=()=>sget("tw.token",null);
const credId=()=>sget("tw.cred",null);
const saveQ=()=>sset("tw.queue",queue);
const rate=()=>data&&data.rate>0?data.rate:FALLBACK_RATE;
const meta=()=>data&&data.meta||null;
const partner=()=>meta()&&meta().other||"Partner";
const tripM=()=>{const m=meta(),t=m&&m.trip;return t&&/^\d{4}-\d{2}-\d{2}$/.test(t.start)&&/^\d{4}-\d{2}-\d{2}$/.test(t.end)?t:null;};
const T0=()=>tripM()?tripM().start:"0000-00-00",T1=()=>tripM()?tripM().end:"0000-00-00";
const dayMs=d=>Date.parse(d+"T00:00:00Z");
const fmtD=d=>(+d.slice(8))+" "+MON[(+d.slice(5,7)||1)-1];
const tripDays=()=>tripM()?Math.min(60,Math.max(1,Math.round((dayMs(T1())-dayMs(T0()))/864e5)+1)):0;

/* ---------- API ---------- */
async function api(p){
 try{
  if(MOCK)return await mockApi(p);
  if(!CFG.API_URL)return{ok:false,err:"net"};
  const res=await fetch(CFG.API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(p),redirect:"follow"});
  const j=await res.json();
  return j&&typeof j==="object"?j:{ok:false,err:"server"};
 }catch(_){return{ok:false,err:"net"};}
}

/* ---------- rows ---------- */
const stageOf=d=>d>=T0()?"On-Trip":"Pre-Trip";
function srvRow(r){const was={date:String(r.date),cat:r.cat,desc:String(r.desc==null?"":r.desc),cur:r.cur,amt:Number(r.amt)||0,paidBy:r.paidBy,split:String(r.split)};
 return{key:"s"+r.row,row:r.row,was:was,other:r.other==null?null:Number(r.other),meS:Number(r.meShare)||0,date:was.date,k:KEYOF[r.cat]||"other",desc:was.desc,cur:r.cur==="MYR"?"MYR":"JPY",amt:was.amt,pb:r.paidBy==="me"?"Me":"Other",split:was.split,stage:String(r.stage)};}
function qRow(q){const me=q.paidBy==="me",a=q.amt;
 return{key:"q"+q.id,q:q,meS:q.split==="50/50 Split"?a/2:q.split==="100% Owed by Other"?(me?0:a):(me?a:0),date:q.date,k:KEYOF[q.cat]||"other",desc:q.desc,cur:q.cur,amt:a,pb:me?"Me":"Other",split:q.split,stage:stageOf(q.date)};}
const allRows=()=>(data?data.rows.map(srvRow):[]).concat(queue.map(qRow));
const rm=r=>r.cur==="JPY"?r.amt*rate():r.amt;
const mineV=r=>r.cur==="JPY"?r.meS*rate():r.meS;
const val=r=>view==="mine"?mineV(r):rm(r);
const RM=v=>"RM "+v.toLocaleString("en-MY",{minimumFractionDigits:2,maximumFractionDigits:2});
const RM0=v=>"RM "+Math.round(v).toLocaleString();
const ORIG=r=>r.cur==="JPY"?"¥"+Math.round(r.amt).toLocaleString():RM(r.amt);
const ic=(k,s="")=>`<span class="ic" style="background:${CAT[k][2]}${s}"><svg viewBox="0 0 24 24">${CAT[k][4]}</svg></span>`;
const onTrip=r=>r.stage==="On-Trip";

function dayBlocks(list){
 const by={};list.forEach(r=>(by[r.date]=by[r.date]||[]).push(r));
 return Object.keys(by).sort().reverse().map(d=>`<div class="day"><div class="dayh"><span class="n">${esc(+d.slice(8)||"")}</span><span><span class="w">${esc(dname(d))}</span><div class="y">${esc(d.slice(0,7).replace("-","/"))}</div></span><span class="t">${RM(by[d].reduce((s,r)=>s+rm(r),0))}</span></div>${by[d].map(r=>`<div class="tx" data-r="${esc(r.key)}">${ic(r.k)}<div class="m"><div>${esc(r.desc)}</div><small>${esc(CAT[r.k][1])} · ${r.pb==="Me"?"You paid":esc(partner())+" paid"}${r.split==="50/50 Split"?'<span class="tag">50/50</span>':""}</small></div><div class="a">${ORIG(r)}${r.cur==="JPY"?`<small>${RM(rm(r))}</small>`:""}</div></div>`).join("")}</div>`).join("");}

function render(){
 const rows=allRows(),T=today(),t=rows.filter(r=>r.date===T),sum=L=>L.reduce((s,r)=>s+val(r),0),paid=rows.filter(r=>r.pb==="Me");
 $("hTotal").textContent=RM(sum(rows));$("hTotalY").textContent="You paid "+RM(paid.reduce((s,r)=>s+rm(r),0))+" · "+paid.length+" items";
 $("hToday").textContent=RM(sum(t));$("hTodayY").textContent="¥"+Math.round(t.filter(r=>r.cur==="JPY").reduce((s,r)=>s+r.amt,0)).toLocaleString()+" · "+t.length+" items";
 const net=netv();$("hOweK").textContent=net>0?partner()+" owes you":net<0?"You owe "+partner():"All settled";$("hOwe").textContent=RM(Math.abs(net));
 const cs=KEYS.map(k=>[k,sum(rows.filter(r=>r.k===k))]).filter(c=>c[1]>0).sort((a,b)=>b[1]-a[1]);
 $("tiles").innerHTML=cs.slice(0,6).map(([k,v])=>`<div class="tile" style="background:${CAT[k][3]}">${ic(k)}<span>${CAT[k][1]}</span><b>${RM0(v)}</b></div>`).join("");
 $("list").innerHTML=rows.length?dayBlocks(rows):'<div class="card y">No expenses yet. Tap + to add the first one.</div>';
 stats();cal();setRender();pill();pRender();}
const netv=()=>Math.round((data&&data.summary?Number(data.summary.net)||0:0)*100)/100;
$("view").onclick=e=>{const b=e.target.closest("button");if(!b)return;view=b.dataset.w==="all"?"all":"mine";sset("tw.view",view);syncView();render();};
function syncView(){[...$("view").children].forEach(x=>x.classList.toggle("on",x.dataset.w===view));}
syncView();

let scope="trip";
function stats(){
 const rows=allRows(),T=today(),L=scope==="trip"?rows.filter(onTrip):rows,tot=L.reduce((s,r)=>s+rm(r),0);
 const cs=KEYS.map(k=>[k,L.filter(r=>r.k===k).reduce((s,r)=>s+rm(r),0)]).filter(c=>c[1]>0).sort((a,b)=>b[1]-a[1]);
 let off=25,seg="";
 if(tot>0)cs.forEach(([k,v])=>{const p=v/tot*100;seg+=`<circle cx="21" cy="21" r="15.915" fill="none" stroke="${CAT[k][2]}" stroke-width="6" stroke-dasharray="${p} ${100-p}" stroke-dashoffset="${off}"/>`;off-=p;});
 $("donut").innerHTML=`<circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--hair)" stroke-width="6"/><g class="ring">${seg}</g><text x="21" y="20" text-anchor="middle" font-size="3.2" fill="var(--ink2)">Total</text><text x="21" y="24.6" text-anchor="middle" font-size="4.4" font-weight="700" fill="var(--ink)">${RM0(tot)}</text>`;
 $("legend").innerHTML=tot>0?cs.map(([k,v])=>`<div><i style="background:${CAT[k][2]}"></i>${CAT[k][1]}<span>${Math.round(v/tot*100)}%</span></div>`).join(""):"";
 const days=[];for(let i=0;i<tripDays();i++)days.push(new Date(dayMs(T0())+i*864e5).toISOString().slice(0,10));
 const dv=days.map(d=>rows.filter(r=>r.date===d).reduce((s,r)=>s+rm(r),0)),mx=Math.max(1,...dv);
 $("cols").innerHTML=days.map((d,i)=>`<div class="${d===T?"now":""}"><i style="height:${dv[i]/mx*85}%;--i:${i}"></i><span>${+d.slice(8)}</span></div>`).join("");
 $("catRows").innerHTML=cs.length?cs.map(([k,v],i)=>`<div class="rowc">${ic(k)}<div class="m"><div>${CAT[k][1]}</div><div class="bar"><i style="width:${v/cs[0][1]*100}%;background:${CAT[k][2]};--i:${i}"></i></div></div><div class="a">${RM(v)}<small>${(n=>n+(n===1?" item":" items"))(L.filter(r=>r.k===k).length)}</small></div></div>`).join(""):'<div class="y">No expenses yet.</div>';
 const jy=L.filter(r=>r.cur==="JPY").reduce((s,r)=>s+r.amt,0),my=L.filter(r=>r.cur==="MYR").reduce((s,r)=>s+r.amt,0);
 $("curRows").innerHTML=`<div class="rowc"><div class="m"><div>Japanese yen</div><div class="y">¥${Math.round(jy).toLocaleString()}</div></div><div class="a">${RM(jy*rate())}</div></div><div class="rowc"><div class="m"><div>Ringgit</div><div class="y">paid in RM</div></div><div class="a">${RM(my)}</div></div>`;}
$("scope").onclick=e=>{const b=e.target.closest("button");if(!b)return;scope=b.dataset.s;[...$("scope").children].forEach(x=>x.classList.toggle("on",x===b));stats();};

let calSel=null;
function cal(){
 const rows=allRows(),tm=tripM();
 if(!calSel)calSel=tm?(today()>=T0()&&today()<=T1()?today():T0()):null;
 const h=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>`<div class="h">${d}</div>`).join("");
 let c="",n=0;const s0=tm?new Date(dayMs(T0())):null;
 if(s0){s0.setUTCDate(s0.getUTCDate()-(s0.getUTCDay()+6)%7);n=Math.ceil((dayMs(T1())-s0.getTime())/864e5/7+1/7)*7;}
 for(let i=0;i<n;i++){const dt=new Date(s0.getTime()+i*864e5),d=dt.toISOString().slice(0,10),v=rows.filter(r=>r.date===d).reduce((s,r)=>s+rm(r),0),tr=d>=T0()&&d<=T1();
  c+=`<button class="c${tr?" trip":" off"}${d===calSel?" now":""}" data-d="${d}" style="border:0;font-family:inherit;color:inherit;cursor:pointer">${dt.getUTCDate()}${v?`<small>${Math.round(v)}</small>`:"<small>&nbsp;</small>"}</button>`;}
 $("cal").innerHTML=h+c;$("calList").innerHTML=(calSel&&dayBlocks(rows.filter(r=>r.date===calSel)))||'<div class="card y">No expenses on this day.</div>';}
$("cal").onclick=e=>{const b=e.target.closest("[data-d]");if(!b)return;calSel=b.dataset.d;cal();};
document.querySelectorAll("nav [data-v]").forEach(b=>b.onclick=()=>{document.querySelectorAll("nav [data-v]").forEach(x=>x.classList.toggle("on",x===b));
 ["home","cal","stats","set"].forEach(v=>$("v-"+v).hidden=v!==b.dataset.v);scrollTo(0,0);if(b.dataset.v==="stats")stats();enter($("v-"+b.dataset.v));});
function enter(el){[...el.children].forEach((c,i)=>c.style.setProperty("--i",i));again(el,"enter");}
function again(el,c){el.classList.remove(c);void el.offsetWidth;el.classList.add(c);}
function toast(t){const el=$("toast");el.textContent=t;el.classList.add("show");clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove("show"),2000);}

/* ---------- header pill ---------- */
let sending=false;
function pill(){const s=$("sync");let txt,q=true;
 if(sending&&queue.length)txt="Sending…";else if(queue.length)txt="Waiting · "+queue.length;else{txt="Synced";q=false;}
 s.classList.toggle("q",q);s.lastElementChild.textContent=txt;}

/* ---------- settings ---------- */
function setRender(){
 const d=data,on=!!credId(),m=meta(),t=tripM();
 $("hSub").textContent=t&&m.trip.name?m.trip.name+" · "+fmtD(t.start)+" – "+fmtD(t.end):"";
 $("sSheet").textContent=m&&m.sheet||"…";$("sMe").textContent=m&&m.me||"…";$("pbOther").textContent=partner();
 $("sRate").textContent=d&&d.rate?"RM "+d.rate+" / ¥1":"-";
 $("sLeft").textContent=d?d.rowsLeft+" of "+d.rowsMax:"-";$("sLeft").style.color=d&&d.rowsLeft<=5?"var(--spend)":"";
 $("sFace").textContent=on?"On":"Off";$("faceRow").classList.toggle("tap",!on);$("lockNow").hidden=!on;}
function modal(html,acts){const m=$("modal");$("mcard").innerHTML=html;m.hidden=false;
 m.onclick=e=>{const b=e.target.closest("[data-a]");if(b){const f=acts[b.dataset.a];if(f)f();}else if(e.target===m)closeModal();};}
function closeModal(){$("modal").hidden=true;}
function busy(t){const m=$("modal");$("mcard").innerHTML=`<div class="busy"><span class="spin"></span><span>${t}</span></div>`;m.hidden=false;m.onclick=null;}
$("pairBtn").onclick=async()=>{
 const r=await api({a:"pair_new",token:token()});
 if(r.ok)modal(`<div class="k">Add another phone</div><div class="code">${esc(r.code)}</div><div class="y">Type this code on the other phone. It works for 5 minutes.</div><button class="link" data-a="x">Close</button>`,{x:closeModal});
 else if(r.err==="auth")signedOut();else toast("No connection. Try again.");};
$("signOut").onclick=()=>modal(`<div class="k">Sign out on all phones?</div><div class="y">Every phone will need to sign in again.</div><button class="link" style="color:var(--spend)" data-a="go">Sign out on all phones</button><button class="link" data-a="no">Cancel</button>`,{no:closeModal,go:async()=>{
 const r=await api({a:"signout_all",token:token()});
 if(r.ok||r.err==="auth"){closeModal();sdel("tw.token");sdel("tw.cache");sdel("tw.cred");data=null;render();lock(true);toast("Signed out on all phones");}
 else{closeModal();toast("No connection. Try again.");}}});
$("lockNow").onclick=()=>lock(false);
$("faceRow").onclick=()=>{if(credId())return;
 if(!faceOK){toast("Face ID / fingerprint is not available");return;}
 Face.create().then(id=>{sset("tw.cred",id);setRender();toast("Face ID / fingerprint is on");}).catch(()=>toast("Could not set up Face ID / fingerprint"));};

/* ---------- add sheet ---------- */
let cur="JPY",amt="",cat="food";
const last=sget("tw.last",null);if(last&&CAT[last.cat]&&(last.cur==="JPY"||last.cur==="MYR")){cat=last.cat;cur=last.cur;}
$("cats").innerHTML=KEYS.map(k=>`<button class="cat${k===cat?" on":""}" data-k="${k}">${ic(k)}${CAT[k][1]}</button>`).join("");
$("cats").onclick=e=>{const b=e.target.closest(".cat");if(!b)return;cat=b.dataset.k;[...$("cats").children].forEach(x=>x.classList.toggle("on",x===b));};
document.querySelectorAll(".chips").forEach(g=>g.onclick=e=>{const b=e.target.closest(".chip");if(!b)return;[...g.children].forEach(x=>x.classList.toggle("on",x===b));});
$("cur").onclick=e=>{const b=e.target.closest("button");if(!b)return;cur=b.dataset.c;if(cur==="JPY")amt=amt.split(".")[0];[...$("cur").children].forEach(x=>x.classList.toggle("on",x===b));show();};
function show(){const a=parseFloat(amt||"0");$("amt").textContent=(cur==="JPY"?"¥":"RM ")+(amt?(cur==="JPY"?Number(amt).toLocaleString():amt):"0");
 $("conv").textContent=cur==="JPY"?"≈ "+RM(a*rate()):"≈ ¥"+Math.round(a/rate()).toLocaleString();again($("amt"),"pop");}
function syncSheet(){[...$("cur").children].forEach(x=>x.classList.toggle("on",x.dataset.c===cur));[...$("cats").children].forEach(x=>x.classList.toggle("on",x.dataset.k===cat));show();}
$("keys").innerHTML=["7","8","9","⌫","4","5","6","00","1","2","3","Save","",".","0",""].map((k,i)=>k===""&&i===12?`<button class="fn" data-k="c">C</button>`:k===""?"":`<button data-k="${k}" class="${k==="Save"?"ok":/⌫|00/.test(k)?"fn":""}">${k}</button>`).join("");
$("keys").onclick=e=>{const k=e.target.dataset.k;if(!k)return;if(k==="Save")return save();if(k==="⌫")amt=amt.slice(0,-1);else if(k==="c")amt="";
 else if(k==="."){if(cur==="MYR"&&!amt.includes("."))amt=(amt||"0")+".";}else if(amt.length<9&&!(amt.includes(".")&&amt.split(".")[1].length>=2)&&(amt.includes(".")||amt.length+k.length<=7))amt=(amt+k).replace(/^0+(?=\d)/,"").replace(/(\.\d\d)\d+$/,"$1");show();};
function chipOn(g,f){[...document.querySelector('[data-g="'+g+'"]').children].forEach(x=>x.classList.toggle("on",f(x)));}
function openSheet(el){$("scrim").classList.add("open");el.classList.add("open");}
function openS(){edit=null;$("stitle").textContent="New expense";$("delBtn").hidden=true;$("dt").value=today();syncSheet();openSheet($("sheet"));}
function closeS(){$("scrim").classList.remove("open");$("sheet").classList.remove("open");$("sheet2").classList.remove("open");
 if(edit){edit=null;amt="";$("desc").value="";const l=sget("tw.last",null);cat=l&&CAT[l.cat]?l.cat:"food";cur=l&&(l.cur==="JPY"||l.cur==="MYR")?l.cur:"JPY";
  chipOn("pb",x=>x.dataset.p==="me");chipOn("sp",x=>x.textContent==="50/50");$("stitle").textContent="New expense";$("delBtn").hidden=true;syncSheet();}
 pBack();}
$("plus").onclick=openS;$("cancel").onclick=closeS;$("scrim").onclick=closeS;$("save2").onclick=()=>save();
[$("sheet"),$("sheet2")].forEach(sh=>{let y0=null,t0=0,dy=0;
 const down=e=>{if(e.target.closest("button"))return;y0=e.clientY;t0=e.timeStamp;dy=0;sh.style.transition="none";sh.setPointerCapture(e.pointerId);};
 sh.addEventListener("pointerdown",e=>{if(e.target.closest(".grab,.shead"))down(e);});
 sh.addEventListener("pointermove",e=>{if(y0===null)return;dy=Math.max(0,e.clientY-y0);sh.style.transform=`translateY(${dy}px)`;$("scrim").style.opacity=1-Math.min(dy/400,.8);});
 const up=e=>{if(y0===null)return;const v=dy/Math.max(1,e.timeStamp-t0);y0=null;sh.style.transition="";$("scrim").style.opacity="";
  if(dy>120||v>.6)closeS();sh.style.transform="";};
 sh.addEventListener("pointerup",up);sh.addEventListener("pointercancel",up);});
function uuid(){if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));return[...b].map(x=>x.toString(16).padStart(2,"0")).join("");}
const SPCHIP={"50/50 Split":"50/50","Exact Amount":"Only mine","100% Owed by Other":"Other pays all"};
async function save(){
 const raw=parseFloat(amt||"0"),a=cur==="JPY"?Math.round(raw):Math.round(raw*100)/100;
 if(!a){again(document.querySelector(".amount"),"shake");toast("Type an amount first");return;}
 if(a>=1e7){again(document.querySelector(".amount"),"shake");toast("Amount is too big");return;}
 const dv=$("dt").value||today();if(dv<"2026-01-01"||dv>"2027-12-31"){toast("Check the date");return;}
 const sp=document.querySelector('[data-g="sp"] .on').textContent,pb=document.querySelector('[data-g="pb"] .on').dataset.p;
 const item={date:dv,cat:CAT[cat][0],desc:$("desc").value.trim()||CAT[cat][1],cur,amt:a,paidBy:pb==="other"?"other":"me",split:sp==="50/50"?"50/50 Split":sp==="Other pays all"?"100% Owed by Other":"Exact Amount"};
 if(edit&&edit.q){const i=queue.findIndex(x=>x.id===edit.q);if(i>=0)queue[i]=Object.assign({id:edit.q},item);saveQ();closeS();toast("Saved");render();flush();return;}
 if(edit){if(wbusy)return;if(edit.other>0&&item.split==="Exact Amount"&&sp===SPCHIP["Exact Amount"])item.other=edit.other;
  wbusy=true;busy("Saving…");const r=await api(Object.assign({a:"edit",token:token(),row:edit.row,was:edit.was},item));wbusy=false;closeModal();result(r,"Updated",closeS);return;}
 queue.push(Object.assign({id:uuid()},item));
 saveQ();sset("tw.last",{cat,cur});amt="";$("desc").value="";show();closeS();toast("Saved");render();flush();}
function openEdit(key){
 const r=allRows().find(x=>x.key===key);if(!r)return;const w=r.q||r.was;
 edit=r.q?{q:r.q.id}:{row:r.row,was:r.was,other:r.other};
 cur=w.cur;cat=r.k;amt=String(w.amt);$("desc").value=w.desc;$("dt").value=w.date;
 chipOn("pb",x=>x.dataset.p===w.paidBy);chipOn("sp",x=>x.textContent===SPCHIP[w.split]);
 $("stitle").textContent="Edit expense";$("delBtn").hidden=false;syncSheet();openSheet($("sheet"));}
const tapRow=e=>{const t=e.target.closest(".tx[data-r]");if(t)openEdit(t.dataset.r);};
$("list").onclick=tapRow;$("calList").onclick=tapRow;
function confirmDel(what,go){modal(`<div class="k">Delete this ${what}?</div><button class="link" style="color:var(--spend)" data-a="go">Delete</button><button class="link" data-a="no">Cancel</button>`,{no:closeModal,go:()=>{closeModal();go();}});}
$("delBtn").onclick=()=>{const e=edit;if(!e)return;confirmDel("expense",async()=>{
 if(e.q){queue=queue.filter(x=>x.id!==e.q);saveQ();closeS();render();toast("Deleted");return;}
 if(wbusy)return;wbusy=true;busy("Deleting…");const r=await api({a:"del",token:token(),row:e.row,was:e.was});wbusy=false;closeModal();result(r,"Deleted",closeS);});};
/* one answer handler for edit, delete and pay-back writes */
function result(r,msg,done){
 if(r.ok){setCache(r);render();if(done)done();toast(msg);}
 else if(r.err==="changed"){if(done)done();toast("This item changed. List refreshed.");refresh();}
 else if(r.err==="auth")signedOut();
 else toast(r.err==="net"?"No connection. Try again.":r.err==="full"?"Sheet is full.":r.err==="rate"?"Too many tries. Wait a little.":r.err==="bad"?"Sheet refused this item":"Something went wrong. Try again.");}

/* ---------- settle sheet ---------- */
const pays=()=>data&&Array.isArray(data.pays)?data.pays:[];
function pRender(){
 const n=netv();$("pNet").textContent=n>0?partner()+" owes you":n<0?"You owe "+partner():"All settled";$("pNetV").textContent=RM(Math.abs(n));
 const ps=pays().slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))||b.row-a.row);
 $("pList").innerHTML=ps.length?ps.map(p=>`<div class="tx" data-p="${p.row}"><div class="m"><div>${esc(fmtD(String(p.date)))} · ${p.from==="me"?"You paid "+esc(partner()):esc(partner())+" paid you"}</div>${p.ref?`<small>${esc(p.ref)}</small>`:""}</div><div class="a">${p.cur==="JPY"?"¥"+Math.round(p.amt).toLocaleString():RM(p.amt)}${p.cur==="JPY"?`<small>${RM(p.myr>0?p.myr:p.amt*rate())}</small>`:""}</div></div>`).join(""):'<div class="y" style="padding:12px 16px">No pay-backs yet.</div>';
 $("pdMe").textContent="I paid "+partner();$("pdOther").textContent=partner()+" paid me";}
function pBack(){$("pForm").hidden=true;$("pView").hidden=false;$("ptitle").textContent="Settle up";pedit=null;}
function pOpen(p){pedit=p?{row:p.row,was:{date:String(p.date),from:p.from,cur:p.cur,amt:p.amt}}:null;
 $("pView").hidden=true;$("pForm").hidden=false;$("ptitle").textContent=p?"Edit return":"Return money";
 chipOn("pd",x=>!!p&&x.dataset.d===p.from);chipOn("pc",x=>x.dataset.c===(p?p.cur:"MYR"));
 $("pAmt").value=p?String(p.amt):"";$("pDt").value=p?String(p.date):today();$("pRef").value=p?p.ref:"";$("pNote").value=p?p.notes:"";$("pDel").hidden=!p;}
async function pSave(){
 if(wbusy)return;
 const de=document.querySelector('[data-g="pd"] .on');if(!de){again(document.querySelector('[data-g="pd"]'),"shake");toast("Pick who paid first");return;}
 const cu=document.querySelector('[data-g="pc"] .on').dataset.c;let a=Number(String($("pAmt").value).replace(/,/g,""));
 a=cu==="JPY"?Math.round(a):Math.round(a*100)/100;
 if(!(a>0)){toast("Type an amount first");return;}
 if(a>=1e7){toast("Amount is too big");return;}
 const dv=$("pDt").value||today();if(dv<"2026-01-01"||dv>"2027-12-31"){toast("Check the date");return;}
 const f={date:dv,from:de.dataset.d,cur:cu,amt:a,ref:$("pRef").value.trim(),notes:$("pNote").value.trim()};
 const was=pedit;wbusy=true;busy("Saving…");
 const r=await api(was?Object.assign({a:"pay_edit",token:token(),row:was.row,was:was.was},f):Object.assign({a:"pay",token:token(),id:uuid()},f));
 wbusy=false;closeModal();result(r,was?"Updated":"Return saved",pBack);}
$("oweCard").onclick=()=>{pBack();pRender();openSheet($("sheet2"));};
$("retBtn").onclick=()=>{pRender();pOpen(null);openSheet($("sheet2"));};
$("pAdd").onclick=()=>pOpen(null);$("pBack").onclick=pBack;$("pClose").onclick=closeS;$("pSave").onclick=pSave;
$("pList").onclick=e=>{const t=e.target.closest("[data-p]");if(!t)return;const p=pays().find(x=>String(x.row)===t.dataset.p);if(p)pOpen(p);};
$("pDel").onclick=()=>{const was=pedit;if(!was)return;confirmDel("pay-back",async()=>{
 if(wbusy)return;wbusy=true;busy("Deleting…");const r=await api({a:"pay_del",token:token(),row:was.row,was:was.was});wbusy=false;closeModal();result(r,"Deleted",pBack);});};

/* ---------- queue ---------- */
let fullStop=false;
function setCache(r){data={ok:true,rows:r.rows,rowsLeft:r.rowsLeft,rowsMax:r.rowsMax,rate:r.rate,summary:r.summary,pays:r.pays||[],meta:r.meta||null};sset("tw.cache",data);}
function signedOut(msg){sdel("tw.token");closeModal();closeS();render();lock(true);toast(msg||"Please sign in again");}
async function flush(){
 if(sending||fullStop||!queue.length||!token())return;
 sending=true;pill();
 try{
  while(queue.length){
   const it=queue[0],p={a:"add",token:token(),id:it.id,date:it.date,cat:it.cat,desc:it.desc,cur:it.cur,amt:it.amt,paidBy:it.paidBy,split:it.split};
   if(it.other!=null)p.other=it.other;
   const r=await api(p);
   if(r.ok){queue.shift();saveQ();setCache(r);render();toast("Added to your sheet");}
   else if(r.err==="auth"){signedOut();break;}
   else if(r.err==="bad"){queue.shift();saveQ();render();toast("Sheet refused this item");}
   else if(r.err==="full"){fullStop=true;toast("Sheet is full.");break;}
   else break;
  }
 }finally{sending=false;pill();}
}
async function refresh(){
 if(!token())return;
 const r=await api({a:"list",token:token()});
 if(r.ok){setCache(r);render();}else if(r.err==="auth")signedOut();}
function afterOpen(){fullStop=false;setRender();flush().then(refresh);}
window.addEventListener("online",()=>{flush().then(refresh);});
setInterval(()=>{if(queue.length)flush();},30000);
let hiddenAt=0;
document.addEventListener("visibilitychange",()=>{
 if(document.hidden){hiddenAt=Date.now();return;}
 if(credId()&&token()&&$("lock").hidden&&hiddenAt&&Date.now()-hiddenAt>60000){lock(false);return;}
 if($("lock").hidden)flush().then(refresh);else flush();});

/* ---------- Face ID / fingerprint (local lock only) ---------- */
const b64u=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const unb64u=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const rnd=n=>crypto.getRandomValues(new Uint8Array(n));
const Face=MOCK?{
 supported:async()=>true,
 create:async()=>{await sleep(600);if(window.__mock.face==="fail")throw new Error("face");return"mock-cred";},
 verify:async()=>{await sleep(600);if(window.__mock.face==="fail")throw new Error("face");}
}:{
 supported:async()=>{try{return!!(window.PublicKeyCredential&&navigator.credentials&&await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());}catch(_){return false;}},
 create:async()=>{const c=await navigator.credentials.create({publicKey:{rp:{name:"Trip Wallet"},user:{id:rnd(16),name:"Trip Wallet",displayName:"Trip Wallet"},challenge:rnd(32),pubKeyCredParams:[{type:"public-key",alg:-7},{type:"public-key",alg:-257}],authenticatorSelection:{authenticatorAttachment:"platform",userVerification:"required",residentKey:"preferred"},timeout:60000}});if(!c)throw new Error("none");return b64u(c.rawId);},
 verify:async()=>{const c=await navigator.credentials.get({publicKey:{challenge:rnd(32),allowCredentials:[{type:"public-key",id:unb64u(credId())}],userVerification:"required",timeout:60000}});if(!c)throw new Error("none");}
};
let faceOK=false,faceMode="unlock";Face.supported().then(v=>{faceOK=v;});
const FACE=$("faceSvg").innerHTML,CHECK='<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 9.8"/>';
function step(id){["stepG","stepF"].forEach(s=>$(s).hidden=s!==id);again($(id),"step");if(id==="stepG")ensureG();}
function lock(signedOutMode){const L=$("lock");L.hidden=false;void L.offsetWidth;L.classList.remove("gone");
 $("faceSvg").innerHTML=FACE;$("face").className="face";$("stepF").classList.remove("done");$("stepF").querySelector("h2").textContent="Trip Wallet is locked";$("stepF").querySelector(".sub").textContent="Tap to unlock with Face ID / fingerprint";$("faceBtn").hidden=false;faceMode="unlock";$("faceBtn").textContent="Unlock";$("faceAlt").hidden=false;$("faceNot").hidden=true;
 resetG();step(signedOutMode?"stepG":"stepF");}
function tick(){const f=$("face");$("faceSvg").innerHTML=CHECK;f.className="face ok";$("stepF").classList.add("done");$("stepF").querySelector("h2").textContent="Unlocked";setTimeout(openApp,420);}
function openApp(){const L=$("lock");L.classList.add("gone");setTimeout(()=>{L.hidden=true;enter($("v-home"));},500);afterOpen();}
let unlocking=false;
async function unlock(){if(unlocking)return;unlocking=true;const f=$("face");f.className="face scan";
 try{await Face.verify();tick();}catch(_){f.className="face";again(f,"shake");}
 unlocking=false;}
function enableFace(){const f=$("face");if(f.className==="face scan")return;f.className="face scan";
 Face.create().then(id=>{sset("tw.cred",id);tick();}).catch(()=>{f.className="face";again(f,"shake");toast("Could not set up Face ID / fingerprint");});}
$("face").onclick=$("faceBtn").onclick=()=>faceMode==="setup"?enableFace():unlock();
$("faceNot").onclick=openApp;
$("faceAlt").onclick=()=>{sdel("tw.cred");sdel("tw.token");lock(true);};

/* ---------- sign-in ---------- */
const GLOGO=$("gbtn").firstChild;
function setBusy(){const b=$("gbtn");b.disabled=true;$("codeGo").disabled=true;$("gover").hidden=true;const s=document.createElement("span");s.className="spin";if(GLOGO.parentNode===b)GLOGO.replaceWith(s);b.lastChild.textContent="Signing in…";}
function resetG(){const b=$("gbtn");b.disabled=false;$("codeGo").disabled=false;$("gover").hidden=false;const sp=b.querySelector(".spin");if(sp)sp.replaceWith(GLOGO);b.lastChild.textContent="Sign in with Google";}
let gLoading=false,gInit=false;
function ensureG(){
 if(MOCK)return;
 if(window.google&&google.accounts&&google.accounts.id){gRender();return;}
 if(gLoading)return;gLoading=true;
 const s=document.createElement("script");s.src="https://accounts.google.com/gsi/client";s.async=true;
 s.onload=()=>{gLoading=false;gRender();};s.onerror=()=>{gLoading=false;s.remove();};document.head.appendChild(s);}
function gRender(){
 if(!gInit){google.accounts.id.initialize({client_id:CFG.CLIENT_ID,callback:r=>onCred(r&&r.credential),ux_mode:"popup",auto_select:false,use_fedcm_for_prompt:true});gInit=true;}
 const o=$("gover");o.innerHTML="";
 google.accounts.id.renderButton(o,{type:"standard",theme:"outline",size:"large",shape:"pill",text:"signin_with",width:Math.round(Math.min(400,Math.max(200,$("gbtn").offsetWidth||320)))});}
$("gbtn").onclick=()=>{if(MOCK)return onCred("mock-id-token");toast("No connection. Try again.");ensureG();};
async function onCred(idToken){
 if(!idToken)return;
 setBusy();
 handleSignIn(await api({a:"signin",idToken}),"This Google account cannot use this app");}
async function handleSignIn(r,authMsg){
 if(r.ok&&typeof r.token==="string"){sset("tw.token",r.token);afterSignIn();return;}
 resetG();
 toast(r.err==="net"?"No connection. Try again.":r.err==="auth"?authMsg:r.err==="rate"?"Too many tries. Wait a little.":r.err==="server"?"Google is busy. Try again.":"Something went wrong. Try again.");}
function afterSignIn(){
 if(credId()||!faceOK){openApp();return;}
 faceMode="setup";step("stepF");$("faceSvg").innerHTML=FACE;$("face").className="face";$("stepF").classList.remove("done");
 $("stepF").querySelector("h2").textContent="Turn on Face ID / fingerprint?";$("stepF").querySelector(".sub").textContent="Lock the app each time you open it";
 $("faceBtn").hidden=false;$("faceBtn").textContent="Turn on";$("faceAlt").hidden=true;$("faceNot").hidden=false;}
$("codeLink").onclick=()=>{const b=$("codeBox");b.hidden=!b.hidden;if(!b.hidden)$("codeIn").focus();};
$("codeIn").addEventListener("input",()=>{$("codeIn").value=$("codeIn").value.toUpperCase().replace(/[^A-Z0-9]/g,"");});
$("codeGo").onclick=async()=>{const c=$("codeIn").value.trim();if(c.length<8){toast("Type the 8-character code");return;}
 setBusy();handleSignIn(await api({a:"pair",code:c}),"That code did not work");};

/* ---------- mock transport (same actions and rules as backend/Code.gs; ?as=other signs in as the second person) ---------- */
const MRATE=0.0264,MCATS=["Hotel / Accommodation","Flights & Passes","Food & Dining","Transit & Trains","Tickets & Attractions","Shopping","Other"],MSPL=["50/50 Split","Exact Amount","100% Owed by Other"];
const MU=QS.get("as")==="other"?1:0,MNAMES=["Alex","Sam"],MTRIP="2026-11-24";
let mockEpoch=0;
const mText=v=>String(v==null?"":v).replace(/[\u0000-\u001f]/g," ").replace(/^[\s=+\-@]+/,"").trim().slice(0,200);
const mDateOk=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>="2026-01-01"&&d<="2027-12-31"&&!isNaN(Date.parse(d+"T00:00:00Z"));
const mAmt=(v,cur)=>{let a=Number(v);if(!isFinite(a)||a<=0||a>=10000000)return 0;a=cur==="JPY"?Math.round(a):Math.round(a*100)/100;return a>0?a:0;};
const mPaid=r=>r.p===MU?"me":"other";
const mTol=(a,b)=>Math.abs(a-Number(b))<.005;
function mShares(cur,amt,p,split,other){/* row currency, absolute payers: s0 = payer 0 share, s1 = payer 1 share */
 let s0,s1;
 if(split==="50/50 Split"){s0=s1=amt/2;}
 else if(split==="100% Owed by Other"){if(p===0){s1=amt;s0=0;}else{s0=amt;s1=0;}}
 else{const o=other||0;if(p===0){s1=o;s0=amt-o;}else{s0=o;s1=amt-o;}}
 return{s0,s1,owed:p===0?s1:-s0};}
const mRow=(x,p,other,id)=>({date:x.date,cat:x.cat,desc:x.desc,cur:x.cur,amt:x.amt,p,split:x.split,other:other==null?null:other,status:x.split==="Exact Amount"&&!other?"":"Unpaid",notes:"",id});
function mExp(p){
 const date=String(p.date||""),cur=p.cur,split=p.split,desc=mText(p.desc);
 if(!mDateOk(date)||MCATS.indexOf(p.cat)<0||["JPY","MYR"].indexOf(cur)<0||["me","other"].indexOf(p.paidBy)<0||MSPL.indexOf(split)<0||!desc)return null;
 const amt=mAmt(p.amt,cur);if(!amt)return null;let other=null;
 if(split==="Exact Amount"&&p.other!=null&&p.other!==""){other=Number(p.other);if(!isFinite(other)||other<0||other>amt)return null;}
 return{date,cat:p.cat,desc,cur,amt,split,other,p:p.paidBy==="me"?MU:1-MU};}
function mPay(p){
 const date=String(p.date||""),cur=p.cur;
 if(!mDateOk(date)||["me","other"].indexOf(p.from)<0||["JPY","MYR"].indexOf(cur)<0)return null;
 const amt=mAmt(p.amt,cur);return amt?{date,cur,amt,p:p.from==="me"?MU:1-MU,ref:mText(p.ref),notes:mText(p.notes)}:null;}
const mHit=(r,w)=>r.date===String(w.date)&&r.cat===w.cat&&r.desc===String(w.desc)&&r.cur===w.cur&&mTol(r.amt,w.amt)&&mPaid(r)===w.paidBy&&r.split===w.split;
const mPayHit=(r,w)=>r.date===String(w.date)&&r.cur===w.cur&&mTol(r.amt,w.amt)&&mPaid(r)===w.from;
const mMyr=r=>r.cur==="JPY"?Math.round(r.amt*MRATE*100)/100:r.amt;
function mList(){
 const m=window.__mock,u=MU,sg=u?-1:1;let total=0,t0=0,t1=0,N=0,n=0;const rows=[],pays=[];
 m.rows.forEach((r,i)=>{if(!r)return;n++;const s=mShares(r.cur,r.amt,r.p,r.split,r.other),f=r.cur==="JPY"?MRATE:1;
  total+=r.amt*f;t0+=s.s0*f;t1+=s.s1*f;if(r.status!=="Settled")N+=s.owed*f;
  rows.push({row:5+i,date:r.date,stage:r.date>=MTRIP?"On-Trip":"Pre-Trip",cat:r.cat,desc:r.desc,cur:r.cur,amt:r.amt,paidBy:mPaid(r),split:r.split,other:r.other,meShare:u?s.s1:s.s0,otherShare:u?s.s0:s.s1,owed:sg*s.owed,status:r.status,notes:r.notes});});
 m.pays.forEach((r,i)=>{if(!r)return;N+=r.p===0?mMyr(r):-mMyr(r);pays.push({row:5+i,date:r.date,from:mPaid(r),cur:r.cur,amt:r.amt,myr:mMyr(r),ref:r.ref,notes:r.notes});});
 return JSON.parse(JSON.stringify({ok:true,rows,pays,rowsLeft:96-n,rowsMax:96,meta:{sheet:"Demo Sheet",me:MNAMES[u],other:MNAMES[1-u],trip:{name:"Testville",start:MTRIP,end:"2026-12-04"}},rate:MRATE,summary:{total,meShare:u?t1:t0,otherShare:u?t0:t1,net:sg*N}}));}
if(MOCK){
 window.__mock={rows:[],pays:[],deleted:[],fail:null,face:null,codes:[]};
 [["2026-10-29","Hotel / Accommodation","City hotel","MYR",579,"50/50 Split",0],["2026-11-05","Hotel / Accommodation","Mountain lodge","MYR",3367.70,"50/50 Split",0],["2026-10-29","Hotel / Accommodation","Airport hotel","MYR",1164.49,"50/50 Split",0],["2026-09-25","Tickets & Attractions","Theme park tickets","MYR",1931.70,"50/50 Split",1],["2026-11-21","Transit & Trains","Rail pass","MYR",86.10,"Exact Amount",0],["2026-11-21","Transit & Trains","Transit card top-up","JPY",13800,"Exact Amount",0],["2026-11-21","Other","Travel insurance","MYR",202.37,"Exact Amount",0]]
  .forEach((x,i)=>window.__mock.rows.push(mRow({date:x[0],cat:x[1],desc:x[2],cur:x[3],amt:x[4],split:x[5]},x[6],null,"seed-"+i)));
 window.__mock.pays.push({id:"seedpay-0",date:"2026-11-24",p:1,cur:"MYR",amt:1504.80,ref:"Hotel + USJ",notes:""},{id:"seedpay-1",date:"2026-11-15",p:1,cur:"MYR",amt:2016.65,ref:"",notes:""});
}
const mAuth=t=>typeof t==="string"&&t.length===64&&t[0]==="m"&&t[1]===String(mockEpoch%10);
const mTok=()=>"m"+(mockEpoch%10)+[...rnd(31)].map(x=>x.toString(16).padStart(2,"0")).join("");
const mBad={ok:false,err:"bad"},mChanged={ok:false,err:"changed"},mFull={ok:false,err:"full"};
const mRowOk=p=>Number.isInteger(p.row)&&p.row>=5&&p.row<=3000&&p.was&&typeof p.was==="object";
const mSlot=(a,full)=>{let i=a.findIndex(r=>!r);if(i<0){if(full||a.length>=96)return-1;i=a.length;}return i;};
async function mockApi(p){
 await sleep(80);const m=window.__mock;
 if(m.fail==="network")throw new Error("net");
 if(p.a==="signin")return typeof p.idToken==="string"&&p.idToken&&p.idToken.length<=4096?{ok:true,token:mTok()}:{ok:false,err:"auth"};
 if(p.a==="pair"){const code=String(p.code||"").toUpperCase().replace(/[^A-Z0-9]/g,"");const i=m.codes.indexOf(code);
  if(code.length!==8||i<0)return{ok:false,err:"auth"};m.codes.splice(i,1);return{ok:true,token:mTok()};}
 if(!mAuth(p.token)||m.fail==="auth")return{ok:false,err:"auth"};
 if(p.a==="list")return mList();
 if(p.a==="pair_new"){const A="ABCDEFGHJKMNPQRSTUVWXYZ23456789";let c="";for(const x of rnd(8))c+=A[x%A.length];m.codes.push(c);return{ok:true,code:c};}
 if(p.a==="signout_all"){mockEpoch++;return{ok:true};}
 if(p.a==="add"){
  const x=mExp(p),id=String(p.id||"");if(!x||!/^[A-Za-z0-9-]{8,64}$/.test(id))return mBad;
  const seen=m.rows.findIndex(r=>r&&r.id===id);
  if(seen>=0)return Object.assign(mList(),{row:5+seen,dup:true});
  const i=mSlot(m.rows,m.fail==="full");if(i<0)return mFull;
  m.rows[i]=mRow(x,x.p,x.other,id);return Object.assign(mList(),{row:5+i});}
 if(p.a==="edit"){
  const x=mExp(p);if(!x||!mRowOk(p))return mBad;
  const r=m.rows[p.row-5];if(!r||!mHit(r,p.was))return mChanged;
  Object.assign(r,{date:x.date,cat:x.cat,desc:x.desc,cur:x.cur,amt:x.amt,p:x.p,split:x.split,other:x.other,status:x.split==="Exact Amount"&&!x.other?"":r.status||"Unpaid"});
  return Object.assign(mList(),{row:p.row});}
 if(p.a==="del"){
  if(!mRowOk(p))return mBad;
  const r=m.rows[p.row-5];if(!r||!mHit(r,p.was))return mChanged;
  m.deleted.push(Object.assign({by:MNAMES[MU],tab:"Expense Log",row:p.row},r));m.rows[p.row-5]=null;return mList();}
 if(p.a==="pay"){
  const x=mPay(p),id=String(p.id||"");if(!x||!/^[A-Za-z0-9-]{8,64}$/.test(id))return mBad;
  const seen=m.pays.findIndex(r=>r&&r.id===id);
  if(seen>=0)return Object.assign(mList(),{row:5+seen,dup:true});
  const i=mSlot(m.pays,m.fail==="full");if(i<0)return mFull;
  m.pays[i]=Object.assign(x,{id});return Object.assign(mList(),{row:5+i});}
 if(p.a==="pay_edit"){
  const x=mPay(p);if(!x||!mRowOk(p))return mBad;
  const r=m.pays[p.row-5];if(!r||!mPayHit(r,p.was))return mChanged;
  Object.assign(r,x);return Object.assign(mList(),{row:p.row});}
 if(p.a==="pay_del"){
  if(!mRowOk(p))return mBad;
  const r=m.pays[p.row-5];if(!r||!mPayHit(r,p.was))return mChanged;
  m.deleted.push(Object.assign({by:MNAMES[MU],tab:"Settlements & Transfers",row:p.row},r));m.pays[p.row-5]=null;return mList();}
 return mBad;}

/* ---------- boot ---------- */
if("serviceWorker"in navigator&&/^https?:$/.test(location.protocol))navigator.serviceWorker.register("./sw.js").catch(()=>{});
show();render();
if(!token())lock(true);
else if(credId())lock(false);
else{$("lock").hidden=true;enter($("v-home"));afterOpen();}
})();
