(function(){
"use strict";

/* ============ basics ============ */
var $ = function(s, r){ return (r||document).querySelector(s) };
var $$ = function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)) };
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]}) }
function fmtDate(ms, withTime){ if(!ms) return "—"; var d=new Date(ms); var s=d.toLocaleDateString(undefined,{day:"numeric",month:"short",year: (new Date().getFullYear()!==d.getFullYear())?"numeric":undefined}); return withTime? s+" "+d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"}) : s }
function pct(a,b){ return b? Math.round(100*a/b)+"%" : "—" }
function slugify(s){ return String(s||"").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40) }
function store(k,v){ try{ if(v===undefined) return localStorage.getItem(k); localStorage.setItem(k,v) }catch(e){ return null } }
var ACCENTS = [["moss","Sage"],["brass","Sand"],["oxblood","Coral"],["plum","Lilac"],["slate","Blue"]];
var TEMPLATES = {
  waitlist:{name:"Waitlist", blurb:"Big headline, one line, signup."},
  launch:{name:"Launch page", blurb:"Headline, selling points, signup."},
  links:{name:"Link hub", blurb:"Link-in-bio list plus signup."},
  post:{name:"Journal post", blurb:"Written post, listed under Journal."}
};

var S = { me:null, cleanup:[] };
var VERSION = "202610072345";

function api(method, path, body){
  var opt = { method: method, headers: {} };
  if(body !== undefined){ opt.headers["content-type"]="application/json"; opt.body=JSON.stringify(body) }
  return fetch("/api/"+path, opt).then(function(r){
    var ct = r.headers.get("content-type")||"";
    if(ct.indexOf("application/json")<0){ return r.text().then(function(t){ if(!r.ok) throw new Error("The server answered with an error ("+r.status+")."); return t }) }
    return r.json().then(function(d){ if(r.status===401){ location.href="/login"; throw new Error(d.error||"Signed out") } if(!r.ok) throw new Error(d.error || "That didn’t work."); return d });
  }, function(){ throw new Error("Couldn’t reach Studio. Check your connection and try again.") });
}

var toastTimer;
function toast(msg, err){
  var t=$("#toast"); t.textContent=msg; t.className="toast"+(err?" err":""); t.hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(function(){ t.hidden=true }, err?6000:2600);
}

/** Debounced autosave with a status label. */
function saver(el, fn, delay){
  var timer=null, pending=null, busy=false;
  function show(state, msg){ if(!el) return; el.className="saving"+(state==="ok"?" ok":state==="err"?" err":""); el.textContent=msg }
  function flush(){
    if(busy || pending===null) return;
    var data=pending; pending=null; busy=true; show("", "Saving…");
    Promise.resolve(fn(data)).then(function(){ busy=false; if(pending!==null) flush(); else show("ok","Saved") })
      .catch(function(e){ busy=false; show("err", e.message) });
  }
  var s = function(data){ pending = Object.assign(pending||{}, data); show("", "Unsaved"); clearTimeout(timer); timer=setTimeout(flush, delay||700) };
  s.now = function(){ clearTimeout(timer); flush() };
  S.cleanup.push(function(){ clearTimeout(timer); flush() });
  return s;
}

/* ============ theme ============ */
function currentTheme(){ var a=document.documentElement.getAttribute("data-theme"); if(a==="light"||a==="dark") return a; return (window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light" }
function applyTheme(t){
  if(t==="light"||t==="dark") document.documentElement.setAttribute("data-theme",t); else document.documentElement.removeAttribute("data-theme");
  store("studio.theme", t||"auto");
  var b=$("#themeBtn"); if(b) b.setAttribute("aria-label", currentTheme()==="dark"?"Switch to light mode":"Switch to dark mode");
}
applyTheme(store("studio.theme")||"auto");
$("#themeBtn").addEventListener("click", function(){ applyTheme(currentTheme()==="dark"?"light":"dark") });

/* ============ sidebar ============ */
function refreshNav(){
  api("GET","review/count").then(function(d){ var el=$("#navReview"); if(el) el.textContent=d.n||"" }).catch(function(){});
  return Promise.all([api("GET","sites"), api("GET","overview"), api("GET","campaigns"), api("GET","sequences")]).then(function(r){
    S.sites=r[0].sites;
    $("#navSites").innerHTML=r[0].sites.map(function(s){ return '<a class="site" href="#/sites/'+esc(s.id)+'" data-site="'+esc(s.id)+'" style="--sw:var(--s-'+esc(s.accent)+')"><i></i><span>'+esc(s.name)+'</span></a>' }).join("");
    $("#navContacts").textContent = r[1].counts.subscribed || "";
    var drafts=r[2].campaigns.filter(function(c){return c.status==="draft"}).length;
    $("#navEmails").textContent = drafts ? drafts+" draft"+(drafts===1?"":"s") : "";
    var onCount=r[3].sequences.filter(function(q){return q.status==="active"}).length;
    $("#navAuto").textContent = onCount ? onCount+" on" : "";
    markNav();
  }).catch(function(){});
}
function checkVersion(){
  api("GET","me").then(function(me){
    if(me.version && me.version!==VERSION && !$("#updBar")){
      var d=document.createElement("div"); d.id="updBar"; d.className="notice updbar";
      d.innerHTML='<p><b>Studio has been updated.</b> Reload to get the latest version.</p><button class="btn sm primary" type="button">Reload</button>';
      d.querySelector("button").onclick=function(){ location.reload() };
      document.body.appendChild(d);
    }
  }).catch(function(){});
}
setInterval(checkVersion, 5*60*1000);
document.addEventListener("visibilitychange", function(){ if(!document.hidden) checkVersion() });
function markNav(){
  var parts=(location.hash.replace(/^#\/?/,"").split("?")[0]||"").split("/").filter(Boolean), top=parts[0]||"overview";
  $$("[data-nav]").forEach(function(a){ a.setAttribute("aria-current", a.dataset.nav===top && !(top==="sites"&&parts[1]&&parts[1]!=="new") ? "page" : "false") });
  $$("[data-site]").forEach(function(a){ a.setAttribute("aria-current", top==="sites"&&parts[1]===a.dataset.site ? "page" : "false") });
}

/* ============ router ============ */
function route(){
  S.cleanup.forEach(function(f){ try{f()}catch(e){} }); S.cleanup=[];
  var parts = (location.hash.replace(/^#\/?/,"").split("?")[0]||"").split("/").filter(Boolean);
  var top = parts[0]||"overview";
  markNav();
  var v=$("#view"); v.innerHTML='<div class="loading">Loading…</div>';
  var p;
  if(top==="overview") p=overview();
  else if(top==="calendar") p=calendarView();
  else if(top==="sites" && parts[1]==="new") p=sitesView(true);
  else if(top==="sites" && parts[1]) p=siteView(parts[1], parts[2]||"pages", parts[3]);
  else if(top==="sites") p=sitesView();
  else if(top==="contacts") p=contactsView(parts[1]);
  else if(top==="forms" && parts[1]) p=formView(parts[1], parts[2]);
  else if(top==="forms") p=formsView();
  else if(top==="emails" && parts[1]) p=emailView(parts[1]);
  else if(top==="emails") p=emailsView();
  else if(top==="automations" && parts[1]) p=automationView(parts[1], parts[2]);
  else if(top==="automations") p=automationsView();
  else if(top==="files") p=filesView(parts[1]===undefined?null:(parts[1]==="_"?"":decodeURIComponent(parts[1])));
  else if(top==="social" && parts[1]==="p" && parts[2]) p=socialPostView(parts[2]);
  else if(top==="social" && parts[1]==="b" && parts[2] && parts[3]==="brief") p=briefView(parts[2]);
  else if(top==="review") p=reviewView();
  else if(top==="campaigns" && parts[1]) p=campaignView(parts[1]);
  else if(top==="campaigns") p=campaignsView();
  else if(top==="social") p=socialView(parts[1]==="b"?parts[2]:null);
  else if(top==="settings") p=settingsView();
  else p=Promise.resolve(v.innerHTML='<div class="empty"><b>Page not found</b><a href="#/">Go to the overview</a></div>');
  Promise.resolve(p).catch(function(e){ v.innerHTML='<div class="notice danger"><p>'+esc(e.message)+'</p><button class="btn sm" type="button" onclick="location.reload()">Reload</button></div>' });
  window.scrollTo(0,0);
}
window.addEventListener("hashchange", route);
function go(h){ if(location.hash===h) route(); else location.hash=h }

function head(eyebrow, title, sub, actions){
  return '<div class="pagehead"><div>'+(eyebrow?'<span class="eyebrow">'+eyebrow+'</span>':'')+'<h1>'+esc(title)+'</h1>'+(sub?'<p class="sub">'+sub+'</p>':'')+'</div>'+(actions?'<div class="actions">'+actions+'</div>':'')+'</div>';
}
function hostOf(site){ return site.subdomain+"."+S.me.root }
function siteUrl(site, slug){ return "https://"+hostOf(site)+"/"+(slug||"") }
function emailBanner(){
  if(S.me.emailConnected) return "";
  return '<div class="notice"><p><b>Email isn’t connected yet.</b> Pages and signups work; campaigns and welcome emails will send once your Resend key is added at go-live.</p><a class="btn sm" href="#/settings">Settings</a></div>';
}

/* ============ overview ============ */
function chart(days){
  var W=560,H=150,pad=22,bw=(W-pad)/days.length, max=Math.max(4, Math.max.apply(null,days));
  var step = max<=4?1: max<=10?2: Math.ceil(max/4);
  var top = Math.ceil(max/step)*step, y=function(v){ return 10+(H-34)*(1-v/top) };
  var s='<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Signups per day, last 30 days">';
  for(var g=0; g<=top; g+=step){ s+='<line class="grid" x1="'+pad+'" x2="'+W+'" y1="'+y(g)+'" y2="'+y(g)+'"/><text x="'+(pad-6)+'" y="'+(y(g)+3)+'" text-anchor="end">'+g+'</text>' }
  days.forEach(function(n,i){ if(n>0){ var x=pad+i*bw+1.5; s+='<rect class="bar'+(i===days.length-1?" today":"")+'" x="'+x+'" y="'+y(n)+'" width="'+Math.max(2,bw-3)+'" height="'+(y(0)-y(n))+'"><title>'+n+' signup'+(n===1?"":"s")+'</title></rect>' } });
  s+='<line class="axis" x1="'+pad+'" x2="'+W+'" y1="'+y(0)+'" y2="'+y(0)+'"/>';
  s+='<text x="'+pad+'" y="'+(H-6)+'">30 days ago</text><text x="'+W+'" y="'+(H-6)+'" text-anchor="end">Today</text></svg>';
  return s;
}
function overview(){
  return api("GET","overview").then(function(d){
    var c=d.counts, v=$("#view");
    var total30 = d.signups.reduce(function(a,b){return a+b},0);
    var hr=new Date().getHours(), greet = hr<5?"Up late":hr<12?"Good morning":hr<18?"Good afternoon":"Good evening";
    var html = head(esc(new Date().toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"})), greet+", Aisling", "", '<a class="btn" href="#/emails">Write an email</a><a class="btn primary" href="#/sites/new">New site</a>');
    html += emailBanner();
    html += '<section class="figures" aria-label="Key numbers">'+
      '<div class="fig"><span>Subscribers</span><b>'+c.subscribed+'</b><small>'+c.contacts+' contacts in total</small></div>'+
      '<div class="fig"><span>New · 30 days</span><b>'+c.new30+'</b><small>signups this month</small></div>'+
      '<div class="fig"><span>Pages live</span><b>'+c.pages_live+'</b><small>across '+c.sites+' site'+(c.sites===1?'':'s')+'</small></div>'+
      '<div class="fig"><span>Page views</span><b>'+c.views.toLocaleString()+'</b><small>all time</small></div></section>';
    if(!c.sites){
      html += '<div class="empty"><b>Start with a site</b>Each idea gets its own address on '+esc(S.me.root)+'. <p><a class="btn primary" href="#/sites">Create your first site</a></p></div>';
      v.innerHTML=html; return;
    }
    html += '<div class="grid2"><div class="stack"><section class="panel"><h2 class="sec">Signups <span class="hint">'+total30+' in the last 30 days</span></h2><div class="pad">'+chart(d.signups)+'</div></section>'+
      '<section class="panel"><h2 class="sec">Latest signups <a class="btn ghost sm" href="#/contacts">View all</a></h2>'+
      (d.recent.length ? '<div class="tablewrap"><table><thead><tr><th>Who</th><th>From</th><th class="r">When</th></tr></thead><tbody>'+
        d.recent.map(function(r){ return '<tr><td>'+esc(r.name||r.email)+(r.name?'<span class="sub">'+esc(r.email)+'</span>':'')+'</td><td class="mono">'+esc(r.source||"—")+'</td><td class="r mono">'+fmtDate(r.created_at)+'</td></tr>' }).join("")+'</tbody></table></div>'
        : '<div class="empty">No signups yet. Publish a page and share the link.</div>')+
      '</section></div><div class="stack"><section class="panel"><h2 class="sec">Top pages <span class="hint">By views</span></h2>'+
      (d.top.length ? '<div class="rows">'+d.top.map(function(p){ return '<div class="rowi" style="--pc:var(--'+esc(p.accent)+')"><span class="t">'+esc(p.title)+'<small>'+esc(p.subdomain)+'.'+esc(S.me.root)+'/'+esc(p.slug)+'</small></span><span class="meta num">'+p.views+' view'+(p.views===1?'':'s')+'</span></div>' }).join("")+'</div>'
        : '<div class="empty">Nothing published yet.</div>')+
      '</section><section class="panel"><h2 class="sec">Emails <a class="btn ghost sm" href="#/emails">View all</a></h2>'+
      (d.campaigns.length ? '<div class="rows">'+d.campaigns.map(function(cp){
          var st=cp.stats||{}; var meta = cp.status==="draft" ? '' : (st.sent||0)+' sent · '+pct(st.opened||0, st.sent||0)+' opened';
          return '<a class="rowi nosq" href="#/emails/'+esc(cp.id)+'"><span class="t">'+esc(cp.name)+'<small>'+esc(cp.subject||"No subject yet")+'</small></span><span class="meta"><span>'+meta+'</span><span class="chip '+esc(cp.status)+'">'+esc(cp.status)+'</span></span></a>' }).join("")+'</div>'
        : '<div class="empty">No emails yet.</div>')+
      '</section></div></div>';
    v.innerHTML=html;
  });
}

/* ============ sites ============ */
function swatches(current, name){
  return '<div class="swatches" role="group" aria-label="Colour">'+ACCENTS.map(function(a){ return '<button type="button" data-'+name+'="'+a[0]+'" style="--sw:var(--'+a[0]+')" aria-label="'+a[1]+'" title="'+a[1]+'" aria-pressed="'+(a[0]===current)+'"></button>' }).join("")+'</div>';
}
function sitesView(openNew){
  return api("GET","sites").then(function(d){
    var v=$("#view"), accent="brass";
    function render(showNew){
      var html = head("Your ideas", "Sites", "Each site lives at its own address. It goes live the moment you switch a page on.", '<button class="btn primary" type="button" id="newSite">New site</button>');
      if(showNew){
        html += '<form class="sheet" id="siteForm"><h3>New site</h3><div class="fieldrow">'+
          '<div class="field"><label for="sfName">Name</label><input type="text" id="sfName" required maxlength="60" placeholder="e.g. Seek"></div>'+
          '<div class="field"><label for="sfSub">Address</label><div class="affix"><input type="text" id="sfSub" maxlength="30" placeholder="seek"><span>.'+esc(S.me.root)+'</span></div></div></div>'+
          '<div class="field"><span class="label">Colour</span>'+swatches(accent,"acc")+'</div>'+
          '<div class="actions"><button class="btn primary" type="submit">Create site</button><button class="btn ghost" type="button" id="cancelSite">Cancel</button></div></form>';
      }
      if(!d.sites.length && !showNew) html += '<div class="empty"><b>No sites yet</b>Create one for each idea you want to put in front of people.</div>';
      else if(d.sites.length) html += '<div class="rows">'+d.sites.map(function(s){
        return '<a class="rowi" href="#/sites/'+esc(s.id)+'" style="--pc:var(--'+esc(s.accent)+')"><span class="t">'+esc(s.name)+'<small>'+esc(hostOf(s))+'</small></span>'+
          '<span class="meta"><span class="num">'+s.pages_live+'/'+s.pages+' pages live</span><span class="num">'+s.signups+' signups</span><span class="num">'+s.views+' views</span><span class="chip '+esc(s.status)+'">'+esc(s.status)+'</span></span></a>' }).join("")+'</div>';
      v.innerHTML=html;
      $("#newSite").onclick=function(){ render(true); $("#sfName").focus() };
      if(showNew){
        var touched=false;
        $("#sfName").oninput=function(){ if(!touched) $("#sfSub").value=slugify(this.value) };
        $("#sfSub").oninput=function(){ touched=true };
        $("#cancelSite").onclick=function(){ render(false) };
        $$("[data-acc]").forEach(function(b){ b.onclick=function(){ accent=b.dataset.acc; $$("[data-acc]").forEach(function(x){ x.setAttribute("aria-pressed", String(x===b)) }) } });
        $("#siteForm").onsubmit=function(e){ e.preventDefault();
          var btn=this.querySelector("[type=submit]"); btn.disabled=true;
          api("POST","sites",{ name:$("#sfName").value, subdomain:$("#sfSub").value, accent:accent }).then(function(r){ toast("Site created"); refreshNav(); go("#/sites/"+r.site.id) })
            .catch(function(e){ btn.disabled=false; toast(e.message,true) });
        };
      }
    }
    render(openNew || !d.sites.length);
  });
}

function pageFields(tpl, c, page){
  var f = function(id, label, key, max, hint, ph){ return '<div class="field"><label for="'+id+'">'+label+'</label><input type="text" id="'+id+'" data-c="'+key+'" maxlength="'+max+'" value="'+esc(c[key]||"")+'"'+(ph?' placeholder="'+esc(ph)+'"':'')+'>'+(hint?'<span class="hint">'+hint+'</span>':'')+'</div>' };
  var ta = function(id, label, key, hint, cls){ return '<div class="field"><label for="'+id+'">'+label+'</label><textarea id="'+id+'" data-c="'+key+'"'+(cls?' class="'+cls+'"':'')+'>'+esc(c[key]||"")+'</textarea>'+(hint?'<span class="hint">'+hint+'</span>':'')+'</div>' };
  var h='';
  if(tpl!=="links" && tpl!=="post") h+=f("pcEye","Small line above the headline","eyebrow",40);
  h+=f("pcHead", tpl==="post"?"Post title":"Headline","headline",100);
  h+=ta("pcSub", tpl==="post"?"Standfirst":"Supporting line","sub", tpl==="post"?"One or two sentences under the title. Also shown in the Journal list.":"");
  if(tpl==="launch") h+=ta("pcPts","Selling points","points","One per line. Three works best.");
  if(tpl==="links") h+=ta("pcLinks","Links","links","One per line: Label | https://…");
  h+=ta("pcBody", tpl==="post"?"Post":"Extra text (optional)","body","Markdown: ## heading, **bold**, *italic*, [link](https://…), - list", tpl==="post"?"code":"");
  h+='<label class="check"><input type="checkbox" id="pcForm" '+(c.form===false?"":"checked")+'> Show the signup form</label>';
  h+='<div class="field"><label for="pcFormId">Sign-up form</label><select id="pcFormId" data-c="form_id"><option value="">Standard: name and email</option>'+(S.forms||[]).map(function(f){ return '<option value="'+esc(f.id)+'"'+(c.form_id===f.id?" selected":"")+'>'+esc(f.name)+(f.status!=="active"?" (off)":"")+'</option>' }).join("")+'</select><span class="hint">Pick one of your <a href="#/forms">forms</a> to ask for more than name and email.</span></div>';
  if(tpl==="post") h+=f("pcEye","Heading above the signup","eyebrow",60);
  h+=f("pcCta","Button text","cta",30);
  h+=f("pcDesc","Search & share description","description",200,"What Google and link previews show. Leave blank to use the supporting line.");
  return h;
}

function siteView(sid, tab, pageId){
  return Promise.all([api("GET","sites"), api("GET","sites/"+sid+"/pages"), api("GET","lists"), api("GET","forms").then(function(d){ S.forms=d.forms })]).then(function(r){
    var site = r[0].sites.filter(function(s){return s.id===sid})[0];
    if(!site) throw new Error("That site doesn’t exist any more.");
    var pages = r[1].pages, list = r[2].lists.filter(function(l){return l.site_id===sid})[0];
    var v=$("#view");
    v.style.setProperty("--pc","var(--"+site.accent+")");
    var html = '<div class="pagehead"><div><span class="eyebrow"><a href="#/sites" style="color:inherit;text-decoration:none">Sites</a> · '+esc(site.status)+'</span><h1>'+esc(site.name)+'</h1><p class="sub"><a href="'+esc(siteUrl(site))+'" target="_blank" rel="noopener">'+esc(hostOf(site))+'</a></p></div>'+
      '<div class="actions"><label class="sr" for="siteStatus">Status</label><select id="siteStatus" style="width:auto">'+["building","live","paused"].map(function(s){return '<option value="'+s+'"'+(site.status===s?" selected":"")+'>'+s[0].toUpperCase()+s.slice(1)+'</option>'}).join("")+'</select>'+
      '<a class="btn" href="'+esc(siteUrl(site))+'" target="_blank" rel="noopener">Open site</a></div></div>';
    html += '<nav class="tabs" role="tablist">'+
      '<a role="tab" href="#/sites/'+sid+'/pages" aria-selected="'+(tab==="pages")+'">Pages</a>'+
      '<a role="tab" href="#/sites/'+sid+'/welcome" aria-selected="'+(tab==="welcome")+'">Welcome email</a>'+
      '<a role="tab" href="#/sites/'+sid+'/settings" aria-selected="'+(tab==="settings")+'">Site settings</a></nav>';
    html += '<div id="tabBody"></div>';
    v.innerHTML=html;
    $("#siteStatus").onchange=function(){ api("PATCH","sites/"+sid,{status:this.value}).then(function(){ toast("Status updated"); refreshNav() }).catch(function(e){ toast(e.message,true) }) };
    if(tab==="settings") siteSettings(site);
    else if(tab==="welcome") siteWelcome(site, list);
    else sitePages(site, pages, pageId);
  });
}

function sitePages(site, pages, pageId){
  var body=$("#tabBody"), newTpl="waitlist";
  var sel = pages.filter(function(p){return p.id===pageId})[0] || pages[0];
  function rowsHtml(){
    return '<div class="rows">'+pages.map(function(p){
      return '<div class="rowi" style="--pc:var(--'+esc(site.accent)+')" aria-current="'+(sel&&p.id===sel.id)+'"><a class="t" href="#/sites/'+site.id+'/pages/'+p.id+'" style="text-decoration:none">'+esc(p.title)+'<small>/'+esc(p.slug)+' · '+esc(TEMPLATES[p.template].name)+' · '+p.views+' view'+(p.views===1?'':'s')+'</small></a>'+
        '<span class="meta"><span class="chip '+(p.published?"published":"off")+'">'+(p.published?"Live":"Off")+'</span><button type="button" class="switch" role="switch" data-pub="'+p.id+'" aria-checked="'+(!!p.published)+'" aria-label="'+(p.published?"Take ":"Put ")+esc(p.title)+(p.published?" offline":" live")+'"></button></span></div>' }).join("")+'</div>';
  }
  function render(showNew){
    var h='<section class="panel"><h2 class="sec">Pages <button class="btn sm primary" type="button" id="newPage">New page</button></h2>';
    if(showNew){
      h+='<form class="sheet" id="pageForm" style="border:0;border-bottom:1px solid var(--line)"><h3>New page</h3><div class="tpls" role="group" aria-label="Template">'+Object.keys(TEMPLATES).map(function(k){ return '<button type="button" data-tpl="'+k+'" aria-pressed="'+(k===newTpl)+'"><b>'+TEMPLATES[k].name+'</b><span>'+TEMPLATES[k].blurb+'</span></button>' }).join("")+'</div>'+
        '<div class="field"><label for="npTitle">Page name</label><input type="text" id="npTitle" required maxlength="80" placeholder="e.g. Early access"></div>'+
        '<div class="actions"><button class="btn primary" type="submit">Create page</button><button class="btn ghost" type="button" id="cancelPage">Cancel</button></div></form>';
    }
    h+=rowsHtml()+'</section><div id="editorHost"></div>';
    body.innerHTML=h;
    $("#newPage").onclick=function(){ render(true); $("#npTitle").focus() };
    if(showNew){
      $("#cancelPage").onclick=function(){ render(false) };
      $$("[data-tpl]").forEach(function(b){ b.onclick=function(){ newTpl=b.dataset.tpl; $$("[data-tpl]").forEach(function(x){ x.setAttribute("aria-pressed", String(x===b)) }) } });
      $("#pageForm").onsubmit=function(e){ e.preventDefault();
        api("POST","pages",{site_id:site.id, title:$("#npTitle").value, template:newTpl}).then(function(r){ toast("Page created"); go("#/sites/"+site.id+"/pages/"+r.page.id) }).catch(function(e){ toast(e.message,true) });
      };
    }
    $$("[data-pub]").forEach(function(b){ b.onclick=function(){
      var p=pages.filter(function(x){return x.id===b.dataset.pub})[0], on=!p.published;
      api("PATCH","pages/"+p.id,{published:on}).then(function(){ p.published=on?1:0; toast(on? "Live at "+hostOf(site)+"/"+p.slug : "Page is offline"); var keep=$("#editorHost").innerHTML!==""; render(false); if(keep) editor() }).catch(function(e){ toast(e.message,true) });
    } });
    if(sel && !showNew) editor();
  }
  function editor(){
    var host=$("#editorHost"), p=sel, c={};
    try{ c=JSON.parse(p.content||"{}") }catch(e){}
    var previewTheme = store("proof.pvtheme")||"site";
    host.innerHTML='<div class="editor"><form class="form panel" id="edForm" autocomplete="off">'+
      '<h2 class="sec">Edit page <span class="saving" id="edSave">Saved</span></h2>'+
      '<div class="field"><label for="pTitle">Page name</label><input type="text" id="pTitle" maxlength="80" value="'+esc(p.title)+'"></div>'+
      (p.slug!=="" ? '<div class="field"><label for="pSlug">Address</label><div class="affix"><span>/</span><input type="text" id="pSlug" maxlength="60" value="'+esc(p.slug)+'"></div><span class="hint">Lives at '+esc(hostOf(site))+'/<span id="slugEcho">'+esc(p.slug)+'</span></span></div>' : '<p class="hint">This is the home page at '+esc(hostOf(site))+'.</p>')+
      pageFields(p.template, c, p)+
      (p.slug!=="" ? '<div class="actions" style="margin-top:8px"><button type="button" class="btn sm danger" id="delPage">Delete page</button></div><div id="delConfirm"></div>' : '')+
      '</form><div class="proof"><div class="proofbar"><span class="url">https://'+esc(hostOf(site))+'/<span id="pvSlug">'+esc(p.slug)+'</span></span>'+
      '<div class="seg" role="group" aria-label="Preview theme"><button type="button" data-pv="site" aria-pressed="'+(previewTheme==="site")+'">Site</button><button type="button" data-pv="light" aria-pressed="'+(previewTheme==="light")+'">Light</button><button type="button" data-pv="dark" aria-pressed="'+(previewTheme==="dark")+'">Dark</button></div></div>'+
      '<iframe id="pv" title="Page preview" sandbox="allow-scripts allow-same-origin"></iframe></div></div>';
    imageButton($("#pcBody"), $("#pcBody").nextElementSibling);
    var save = saver($("#edSave"), function(data){
      return api("PATCH","pages/"+p.id,data).then(function(r){ p.title=r.page.title; p.slug=r.page.slug; p.content=r.page.content;
        var sl=$("#pSlug"); if(sl && document.activeElement!==sl && sl.value!==r.page.slug){ sl.value=r.page.slug }
        $("#pvSlug").textContent=r.page.slug; var se=$("#slugEcho"); if(se) se.textContent=r.page.slug; });
    });
    var pvTimer;
    function collect(){
      $$("[data-c]", host).forEach(function(i){ c[i.dataset.c]=i.value });
      c.form = $("#pcForm").checked;
      return c;
    }
    function preview(){
      clearTimeout(pvTimer);
      pvTimer=setTimeout(function(){
        api("POST","preview",{ site_id:site.id, theme: previewTheme==="site"?undefined:previewTheme, page:{ id:p.id, slug:($("#pSlug")||{value:p.slug}).value, title:$("#pTitle").value, template:p.template, content:collect(), created_at:p.created_at } })
          .then(function(html){ var f=$("#pv"); if(f) f.srcdoc=html }).catch(function(){});
      }, 250);
    }
    S.cleanup.push(function(){ clearTimeout(pvTimer) });
    $("#edForm").addEventListener("input", function(e){
      if(e.target.id==="pTitle") save({title:e.target.value});
      else if(e.target.id==="pSlug") save({slug:e.target.value});
      else save({content:Object.assign({}, collect())});
      preview();
    });
    $("#edForm").addEventListener("change", function(e){ if(e.target.id==="pcForm"){ save({content:Object.assign({}, collect())}); preview() } });
    $("#edForm").addEventListener("submit", function(e){ e.preventDefault(); save.now() });
    $$("[data-pv]").forEach(function(b){ b.onclick=function(){ previewTheme=b.dataset.pv; store("proof.pvtheme",previewTheme); $$("[data-pv]").forEach(function(x){ x.setAttribute("aria-pressed", String(x===b)) }); preview() } });
    var del=$("#delPage");
    if(del) del.onclick=function(){
      $("#delConfirm").innerHTML='<div class="confirm"><span>Delete “'+esc(p.title)+'”? Signups it collected stay in Contacts.</span><button class="btn sm danger" type="button" id="delYes">Delete</button><button class="btn sm ghost" type="button" id="delNo">Keep it</button></div>';
      $("#delNo").onclick=function(){ $("#delConfirm").innerHTML="" };
      $("#delYes").onclick=function(){ api("DELETE","pages/"+p.id).then(function(){ toast("Page deleted"); go("#/sites/"+site.id+"/pages") }).catch(function(e){ toast(e.message,true) }) };
    };
    preview();
  }
  render(false);
}

function siteSettings(site){
  var b=$("#tabBody");
  b.innerHTML='<div class="editor"><form class="form panel" id="ssForm" autocomplete="off"><h2 class="sec">Site settings <span class="saving" id="ssSave">Saved</span></h2>'+
    '<div class="field"><label for="ssName">Name</label><input type="text" id="ssName" maxlength="60" value="'+esc(site.name)+'"></div>'+
    '<div class="field"><label for="ssSub">Address</label><div class="affix"><input type="text" id="ssSub" maxlength="30" value="'+esc(site.subdomain)+'"><span>.'+esc(S.me.root)+'</span></div><span class="hint">Changing this moves every page to the new address straight away. Old links stop working.</span></div>'+
    '<div class="field"><label for="ssTag">Tagline</label><input type="text" id="ssTag" maxlength="120" value="'+esc(site.tagline)+'"><span class="hint">Used in the browser tab and link previews.</span></div>'+
    '<div class="field"><span class="label">Colour</span>'+swatches(site.accent,"acc")+'</div>'+
    '<div class="field"><span class="label">Theme</span><div class="seg" role="group" aria-label="Theme" style="align-self:flex-start">'+[["auto","Follow visitor"],["light","Light"],["dark","Dark"]].map(function(t){ return '<button type="button" data-th="'+t[0]+'" aria-pressed="'+(site.theme===t[0])+'">'+t[1]+'</button>' }).join("")+'</div></div>'+
    '<h2 class="sec">Delete site</h2><p class="hint">Removes the site and all its pages. Contacts and emails stay.</p><div class="actions"><button type="button" class="btn sm danger" id="delSite">Delete '+esc(site.name)+'</button></div><div id="delConfirm"></div>'+
    '</form><div class="proof"><div class="proofbar"><span class="url">home page</span></div><iframe id="pv" title="Site preview" sandbox="allow-scripts allow-same-origin"></iframe></div></div>';
  var save=saver($("#ssSave"), function(d){ return api("PATCH","sites/"+site.id,d).then(function(r){ refreshNav(); Object.assign(site, r.site); var sub=$("#ssSub"); if(document.activeElement!==sub) sub.value=r.site.subdomain; $("#view").style.setProperty("--pc","var(--"+r.site.accent+")"); preview() }) });
  function preview(){
    api("GET","sites/"+site.id+"/pages").then(function(r){
      var home=r.pages.filter(function(p){return p.slug===""})[0]; if(!home) return;
      return api("POST","preview",{ site_id:site.id, site:{name:site.name, accent:site.accent, theme:site.theme}, page:{ id:home.id, slug:"", title:home.title, template:home.template, content:JSON.parse(home.content||"{}") } });
    }).then(function(html){ if(html && $("#pv")) $("#pv").srcdoc=html }).catch(function(){});
  }
  $("#ssName").oninput=function(){ site.name=this.value; save({name:this.value}) };
  $("#ssSub").oninput=function(){ save({subdomain:this.value}) };
  $("#ssTag").oninput=function(){ save({tagline:this.value}) };
  $$("[data-acc]").forEach(function(x){ x.onclick=function(){ site.accent=x.dataset.acc; $$("[data-acc]").forEach(function(y){ y.setAttribute("aria-pressed", String(y===x)) }); save({accent:x.dataset.acc}); save.now() } });
  $$("[data-th]").forEach(function(x){ x.onclick=function(){ site.theme=x.dataset.th; $$("[data-th]").forEach(function(y){ y.setAttribute("aria-pressed", String(y===x)) }); save({theme:x.dataset.th}); save.now() } });
  $("#delSite").onclick=function(){
    $("#delConfirm").innerHTML='<div class="confirm"><span>Delete '+esc(site.name)+' and all its pages? This can’t be undone.</span><button class="btn sm danger" type="button" id="delYes">Delete site</button><button class="btn sm ghost" type="button" id="delNo">Keep it</button></div>';
    $("#delNo").onclick=function(){ $("#delConfirm").innerHTML="" };
    $("#delYes").onclick=function(){ api("DELETE","sites/"+site.id).then(function(){ toast("Site deleted"); refreshNav(); go("#/sites") }).catch(function(e){ toast(e.message,true) }) };
  };
  preview();
}

function emailPreview(frame, data){
  return api("POST","email-preview",data).then(function(html){ if(frame) frame.srcdoc=html }).catch(function(){});
}

function siteWelcome(site, list){
  var b=$("#tabBody");
  if(!list){ b.innerHTML='<div class="empty">This site has no signup list yet. It’s created with the first signup.</div>'; return }
  b.innerHTML='<div class="editor"><form class="form panel" id="wForm" autocomplete="off"><h2 class="sec">Welcome email <span class="saving" id="wSave">Saved</span></h2>'+
    emailBanner()+
    '<div class="actions"><button type="button" class="switch" role="switch" id="wOn" aria-checked="'+(!!list.welcome_enabled)+'" aria-labelledby="wOnLbl"></button><span id="wOnLbl">'+(list.welcome_enabled?"On: new signups get this straight away":"Off: new signups get nothing")+'</span></div>'+
    '<div class="field"><label for="wSubj">Subject</label><input type="text" id="wSubj" maxlength="150" value="'+esc(list.welcome_subject)+'"></div>'+
    '<div class="field"><label for="wBody">Message</label><textarea id="wBody" class="code">'+esc(list.welcome_body)+'</textarea><span class="hint">{{name}} becomes their first name (or “there”). Markdown works.</span></div>'+
    '<p class="hint">Goes to people who sign up on any '+esc(site.name)+' page. List: '+esc(list.name)+', '+list.subscribed+' subscribed.</p>'+
    '</form><div class="proof email"><div class="proofbar"><span class="url">inbox view</span></div><iframe id="pv" title="Email preview" sandbox=""></iframe></div></div>';
  var t;
  function preview(){ clearTimeout(t); t=setTimeout(function(){ emailPreview($("#pv"),{ subject:$("#wSubj").value, body:$("#wBody").value, site_id:site.id }) },250) }
  S.cleanup.push(function(){ clearTimeout(t) });
  imageButton($("#wBody"), $("#wBody").nextElementSibling);
  var save=saver($("#wSave"), function(d){ return api("PATCH","lists/"+list.id,d) });
  $("#wSubj").oninput=function(){ save({welcome_subject:this.value}); preview() };
  $("#wBody").oninput=function(){ save({welcome_body:this.value}); preview() };
  $("#wOn").onclick=function(){ var on=this.getAttribute("aria-checked")!=="true"; this.setAttribute("aria-checked",String(on)); $("#wOnLbl").textContent= on?"On: new signups get this straight away":"Off: new signups get nothing"; list.welcome_enabled=on?1:0; save({welcome_enabled:on}); save.now() };
  preview();
}

/* ============ contacts ============ */
function csvParse(text){
  var rows=[], row=[], f="", q=false;
  for(var i=0;i<text.length;i++){
    var ch=text[i];
    if(q){ if(ch==='"'){ if(text[i+1]==='"'){ f+='"'; i++ } else q=false } else f+=ch }
    else if(ch==='"') q=true;
    else if(ch===','||ch===';'||ch==='\t'){ row.push(f); f="" }
    else if(ch==='\n'||ch==='\r'){ if(ch==='\r'&&text[i+1]==='\n') i++; row.push(f); rows.push(row); row=[]; f="" }
    else f+=ch;
  }
  if(f||row.length){ row.push(f); rows.push(row) }
  rows=rows.filter(function(r){ return r.some(function(x){ return x.trim() }) });
  if(!rows.length) return [];
  var hdr=rows[0].map(function(x){return x.trim().toLowerCase()});
  var ei=hdr.findIndex(function(h){return /e-?mail/.test(h)}), ni=hdr.findIndex(function(h){return /^(name|full ?name|first ?name)$/.test(h)});
  var start=1;
  if(ei<0){ ei=rows[0].findIndex(function(x){return /@/.test(x)}); ni=ei===0?1:0; start=0; if(ei<0) return [] }
  return rows.slice(start).map(function(r){ return { email:(r[ei]||"").trim(), name: ni>=0 && ni!==ei ? (r[ni]||"").trim() : "" } }).filter(function(r){ return r.email });
}
function csvCell(s){ s=String(s==null?"":s); return /[",\n;]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s }

function contactsView(listParam){
  var st = { list:(listParam||"").indexOf("sg_")===0?"":(listParam||""), seg:(listParam||"").indexOf("sg_")===0?listParam:"", q:"", status:"", offset:0, rows:[], total:0, open:null, panel:null };
  var lists=[], segs=[], ctx=null;
  function load(append){
    var qs="limit=100&offset="+st.offset+(st.q?"&q="+encodeURIComponent(st.q):"")+(st.list?"&list="+st.list:"")+(st.seg?"&segment="+st.seg:"")+(st.status?"&status="+st.status:"");
    return api("GET","contacts?"+qs).then(function(d){ st.rows = append? st.rows.concat(d.contacts) : d.contacts; st.total=d.total; renderTable() });
  }
  function listName(id){ var l=lists.filter(function(x){return x.id===id})[0]; return l? l.name : "" }
  function renderShell(){
    var cur = lists.filter(function(l){return l.id===st.list})[0];
    var curSeg = segs.filter(function(g){return g.id===st.seg})[0];
    var v=$("#view");
    v.innerHTML = head("Audience", "Contacts", "Everyone who signed up, across every site.", '<button class="btn" type="button" id="exportBtn">Export CSV</button><button class="btn" type="button" id="importBtn">Import</button><button class="btn primary" type="button" id="addBtn">Add contact</button>')+
      '<div class="cols"><aside class="stack" style="gap:10px"><div class="actions" style="justify-content:space-between"><span class="eyebrow">Lists</span><button class="btn sm" type="button" id="newList">New list</button></div><div id="newListHost"></div><div class="listnav">'+
        '<button type="button" data-list="" aria-pressed="'+(!st.list&&!st.seg)+'"><span>All contacts</span><span></span></button>'+
        lists.map(function(l){ return '<button type="button" data-list="'+esc(l.id)+'" aria-pressed="'+(st.list===l.id)+'"><span>'+esc(l.name)+'</span><span class="num">'+l.subscribed+'</span></button>' }).join("")+'</div>'+
        '<div class="actions" style="justify-content:space-between;margin-top:10px"><span class="eyebrow">Smart lists</span><button class="btn sm" type="button" id="newSeg">New</button></div>'+
        (segs.length ? '<div class="listnav">'+segs.map(function(g){ return '<button type="button" data-seg="'+esc(g.id)+'" aria-pressed="'+(st.seg===g.id)+'"><span>'+esc(g.name)+'</span><span class="num">'+g.subscribed+'</span></button>' }).join("")+'</div>' : '<p class="hint" style="margin:0">Lists that fill themselves from rules, like “in Ireland and clicked the launch email”.</p>')+
        (curSeg ? '<div class="stack" style="margin-top:6px"><p class="hint" style="margin:0">'+esc(ruleSummary(curSeg.rules, ctx))+'</p><div class="actions"><button type="button" class="btn sm" id="editSeg">Edit rules</button><button type="button" class="btn sm danger" id="delSeg">Delete</button></div><div id="segConfirm"></div></div>' : '')+
        (cur ? '<div class="stack" style="margin-top:6px">'+(cur.site_id ? '<p class="hint">Signups from '+esc(cur.site_name)+' land here. <a href="#/sites/'+esc(cur.site_id)+'/welcome">Welcome email</a></p>' : '<div class="actions"><button type="button" class="btn sm" id="renameList">Rename</button><button type="button" class="btn sm danger" id="deleteList">Delete list</button></div><div id="listConfirm"></div>')+'</div>' : '')+
      '</aside><section class="stack"><div id="panel"></div><div class="filters"><label class="sr" for="cq">Search</label><input type="search" id="cq" placeholder="Search name or email" value="'+esc(st.q)+'">'+
        '<label class="sr" for="cs">Status</label><select id="cs"><option value="">Any status</option><option value="subscribed"'+(st.status==="subscribed"?" selected":"")+'>Subscribed</option><option value="unsubscribed"'+(st.status==="unsubscribed"?" selected":"")+'>Unsubscribed</option><option value="pending"'+(st.status==="pending"?" selected":"")+'>Waiting to confirm</option><option value="bounced"'+(st.status==="bounced"?" selected":"")+'>Bounced</option><option value="complained"'+(st.status==="complained"?" selected":"")+'>Marked as spam</option></select>'+
        '<span class="label" id="count"></span></div><div id="tableHost"></div></section></div>';
    $$("[data-seg]").forEach(function(b){ b.onclick=function(){ st.seg=b.dataset.seg; st.list=""; st.offset=0; st.open=null; st.panel=null; history.replaceState(null,"","#/contacts/"+st.seg); renderShell(); load() } });
    $("#newSeg").onclick=function(){ st.panel="segment"; st.editSeg=null; st.open=null; renderPanel() };
    if(curSeg){
      $("#editSeg").onclick=function(){ st.panel="segment"; st.editSeg=curSeg; renderPanel(); window.scrollTo({top:0,behavior:"smooth"}) };
      $("#delSeg").onclick=function(){
        $("#segConfirm").innerHTML='<div class="confirm"><span>Delete this smart list? Nobody is removed from Contacts. Draft emails aimed at it go back to “everyone”.</span><button class="btn sm danger" type="button" id="dsY">Delete</button></div>';
        $("#dsY").onclick=function(){ api("DELETE","segments/"+curSeg.id).then(refreshLists).then(function(){ st.seg=""; history.replaceState(null,"","#/contacts"); renderShell(); load() }) };
      };
    }
    $$("[data-list]").forEach(function(b){ b.onclick=function(){ st.list=b.dataset.list; st.seg=""; st.offset=0; st.open=null; st.panel=null; history.replaceState(null,"","#/contacts"+(st.list?"/"+st.list:"")); renderShell(); load() } });
    var qt; $("#cq").oninput=function(){ var val=this.value; clearTimeout(qt); qt=setTimeout(function(){ st.q=val; st.offset=0; load() },250) };
    $("#cs").onchange=function(){ st.status=this.value; st.offset=0; load() };
    $("#addBtn").onclick=function(){ st.panel="add"; st.open=null; renderPanel() };
    $("#importBtn").onclick=function(){ st.panel="import"; st.open=null; renderPanel() };
    $("#exportBtn").onclick=exportCsv;
    $("#newList").onclick=function(){
      $("#newListHost").innerHTML='<form class="sheet" id="nlForm"><div class="field"><label for="nlName">List name</label><input type="text" id="nlName" required maxlength="60" placeholder="e.g. Beta testers"></div><div class="actions"><button class="btn sm primary" type="submit">Create</button><button class="btn sm ghost" type="button" id="nlCancel">Cancel</button></div></form>';
      $("#nlName").focus(); $("#nlCancel").onclick=function(){ $("#newListHost").innerHTML="" };
      $("#nlForm").onsubmit=function(e){ e.preventDefault(); api("POST","lists",{name:$("#nlName").value}).then(function(r){ return refreshLists().then(function(){ st.list=r.id; renderShell(); load() }) }).catch(function(e){ toast(e.message,true) }) };
    };
    if(cur && !cur.site_id){
      $("#renameList").onclick=function(){
        $("#listConfirm").innerHTML='<form class="sheet" id="rlForm"><div class="field"><label for="rlName">New name</label><input type="text" id="rlName" required maxlength="60" value="'+esc(cur.name)+'"></div><div class="actions"><button class="btn sm primary" type="submit">Rename</button></div></form>';
        $("#rlForm").onsubmit=function(e){ e.preventDefault(); api("PATCH","lists/"+cur.id,{name:$("#rlName").value}).then(refreshLists).then(function(){ renderShell(); renderTable() }).catch(function(e){ toast(e.message,true) }) };
      };
      $("#deleteList").onclick=function(){
        $("#listConfirm").innerHTML='<div class="confirm"><span>Delete this list? The contacts stay.</span><button class="btn sm danger" type="button" id="dlYes">Delete</button></div>';
        $("#dlYes").onclick=function(){ api("DELETE","lists/"+cur.id).then(refreshLists).then(function(){ st.list=""; renderShell(); load() }) };
      };
    }
    renderPanel();
  }
  function renderTable(){
    var host=$("#tableHost"); if(!host) return;
    $("#count").textContent = st.total+" contact"+(st.total===1?"":"s");
    if(!st.rows.length){ host.innerHTML='<div class="empty"><b>No contacts here</b>'+(st.q||st.status?"Try a different search.":"Signups from your pages appear here.")+'</div>'; return }
    host.innerHTML='<div class="tablewrap"><table><thead><tr><th>Contact</th><th>Status</th><th>Came from</th><th>Lists</th><th class="r">Added</th></tr></thead><tbody>'+
      st.rows.map(function(c){ var ls=(c.list_ids||"").split(",").filter(Boolean).map(listName).filter(Boolean);
        return '<tr class="click" data-open="'+esc(c.id)+'" tabindex="0"><td>'+esc(c.name||c.email)+(c.name?'<span class="sub">'+esc(c.email)+'</span>':'')+'</td><td><span class="chip '+esc(c.status)+'">'+esc(c.status)+'</span></td><td class="mono">'+esc(c.source||"—")+'</td><td>'+esc(ls.join(", ")||"—")+'</td><td class="r mono">'+fmtDate(c.created_at)+'</td></tr>' }).join("")+
      '</tbody></table></div>'+(st.rows.length<st.total ? '<div class="actions" style="margin-top:12px"><button class="btn" type="button" id="more">Show more</button></div>' : '');
    $$("[data-open]").forEach(function(tr){ var f=function(){ st.open=tr.dataset.open; st.panel="detail"; renderPanel(); window.scrollTo({top:0,behavior:"smooth"}) }; tr.onclick=f; tr.onkeydown=function(e){ if(e.key==="Enter") f() } });
    var more=$("#more"); if(more) more.onclick=function(){ st.offset=st.rows.length; load(true) };
  }
  function renderPanel(){
    var p=$("#panel"); if(!p) return;
    if(!st.panel){ p.innerHTML=""; return }
    if(st.panel==="segment"){
      segmentEditor(p, ctx, st.editSeg, function(name, rules){
        var req = st.editSeg ? api("PATCH","segments/"+st.editSeg.id,{name:name, rules:rules}).then(function(){ return st.editSeg.id }) : api("POST","segments",{name:name, rules:rules}).then(function(r){ return r.id });
        return req.then(function(sid){ toast(st.editSeg?"Smart list saved":"Smart list created"); st.panel=null; st.seg=sid; st.list=""; history.replaceState(null,"","#/contacts/"+sid); return refreshLists().then(function(){ renderShell(); load() }) });
      }, function(){ st.panel=null; renderPanel() });
      return;
    }
    var listChecks=function(sel){ return lists.length ? '<div class="field"><span class="label">Lists</span>'+lists.map(function(l){ return '<label class="check"><input type="checkbox" data-lc="'+esc(l.id)+'"'+(sel.indexOf(l.id)>-1?" checked":"")+'> '+esc(l.name)+'</label>' }).join("")+'</div>' : '' };
    if(st.panel==="add"){
      p.innerHTML='<form class="drawer" id="addForm"><h2 class="sec">Add contact</h2><div class="fieldrow"><div class="field"><label for="acEmail">Email</label><input type="email" id="acEmail" required maxlength="254"></div><div class="field"><label for="acName">Name</label><input type="text" id="acName" maxlength="80"></div></div>'+
        listChecks(st.list?[st.list]:[])+'<p class="hint">Only add people who’ve agreed to hear from you.</p><div class="actions"><button class="btn primary" type="submit">Add</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>';
      $("#acEmail").focus();
      $("#addForm").onsubmit=function(e){ e.preventDefault();
        var ls=$$("[data-lc]:checked",p).map(function(x){return x.dataset.lc});
        api("POST","contacts",{email:$("#acEmail").value, name:$("#acName").value, lists:ls}).then(function(r){ toast(r.created?"Contact added":"They were already here, lists updated"); st.panel=null; renderPanel(); refreshLists().then(function(){ renderShell(); load() }) }).catch(function(e){ toast(e.message,true) });
      };
    }
    else if(st.panel==="import"){
      p.innerHTML='<form class="drawer" id="impForm"><h2 class="sec">Import contacts</h2>'+
        '<div class="field"><label for="impFile">CSV file</label><input type="file" id="impFile" accept=".csv,text/csv,text/plain"></div>'+
        '<div class="field"><label for="impText">Or paste</label><textarea id="impText" class="code" style="min-height:120px" placeholder="email,name&#10;niamh@example.com,Niamh"></textarea><span class="hint">Needs a column with email addresses. A name column is picked up if there is one.</span></div>'+
        '<div class="field"><label for="impList">Add them to</label><select id="impList"><option value="">No list</option>'+lists.map(function(l){ return '<option value="'+esc(l.id)+'"'+(st.list===l.id?" selected":"")+'>'+esc(l.name)+'</option>' }).join("")+'</select></div>'+
        '<label class="check"><input type="checkbox" id="impConsent" required> Everyone on this list agreed to get emails from me.</label>'+
        '<p class="label" id="impCount">Nothing loaded yet</p><div class="actions"><button class="btn primary" type="submit" id="impGo" disabled>Import</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>';
      var parsed=[];
      var update=function(){ parsed=csvParse($("#impText").value); $("#impCount").textContent= parsed.length? parsed.length+" row"+(parsed.length===1?"":"s")+" found" : "No email addresses found yet"; $("#impGo").disabled=!parsed.length };
      $("#impText").oninput=update;
      $("#impFile").onchange=function(){ var f=this.files[0]; if(!f) return; var r=new FileReader(); r.onload=function(){ $("#impText").value=String(r.result); update() }; r.readAsText(f) };
      $("#impForm").onsubmit=function(e){ e.preventDefault();
        var btn=$("#impGo"); btn.disabled=true; btn.textContent="Importing…";
        api("POST","contacts/import",{rows:parsed, list_id:$("#impList").value||null, consent_confirmed:$("#impConsent").checked})
          .then(function(r){ toast(r.added+" added, "+r.updated+" already here"+(r.invalid?", "+r.invalid+" skipped (bad address)":"")); st.panel=null; refreshLists().then(function(){ renderShell(); load() }) })
          .catch(function(e){ btn.disabled=false; btn.textContent="Import"; toast(e.message,true) });
      };
    }
    else if(st.panel==="detail" && st.open){
      p.innerHTML='<div class="drawer"><div class="loading">Loading…</div></div>';
      Promise.all([api("GET","contacts/"+st.open), api("GET","sequences")]).then(function(rr){
        var d=rr[0], c=d.contact, inIds=d.enrollments.map(function(e){return e.sequence_id});
        var autos=rr[1].sequences.filter(function(q){ return q.status==="active" && inIds.indexOf(q.id)<0 });
        p.innerHTML='<form class="drawer" id="cdForm"><h2 class="sec">'+esc(c.email)+' <span class="saving" id="cdSave">Saved</span></h2>'+
          '<div class="fieldrow"><div class="field"><label for="cdName">Name</label><input type="text" id="cdName" maxlength="80" value="'+esc(c.name)+'"></div>'+
          '<div class="field"><label for="cdStatus">Status</label><select id="cdStatus">'+[["subscribed","Subscribed"],["unsubscribed","Unsubscribed"],["pending","Waiting to confirm"],["bounced","Bounced"],["complained","Marked as spam"]].map(function(s){ return '<option value="'+s[0]+'"'+(c.status===s[0]?" selected":"")+'>'+s[1]+'</option>' }).join("")+'</select></div></div>'+
          listChecks(d.lists)+
          (d.ref&&d.ref.source_type==="social" ? '<p class="hint">Brought in by a tracked link in <a href="#/social/p/'+esc(d.ref.source_id)+'">a '+esc(platName(d.ref.platform))+' post</a>.</p>' : '')+
          '<p class="hint">Came from '+esc(c.source||"—")+' on '+fmtDate(c.created_at,true)+'. '+(c.consent_at ? 'Agreed to emails on '+fmtDate(c.consent_at,true)+': “'+esc(c.consent_text)+'”' : 'Added by hand or import, no signup consent recorded.')+'</p>'+
          (c.status==="bounced" ? '<div class="notice danger"><p>Emails to this address bounced, so Studio stopped sending to it. Only switch it back if you know the address works now.</p></div>' : '')+
          (c.status==="complained" ? '<div class="notice danger"><p>They marked one of your emails as spam, so Studio stopped emailing them. Leave this as it is unless they ask to hear from you again.</p></div>' : '')+
          (c.status==="pending" ? '<div class="notice"><p>They signed up but haven’t tapped the confirmation link yet. Nothing else is sent until they do.</p></div>' : '')+
          (ctx.fields.length ? '<h2 class="sec">Details</h2><div class="fieldrow" id="cdProps">'+ctx.fields.map(function(f){ var v=c.props[f.key], iid="cp_"+f.key;
              if(f.type==="multiselect") return '<fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label">'+esc(f.label)+'</legend>'+f.options.map(function(o){ return '<label class="check"><input type="checkbox" data-pm="'+esc(f.key)+'" value="'+esc(o)+'"'+(Array.isArray(v)&&v.indexOf(o)>-1?" checked":"")+'> '+esc(o)+'</label>' }).join("")+'</fieldset>';
              if(f.type==="checkbox") return '<div class="field"><span class="label">'+esc(f.label)+'</span><label class="check"><input type="checkbox" data-pc="'+esc(f.key)+'"'+(v?" checked":"")+'> Yes</label></div>';
              if(f.type==="select") return '<div class="field"><label for="'+iid+'">'+esc(f.label)+'</label><select id="'+iid+'" data-pv="'+esc(f.key)+'"><option value="">—</option>'+f.options.map(function(o){ return '<option'+(v===o?" selected":"")+'>'+esc(o)+'</option>' }).join("")+(v&&f.options.indexOf(v)<0?'<option selected>'+esc(v)+'</option>':'')+'</select></div>';
              return '<div class="field"><label for="'+iid+'">'+esc(f.label)+'</label>'+(f.type==="textarea"?'<textarea id="'+iid+'" data-pv="'+esc(f.key)+'">'+esc(v||"")+'</textarea>':'<input type="'+(f.type==="number"?"number":f.type==="date"?"date":"text")+'" id="'+iid+'" data-pv="'+esc(f.key)+'" value="'+esc(v==null?"":v)+'">')+'</div>' }).join("")+'</div>' : '')+
          (d.submissions&&d.submissions.length ? '<h2 class="sec">Forms</h2><div class="tablewrap"><table><tbody>'+d.submissions.map(function(x){ var host=""; try{ host=x.page_url?new URL(x.page_url).hostname:"" }catch(e){}
              return '<tr><td><a href="#/forms/'+esc(x.form_id)+'/subs">'+esc(x.name||"Deleted form")+'</a><span class="sub">'+esc(host)+'</span></td><td class="r mono">'+fmtDate(x.created_at,true)+'</td></tr>' }).join("")+'</tbody></table></div>' : '')+
          '<h2 class="sec">Automations</h2>'+
          (d.enrollments.length ? '<div class="tablewrap"><table><tbody>'+d.enrollments.map(function(e){
              var where = e.status==="active" ? "Email "+(e.step_index+1)+" of "+e.steps+" due "+(e.next_at?fmtDate(e.next_at,true):"soon") : e.status==="completed" ? "Got every email" : "Left early: "+(e.exit_reason||"");
              return '<tr><td><a href="#/automations/'+esc(e.sequence_id)+'">'+esc(e.name)+'</a><span class="sub">'+esc(where)+'</span></td><td class="r">'+(e.status==="active"?'<button class="btn sm ghost" type="button" data-exit="'+esc(e.id)+'">Take out</button>':'<span class="chip '+esc(e.status)+'">'+esc(e.status)+'</span>')+'</td></tr>' }).join("")+'</tbody></table></div>' : '<p class="hint">Not in any automations.</p>')+
          (c.status==="subscribed" && autos.length ? '<div class="actions"><label class="sr" for="cdAuto">Automation</label><select id="cdAuto" style="flex:1 1 200px;width:auto"><option value="">Add to an automation…</option>'+autos.map(function(q){ return '<option value="'+esc(q.id)+'">'+esc(q.name)+'</option>' }).join("")+'</select><button class="btn sm" type="button" id="cdAutoGo">Add</button></div>' : '')+
          '<h2 class="sec">Emails</h2>'+
          (d.sends.length ? '<div class="tablewrap"><table><thead><tr><th>Email</th><th>Status</th><th class="r">Opened</th><th class="r">Clicked</th></tr></thead><tbody>'+d.sends.map(function(s){
              var label = s.campaign || (s.kind==="welcome"?"Welcome email": s.kind==="confirm"?"Confirm your email": s.kind==="sequence"?(s.sequence||"Automation")+": "+(s.step_subject||"email"): s.kind);
              var stt = s.complained_at ? "complained" : s.bounced_at ? "bounced" : s.status;
              return '<tr><td>'+esc(label)+'<span class="sub">'+fmtDate(s.sent_at||s.created_at,true)+(s.error&&stt!=="sent"?' · '+esc(s.error):'')+'</span></td><td><span class="chip '+esc(stt)+'">'+esc(stt==="complained"?"spam report":stt)+'</span></td><td class="r mono">'+(s.opened_at?"Yes":"—")+'</td><td class="r mono">'+(s.clicked_at?"Yes":"—")+'</td></tr>' }).join("")+'</tbody></table></div>' : '<p class="hint">No emails sent to them yet.</p>')+
          '<div class="actions"><button class="btn" type="button" data-close>Close</button><button class="btn sm danger" type="button" id="cdDel">Delete contact</button></div><div id="cdConfirm"></div></form>';
        var save=saver($("#cdSave"), function(x){ return api("PATCH","contacts/"+c.id,x).then(function(){ var row=st.rows.filter(function(r){return r.id===c.id})[0]; if(row){ if(x.name!==undefined) row.name=x.name; if(x.status) row.status=x.status; if(x.lists) row.list_ids=x.lists.join(",") } renderTable() }) });
        $("#cdName").oninput=function(){ save({name:this.value}) };
        $("#cdStatus").onchange=function(){ save({status:this.value}); save.now() };
        $$("[data-lc]",p).forEach(function(cb){ cb.onchange=function(){ save({lists:$$("[data-lc]:checked",p).map(function(x){return x.dataset.lc})}); save.now() } });
        $("#cdDel").onclick=function(){
          $("#cdConfirm").innerHTML='<div class="confirm"><span>Delete '+esc(c.email)+' and their email history? If you just want them to stop getting emails, set them to Unsubscribed instead.</span><button class="btn sm danger" type="button" id="cdYes">Delete</button></div>';
          $("#cdYes").onclick=function(){ api("DELETE","contacts/"+c.id).then(function(){ toast("Contact deleted"); st.panel=null; st.open=null; renderPanel(); load() }) };
        };
        var pv=function(key,val){ var o={}; o[key]=val; save({props:o}) };
        $$("[data-pv]",p).forEach(function(i){ i.oninput=i.onchange=function(){ var f=ctx.fields.filter(function(x){return x.key===i.dataset.pv})[0]; pv(i.dataset.pv, f&&f.type==="number"&&i.value!==""?Number(i.value):i.value) } });
        $$("[data-pc]",p).forEach(function(i){ i.onchange=function(){ pv(i.dataset.pc, i.checked?1:0); save.now() } });
        $$("[data-pm]",p).forEach(function(i){ i.onchange=function(){ pv(i.dataset.pm, $$('[data-pm="'+i.dataset.pm+'"]:checked',p).map(function(x){return x.value})); save.now() } });
        $$("[data-exit]",p).forEach(function(b){ b.onclick=function(){ api("POST","enrollments/"+b.dataset.exit+"/exit").then(function(){ toast("Taken out"); renderPanel() }).catch(function(e){ toast(e.message,true) }) } });
        var ag=$("#cdAutoGo"); if(ag) ag.onclick=function(){ var qid=$("#cdAuto").value; if(!qid){ toast("Pick an automation first.",true); return }
          api("POST","sequences/"+qid+"/enroll",{contact_id:c.id}).then(function(){ toast("Added. The first email goes out on schedule."); renderPanel() }).catch(function(e){ toast(e.message,true) }) };
        $$("[data-close]",p).forEach(function(b){ b.onclick=function(){ st.panel=null; st.open=null; renderPanel() } });
      }).catch(function(e){ p.innerHTML='<div class="notice danger"><p>'+esc(e.message)+'</p></div>' });
      return;
    }
    $$("[data-close]",p).forEach(function(b){ b.onclick=function(){ st.panel=null; renderPanel() } });
  }
  function exportCsv(){
    var all=[], off=0;
    var qs=function(){ return "limit=500&offset="+off+(st.q?"&q="+encodeURIComponent(st.q):"")+(st.list?"&list="+st.list:"")+(st.status?"&status="+st.status:"") };
    var step=function(){ return api("GET","contacts?"+qs()).then(function(d){ all=all.concat(d.contacts); off=all.length; if(all.length<d.total && d.contacts.length) return step() }) };
    step().then(function(){
      var lines=["email,name,status,source,lists,added,consent_at"].concat(all.map(function(c){ return [c.email,c.name,c.status,c.source,(c.list_ids||"").split(",").filter(Boolean).map(listName).join(" | "),new Date(c.created_at).toISOString(),c.consent_at?new Date(c.consent_at).toISOString():""].map(csvCell).join(",") }));
      var blob=new Blob([lines.join("\n")],{type:"text/csv"}), a=document.createElement("a");
      a.href=URL.createObjectURL(blob); a.download="contacts-"+new Date().toISOString().slice(0,10)+".csv"; document.body.appendChild(a); a.click(); a.remove();
      toast(all.length+" contacts exported");
    }).catch(function(e){ toast(e.message,true) });
  }
  function refreshLists(){ return Promise.all([api("GET","lists"), api("GET","segments"), ctx?Promise.resolve(ctx):loadRuleContext()]).then(function(r){ lists=r[0].lists; segs=r[1].segments; ctx=r[2]; ctx.lists=lists }) }
  var want=store("studio.openContact"); if(want){ store("studio.openContact",""); st.open=want; st.panel="detail" }
  return refreshLists().then(function(){ renderShell(); return load() });
}

/* ============ contact fields (shared) ============ */
var FIELD_TYPE_NAMES={text:"Short text",textarea:"Long text",number:"Number",date:"Date",select:"Dropdown (pick one)",multiselect:"Tick boxes (pick several)",checkbox:"Yes / no tick box"};
function loadFields(){ return api("GET","fields").then(function(d){ S.fields=d.fields; return d.fields }) }
/** A little form to create a contact field. Resolves with the new field, or null. */
function newFieldForm(host){
  return new Promise(function(resolve){
    host.innerHTML='<form class="sheet" id="nfF"><h3>New contact field</h3><div class="fieldrow"><div class="field"><label for="nfLabel">Name</label><input type="text" id="nfLabel" required maxlength="60" placeholder="e.g. Country"></div>'+
      '<div class="field"><label for="nfType">Type</label><select id="nfType">'+Object.keys(FIELD_TYPE_NAMES).map(function(k){ return '<option value="'+k+'">'+FIELD_TYPE_NAMES[k]+'</option>' }).join("")+'</select></div></div>'+
      '<div class="field" id="nfOptsF" hidden><label for="nfOpts">Options</label><textarea id="nfOpts" placeholder="One per line"></textarea></div>'+
      '<div class="actions"><button class="btn sm primary" type="submit">Create field</button><button class="btn sm ghost" type="button" id="nfCancel">Cancel</button></div></form>';
    $("#nfLabel",host).focus();
    $("#nfType",host).onchange=function(){ $("#nfOptsF",host).hidden=["select","multiselect"].indexOf(this.value)<0 };
    $("#nfCancel",host).onclick=function(){ host.innerHTML=""; resolve(null) };
    $("#nfF",host).onsubmit=function(e){ e.preventDefault();
      api("POST","fields",{label:$("#nfLabel",host).value, type:$("#nfType",host).value, options:$("#nfOpts",host).value}).then(function(r){ host.innerHTML=""; S.fields=null; toast("Field added"); resolve(r.field) }).catch(function(err){ toast(err.message,true) }) };
  });
}

/* ============ forms ============ */
function formsView(){
  return Promise.all([api("GET","forms"), loadFields()]).then(function(r){
    var d=r[0], fields=r[1], v=$("#view");
    var html=head("Audience","Forms","Sign-up forms for your pages, any other website, or your apps. Everyone who fills one in lands in Contacts.",'<button class="btn primary" type="button" id="newForm">New form</button>');
    html+='<div class="grid2"><div class="stack">';
    html+= d.forms.length ? '<div class="tablewrap"><table><thead><tr><th>Form</th><th>Adds people to</th><th>Status</th><th class="r">Last 30 days</th><th class="r">All time</th></tr></thead><tbody>'+
        d.forms.map(function(f){ return '<tr class="click" data-go="'+esc(f.id)+'" tabindex="0"><td>'+esc(f.name)+'<span class="sub">'+(f.fields.length+1)+' field'+(f.fields.length?'s':'')+(f.site_name?' · styled as '+esc(f.site_name):'')+'</span></td><td>'+esc(f.list_name||"A new list")+'</td><td><span class="chip '+(f.status==="active"?"live":"off")+'">'+(f.status==="active"?"On":"Off")+'</span></td><td class="r mono">'+f.recent+'</td><td class="r mono">'+f.submissions+'</td></tr>' }).join("")+'</tbody></table></div>'
      : '<div class="empty"><b>No forms yet</b>Your Studio pages already have a simple name + email sign-up. Make a form when you want more fields, or a sign-up on another website or in an app.</div>';
    html+='</div><section class="panel"><h2 class="sec">Contact fields <button class="btn sm" type="button" id="addField">New field</button></h2><div id="nfHost" class="pad" hidden></div>'+
      (fields.length ? '<div class="rows">'+fields.map(function(f){ return '<div class="rowi nosq"><span class="t">'+esc(f.label)+'<small>'+esc(FIELD_TYPE_NAMES[f.type]||f.type)+(f.options.length?': '+esc(f.options.join(", ")):'')+' · key '+esc(f.key)+'</small></span><span class="meta"><button class="btn sm ghost" type="button" data-delf="'+esc(f.id)+'" data-label="'+esc(f.label)+'">Delete</button></span></div>' }).join("")+'</div>'
        : '<div class="empty">No extra fields yet. Name and email are built in.</div>')+'<div id="dfHost"></div></section></div>';
    v.innerHTML=html;
    $("#newForm").onclick=function(){ this.disabled=true; api("POST","forms",{name:"Untitled form"}).then(function(r){ go("#/forms/"+r.form.id) }).catch(function(e){ toast(e.message,true) }) };
    $$("[data-go]").forEach(function(tr){ tr.onclick=function(){ go("#/forms/"+tr.dataset.go) }; tr.onkeydown=function(e){ if(e.key==="Enter") go("#/forms/"+tr.dataset.go) } });
    $("#addField").onclick=function(){ var h=$("#nfHost"); h.hidden=false; newFieldForm(h).then(function(f){ h.hidden=true; if(f) route() }) };
    $$("[data-delf]").forEach(function(b){ b.onclick=function(){
      $("#dfHost").innerHTML='<div class="confirm" style="margin:0 18px 16px"><span>Delete the “'+esc(b.dataset.label)+'” field? It comes off every form. Answers already saved on contacts are kept.</span><button class="btn sm danger" type="button" id="dfY">Delete</button><button class="btn sm ghost" type="button" id="dfN">Keep it</button></div>';
      $("#dfN").onclick=function(){ $("#dfHost").innerHTML="" };
      $("#dfY").onclick=function(){ api("DELETE","fields/"+b.dataset.delf).then(function(){ toast("Field deleted"); route() }).catch(function(e){ toast(e.message,true) }) };
    } });
  });
}

function formView(fid, tab){
  tab=tab||"preview";
  return Promise.all([api("GET","forms/"+fid), loadFields(), api("GET","lists"), api("GET","sites")]).then(function(r){
    var f=r[0].form, goBase=r[0].go, fields=r[1], lists=r[2].lists, sites=r[3].sites, v=$("#view");
    var fdef=function(k){ if(k==="name") return {key:"name",label:"Name",type:"text"}; return fields.filter(function(x){return x.key===k})[0] };
    var html='<div class="pagehead"><div><span class="eyebrow"><a href="#/forms" style="color:inherit;text-decoration:none">Forms</a> · '+(f.status==="active"?"on":"off")+'</span><h1 id="fTitle">'+esc(f.name)+'</h1></div>'+
      '<div class="actions"><button class="btn danger" type="button" id="fDel">Delete</button></div></div><div id="fConfirm"></div><div id="campHost"></div>';
    html+='<div class="editor wide"><form class="form panel" id="fForm" autocomplete="off"><h2 class="sec">Form <span class="saving" id="fSave">Saved</span></h2>'+
      '<div class="actions"><button type="button" class="switch" role="switch" id="fOn" aria-checked="'+(f.status==="active")+'" aria-labelledby="fOnLbl"></button><span id="fOnLbl">'+(f.status==="active"?"On: taking sign-ups":"Off: not taking sign-ups")+'</span></div>'+
      '<div class="field"><label for="fName">Name</label><input type="text" id="fName" maxlength="80" value="'+esc(f.name)+'"><span class="hint">Only you see this.</span></div>'+
      '<div class="fieldrow"><div class="field"><label for="fList">Adds people to</label><select id="fList"><option value="">A new list named after this form</option>'+lists.map(function(l){ return '<option value="'+esc(l.id)+'"'+(f.list_id===l.id?" selected":"")+'>'+esc(l.name)+'</option>' }).join("")+'</select></div>'+
      '<div class="field"><label for="fSite">Styled as</label><select id="fSite"><option value="">Plain</option>'+sites.map(function(s){ return '<option value="'+esc(s.id)+'"'+(f.site_id===s.id?" selected":"")+'>'+esc(s.name)+'</option>' }).join("")+'</select></div></div>'+
      '<h2 class="sec">Fields</h2><div class="ffields" id="fFields"></div>'+
      '<div class="actions"><label class="sr" for="fAdd">Add a field</label><select id="fAdd" style="flex:1 1 200px;width:auto"></select><button class="btn sm" type="button" id="fAddGo">Add</button></div><div id="fNewField"></div>'+
      '<h2 class="sec">After they sign up</h2>'+
      '<div class="field"><label for="fBtn">Button text</label><input type="text" id="fBtn" maxlength="40" value="'+esc(f.button)+'"></div>'+
      '<div class="field"><label for="fOk">Thank-you message</label><input type="text" id="fOk" maxlength="300" value="'+esc(f.success)+'"><span class="hint">With double opt-in on, people see “check your inbox” instead.</span></div>'+
      '<div class="field"><label for="fRedir">Or send them to a page</label><input type="text" id="fRedir" maxlength="500" value="'+esc(f.redirect_url)+'" placeholder="https://… (optional)"></div>'+
      '</form><div class="stack"><nav class="tabs" role="tablist">'+[["preview","Preview"],["embed","Use it"],["subs","Sign-ups"]].map(function(t){ return '<a role="tab" href="#/forms/'+esc(fid)+'/'+t[0]+'" aria-selected="'+(tab===t[0])+'">'+t[1]+'</a>' }).join("")+'</nav><div id="fTab"></div></div></div>';
    v.innerHTML=html;
    campaignPicker($("#campHost"),"form",fid,f.initiative_id);
    var save=saver($("#fSave"), function(x){ return api("PATCH","forms/"+fid,x).then(function(rr){ f=rr.form; $("#fTitle").textContent=f.name; if(tab==="preview") showTab() }) });
    function drawFields(){
      var rows=[{key:"email",required:true,fixed:true}].concat(f.fields);
      $("#fFields").innerHTML=rows.map(function(x,i){ var d=x.fixed?{label:"Email",type:"email"}:fdef(x.key)||{label:x.key,type:"?"};
        return '<div class="ffield"><span class="t">'+esc(d.label)+'<small>'+(x.fixed?"Always included":esc(FIELD_TYPE_NAMES[d.type]||d.type))+'</small></span>'+
          (x.fixed?'<span class="hint">Required</span>':'<label class="check"><input type="checkbox" data-req="'+(i-1)+'"'+(x.required?" checked":"")+'> Required</label><span class="ffacts"><button type="button" class="btn sm ghost" data-up="'+(i-1)+'" aria-label="Move up"'+(i===1?" disabled":"")+'>↑</button><button type="button" class="btn sm ghost" data-down="'+(i-1)+'" aria-label="Move down"'+(i===rows.length-1?" disabled":"")+'>↓</button><button type="button" class="btn sm ghost" data-rm="'+(i-1)+'">Remove</button></span>')+'</div>' }).join("");
      var used=f.fields.map(function(x){return x.key});
      var avail=[{key:"name",label:"Name"}].concat(fields).filter(function(x){ return used.indexOf(x.key)<0 });
      $("#fAdd").innerHTML=avail.map(function(x){ return '<option value="'+esc(x.key)+'">'+esc(x.label)+'</option>' }).join("")+'<option value="__new">Create a new field…</option>';
      var commit=function(){ save({fields:f.fields}); save.now() };
      $$("[data-req]").forEach(function(c){ c.onchange=function(){ f.fields[Number(c.dataset.req)].required=c.checked; commit() } });
      $$("[data-up]").forEach(function(b){ b.onclick=function(){ var i=Number(b.dataset.up); var t=f.fields[i-1]; f.fields[i-1]=f.fields[i]; f.fields[i]=t; drawFields(); commit() } });
      $$("[data-down]").forEach(function(b){ b.onclick=function(){ var i=Number(b.dataset.down); var t=f.fields[i+1]; f.fields[i+1]=f.fields[i]; f.fields[i]=t; drawFields(); commit() } });
      $$("[data-rm]",$("#fFields")).forEach(function(b){ b.onclick=function(){ f.fields.splice(Number(b.dataset.rm),1); drawFields(); commit() } });
    }
    $("#fAddGo").onclick=function(){ var k=$("#fAdd").value;
      if(k==="__new"){ newFieldForm($("#fNewField")).then(function(nf){ if(!nf) return; fields.push(nf); f.fields.push({key:nf.key,required:false}); drawFields(); save({fields:f.fields}); save.now() }); return }
      if(!k) return; f.fields.push({key:k,required:false}); drawFields(); save({fields:f.fields}); save.now() };
    drawFields();
    $("#fName").oninput=function(){ save({name:this.value}) };
    $("#fBtn").oninput=function(){ save({button:this.value}) };
    $("#fOk").oninput=function(){ save({success:this.value}) };
    $("#fRedir").oninput=function(){ save({redirect_url:this.value.trim()}) };
    $("#fList").onchange=function(){ save({list_id:this.value||null}); save.now() };
    $("#fSite").onchange=function(){ save({site_id:this.value||null}); save.now() };
    $("#fOn").onclick=function(){ var on=this.getAttribute("aria-checked")!=="true"; this.setAttribute("aria-checked",String(on)); $("#fOnLbl").textContent=on?"On: taking sign-ups":"Off: not taking sign-ups"; save({status:on?"active":"off"}); save.now() };
    $("#fDel").onclick=function(){
      $("#fConfirm").innerHTML='<div class="confirm"><span>Delete this form and its sign-up history? People who signed up stay in Contacts. Anywhere it’s embedded will show nothing.</span><button class="btn sm danger" type="button" id="fdY">Delete</button><button class="btn sm ghost" type="button" id="fdN">Keep it</button></div>';
      $("#fdN").onclick=function(){ $("#fConfirm").innerHTML="" };
      $("#fdY").onclick=function(){ api("DELETE","forms/"+fid).then(function(){ toast("Form deleted"); go("#/forms") }).catch(function(e){ toast(e.message,true) }) };
    };
    function copyBtns(host){ $$("[data-copy]",host).forEach(function(b){ b.onclick=function(){ var t=$("#"+b.dataset.copy).value; (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){ toast("Copied") },function(){ $("#"+b.dataset.copy).select(); document.execCommand("copy"); toast("Copied") }) } }) }
    function showTab(){
      var h=$("#fTab");
      if(tab==="embed"){
        var js='<div data-studio-form="'+fid+'"></div>\n<script src="'+goBase+'/f/'+fid+'.js" async></script>';
        var ifr='<iframe src="'+goBase+'/f/'+fid+'" title="Sign up" style="width:100%;border:0;min-height:320px" loading="lazy"></iframe>';
        var api1='curl -X POST '+goBase+'/f/'+fid+' \\\n  -H "content-type: application/json" \\\n  -d \'{"email":"ada@example.com","name":"Ada","consent":true'+(f.fields.filter(function(x){return x.key!=="name"}).length?',"fields":{'+f.fields.filter(function(x){return x.key!=="name"}).map(function(x){ var d=fdef(x.key)||{}; return '"'+x.key+'":'+(d.type==="multiselect"?'["'+(d.options[0]||"")+'"]':d.type==="checkbox"?"true":d.type==="number"?"1":'"'+(d.options&&d.options[0]||"…")+'"') }).join(",")+'}':'')+'}\'';
        var swift='var req = URLRequest(url: URL(string: "'+goBase+'/f/'+fid+'")!)\nreq.httpMethod = "POST"\nreq.setValue("application/json", forHTTPHeaderField: "content-type")\nreq.httpBody = try JSONSerialization.data(withJSONObject: [\n  "email": email, "name": name, "consent": true\n])\nlet (data, _) = try await URLSession.shared.data(for: req)';
        h.innerHTML='<section class="panel"><h2 class="sec">On your Studio pages</h2><p class="pad" style="margin:0">Open a page, and under “Sign-up form” pick <b>'+esc(f.name)+'</b>.</p></section>'+
          '<section class="panel"><h2 class="sec">On any website <button class="btn sm" type="button" data-copy="snJs">Copy</button></h2><div class="pad stack" style="gap:8px"><p class="hint" style="margin:0">Paste where the form should go. It picks up the page’s font and colours.</p><textarea id="snJs" class="code snippet" readonly>'+esc(js)+'</textarea></div></section>'+
          '<section class="panel"><h2 class="sec">As an iframe <button class="btn sm" type="button" data-copy="snIf">Copy</button></h2><div class="pad stack" style="gap:8px"><p class="hint" style="margin:0">For site builders that don’t allow scripts.</p><textarea id="snIf" class="code snippet" readonly>'+esc(ifr)+'</textarea></div></section>'+
          '<section class="panel"><h2 class="sec">From an app <button class="btn sm" type="button" data-copy="snApi">Copy</button></h2><div class="pad stack" style="gap:8px"><p class="hint" style="margin:0">Send JSON from Seek or any app. Ask people to agree to emails in the app, then send <code>"consent": true</code>. Replies with <code>{"ok": true, "message": …}</code>, or <code>{"ok": false, "error": …}</code> to show them.</p><textarea id="snApi" class="code snippet" readonly>'+esc(api1)+'</textarea>'+
            '<details><summary class="hint" style="cursor:pointer">Swift example</summary><textarea id="snSw" class="code snippet" readonly>'+esc(swift)+'</textarea><button class="btn sm" type="button" data-copy="snSw">Copy</button></details></div></section>'+
          '<section class="panel"><h2 class="sec">As a link <button class="btn sm" type="button" data-copy="snLink">Copy</button></h2><div class="pad"><input type="text" id="snLink" readonly value="'+esc(goBase+'/f/'+fid)+'"></div></section>';
        copyBtns(h);
      } else if(tab==="subs"){
        h.innerHTML='<div class="loading">Loading…</div>';
        api("GET","forms/"+fid+"/submissions").then(function(d){
          var keys=[]; d.submissions.forEach(function(s){ Object.keys(s.data).forEach(function(k){ if(keys.indexOf(k)<0) keys.push(k) }) });
          var lab=function(k){ var x=fdef(k); return x?x.label:k };
          var cell=function(v){ return Array.isArray(v)?v.join(", "):v===1&&true?"Yes":v===0?"No":String(v==null?"":v) };
          h.innerHTML='<section class="panel"><h2 class="sec">Sign-ups <span class="actions"><span class="hint">'+d.submissions.length+(d.submissions.length===100?"+":"")+'</span>'+(d.submissions.length?'<button class="btn sm" type="button" id="subCsv">Export CSV</button>':'')+'</span></h2>'+
            (d.submissions.length ? '<div class="tablewrap"><table><thead><tr><th>When</th><th>Email</th>'+keys.map(function(k){return '<th>'+esc(lab(k))+'</th>'}).join("")+'<th>From</th></tr></thead><tbody>'+d.submissions.map(function(s){
              var host=""; try{ host=s.page_url?new URL(s.page_url).hostname:"" }catch(e){}
              return '<tr><td class="mono">'+fmtDate(s.created_at,true)+'</td><td>'+(s.contact_id?'<a href="#/contacts" data-contact="'+esc(s.contact_id)+'">'+esc(s.email||"")+'</a>':esc(s.email||"—"))+'</td>'+keys.map(function(k){ return '<td>'+esc(cell(s.data[k]))+'</td>' }).join("")+'<td class="mono">'+esc(host||"—")+'</td></tr>' }).join("")+'</tbody></table></div>'
              : '<div class="empty">No sign-ups yet.</div>')+'</section>';
          $$("[data-contact]",h).forEach(function(a){ a.onclick=function(e){ e.preventDefault(); store("studio.openContact",a.dataset.contact); go("#/contacts") } });
          var cb=$("#subCsv"); if(cb) cb.onclick=function(){ api("GET","forms/"+fid+"/submissions?limit=2000").then(function(all){
            var lines=[["when","email"].concat(keys.map(lab)).concat(["page"]).map(csvCell).join(",")].concat(all.submissions.map(function(s){ return [new Date(s.created_at).toISOString(), s.email||""].concat(keys.map(function(k){ return cell(s.data[k]) })).concat([s.page_url||""]).map(csvCell).join(",") }));
            var blob=new Blob([lines.join("\n")],{type:"text/csv"}), a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=slugify(f.name)+"-signups.csv"; document.body.appendChild(a); a.click(); a.remove() }) };
        }).catch(function(e){ h.innerHTML='<div class="notice danger"><p>'+esc(e.message)+'</p></div>' });
      } else {
        h.innerHTML='<div class="proof"><div class="proofbar"><span class="url">'+esc(goBase+'/f/'+fid)+'</span></div><iframe id="fPv" title="Form preview" style="height:520px;background:#fff" src="'+esc(goBase+'/f/'+fid+'?preview=1&t='+Date.now())+'"></iframe></div>'+
          (f.status!=="active"?'<p class="hint">This form is off, so the preview shows nothing until you switch it on.</p>':'<p class="hint">The preview doesn’t save anything.</p>');
      }
    }
    showTab();
  });
}

/* ============ smart list rules ============ */
var STATUS_OPTS=[["subscribed","Subscribed"],["unsubscribed","Unsubscribed"],["pending","Waiting to confirm"],["bounced","Bounced"],["complained","Marked as spam"]];
function ruleFields(ctx){
  var out=[
    {k:"email",l:"Email",ops:[["contains","contains"],["ends_with","ends with"],["is","is"]],val:"text"},
    {k:"name",l:"Name",ops:[["is_set","is filled in"],["not_set","is empty"],["contains","contains"]],val:"text"},
    {k:"status",l:"Status",ops:[["is","is"],["is_not","is not"]],val:"select",opts:STATUS_OPTS},
    {k:"signed_up",l:"Signed up",ops:[["in_last_days","in the last … days"],["more_than_days","more than … days ago"]],val:"number"},
    {k:"list",l:"List",ops:[["in","is on"],["not_in","is not on"]],val:"select",opts:ctx.lists.map(function(l){return [l.id,l.name]})},
    {k:"form",l:"Form",ops:[["submitted","filled in"],["not_submitted","hasn’t filled in"]],val:"select",opts:ctx.forms.map(function(f){return [f.id,f.name]})},
    {k:"opened",l:"Opened an email",ops:[["in_last_days","in the last … days"],["not_in_last_days","not in the last … days"]],val:"number"},
    {k:"clicked",l:"Clicked",ops:[["campaign","a link in"],["not_campaign","nothing in"],["in_last_days","any email link in the last … days"]],val:"campaign",opts:ctx.campaigns.filter(function(c){return c.status!=="draft"}).map(function(c){return [c.id,c.name]})},
    {k:"came_from",l:"Came from a social post",ops:[["is","on"],["any","on any platform"]],val:"select",opts:PLAT_ORDER.map(function(p){return [p,platName(p)]})},
    {k:"source",l:"Signed up on page",ops:[["contains","contains"]],val:"text"}
  ];
  ctx.fields.forEach(function(f){
    var ops = f.type==="multiselect"?[["has","includes"],["has_not","doesn’t include"]] : f.type==="checkbox"?[["is_true","is ticked"],["is_false","isn’t ticked"]] : f.type==="number"?[["gt","is more than"],["lt","is less than"],["eq","is"]] : f.type==="date"?[["after","is after"],["before","is before"]] : [["is","is"],["is_not","is not"],["contains","contains"]];
    ops=ops.concat([["is_set","is filled in"],["not_set","is empty"]]);
    out.push({k:"field:"+f.key,l:f.label,ops:ops,val:(f.type==="select"||f.type==="multiselect")?"select":f.type==="number"?"number":f.type==="date"?"date":f.type==="checkbox"?"none":"text",opts:f.options.map(function(o){return [o,o]})});
  });
  return out;
}
var NO_VALUE=["is_set","not_set","is_true","is_false","any"];
function loadRuleContext(){ return Promise.all([api("GET","lists"), api("GET","forms"), api("GET","campaigns"), loadFields(), loadSocialMeta().catch(function(){return null})]).then(function(r){ return {lists:r[0].lists, forms:r[1].forms, campaigns:r[2].campaigns, fields:r[3]} }) }
function ruleSummary(rules, ctx){
  var defs=ruleFields(ctx);
  return rules.rules.map(function(r){ var d=defs.filter(function(x){return x.k===r.field})[0]; if(!d) return "?"; var op=(d.ops.filter(function(o){return o[0]===r.op})[0]||[,r.op])[1];
    var val=NO_VALUE.indexOf(r.op)>-1?"":(d.opts&&(d.opts.filter(function(o){return o[0]===r.value})[0]||[])[1])||r.value||"";
    return d.l+" "+(op.indexOf("…")>-1?op.replace("…",val):op+(val?" "+val:"")) }).join(rules.match==="any"?" or ":" and ") || "Everyone";
}
/** Rule builder. onSave(name, rules) → Promise. */
function segmentEditor(host, ctx, seg, onSave, onCancel){
  var rules=seg?JSON.parse(JSON.stringify(seg.rules)):{match:"all",rules:[{field:"status",op:"is",value:"subscribed"}]};
  var defs=ruleFields(ctx), timer;
  function valInput(r,i,d){
    if(NO_VALUE.indexOf(r.op)>-1) return "";
    if(d.val==="select"||d.val==="campaign"&&r.op!=="in_last_days") return '<select data-rv="'+i+'"><option value="">Choose…</option>'+(d.opts||[]).map(function(o){ return '<option value="'+esc(o[0])+'"'+(String(r.value)===String(o[0])?" selected":"")+'>'+esc(o[1])+'</option>' }).join("")+'</select>';
    if(d.val==="number"||r.op==="in_last_days"||r.op==="more_than_days"||r.op==="not_in_last_days") return '<input type="number" min="0" data-rv="'+i+'" value="'+esc(r.value==null?"":r.value)+'" style="width:110px">';
    if(d.val==="date") return '<input type="date" data-rv="'+i+'" value="'+esc(r.value||"")+'">';
    return '<input type="text" data-rv="'+i+'" value="'+esc(r.value||"")+'" maxlength="200">';
  }
  function draw(){
    host.innerHTML='<form class="drawer" id="sgF"><h2 class="sec">'+(seg?"Edit smart list":"New smart list")+'</h2>'+
      '<div class="field"><label for="sgName">Name</label><input type="text" id="sgName" maxlength="60" value="'+esc(seg?seg.name:"")+'" placeholder="e.g. Irish launch clickers" required></div>'+
      '<div class="actions"><span>People who match</span><select id="sgMatch" style="width:auto"><option value="all"'+(rules.match==="all"?" selected":"")+'>all</option><option value="any"'+(rules.match==="any"?" selected":"")+'>any</option></select><span>of these:</span></div>'+
      '<div class="rules">'+rules.rules.map(function(r,i){ var d=defs.filter(function(x){return x.k===r.field})[0]||defs[0];
        return '<div class="rule"><select data-rf="'+i+'">'+defs.map(function(x){ return '<option value="'+esc(x.k)+'"'+(x.k===d.k?" selected":"")+'>'+esc(x.l)+'</option>' }).join("")+'</select>'+
          '<select data-ro="'+i+'">'+d.ops.map(function(o){ return '<option value="'+o[0]+'"'+(o[0]===r.op?" selected":"")+'>'+esc(o[1])+'</option>' }).join("")+'</select>'+valInput(r,i,d)+
          '<button type="button" class="btn sm ghost" data-rx="'+i+'" aria-label="Remove rule">Remove</button></div>' }).join("")+'</div>'+
      '<div class="actions"><button type="button" class="btn sm" id="sgAdd">Add a rule</button></div>'+
      '<p class="sgcount" id="sgCount">Counting…</p>'+
      '<div class="actions"><button class="btn primary" type="submit">'+(seg?"Save":"Create smart list")+'</button><button class="btn ghost" type="button" id="sgCancel">Cancel</button></div></form>';
    $$("[data-rf]",host).forEach(function(s){ s.onchange=function(){ var i=Number(s.dataset.rf), d=defs.filter(function(x){return x.k===s.value})[0]; rules.rules[i]={field:d.k, op:d.ops[0][0], value:""}; draw() } });
    $$("[data-ro]",host).forEach(function(s){ s.onchange=function(){ var i=Number(s.dataset.ro); rules.rules[i].op=s.value; draw() } });
    $$("[data-rv]",host).forEach(function(s){ s.oninput=s.onchange=function(){ rules.rules[Number(s.dataset.rv)].value=s.value; count() } });
    $$("[data-rx]",host).forEach(function(b){ b.onclick=function(){ rules.rules.splice(Number(b.dataset.rx),1); draw() } });
    $("#sgMatch",host).onchange=function(){ rules.match=this.value; count() };
    $("#sgAdd",host).onclick=function(){ rules.rules.push({field:"email",op:"contains",value:""}); draw() };
    $("#sgCancel",host).onclick=onCancel;
    $("#sgF",host).onsubmit=function(e){ e.preventDefault(); var b=this.querySelector("[type=submit]"); b.disabled=true; onSave($("#sgName",host).value, rules).catch(function(err){ b.disabled=false; toast(err.message,true) }) };
    count();
  }
  function ready(){ return rules.rules.filter(function(r){ return NO_VALUE.indexOf(r.op)>-1 || (r.value!==""&&r.value!=null) }) }
  function count(){ clearTimeout(timer); timer=setTimeout(function(){
    var el=$("#sgCount",host); if(!el) return;
    api("POST","segments/preview",{rules:{match:rules.match, rules:ready()}}).then(function(d){ if(!$("#sgCount",host)) return;
      el.innerHTML='<b>'+d.count+'</b> '+(d.count===1?"person matches":"people match")+' · '+d.subscribed+' subscribed'+(d.sample.length?'<span class="hint"> · e.g. '+d.sample.map(function(x){return esc(x.name||x.email)}).join(", ")+'</span>':'') })
      .catch(function(e){ if($("#sgCount",host)) el.textContent=e.message }) },300) }
  S.cleanup.push(function(){ clearTimeout(timer) });
  draw();
}

/* ============ emails ============ */
function emailsView(){
  return api("GET","campaigns").then(function(d){
    var v=$("#view");
    var html=head("Marketing", "Emails", "Campaigns to your lists. Welcome emails live on each site.", '<button class="btn primary" type="button" id="newEmail">New email</button>')+emailBanner();
    if(!d.campaigns.length) html+='<div class="empty"><b>No emails yet</b>Write one and send it to a list, or to everyone.</div>';
    else html+='<div class="tablewrap"><table><thead><tr><th>Email</th><th>To</th><th>Status</th><th class="r">Sent</th><th class="r">Opened</th><th class="r">Clicked</th></tr></thead><tbody>'+
      d.campaigns.map(function(c){ var s=c.stats||{};
        return '<tr class="click" data-go="'+esc(c.id)+'" tabindex="0"><td>'+esc(c.name)+'<span class="sub">'+esc(c.subject||"No subject yet")+'</span></td><td>'+esc(c.list_name||"Everyone")+'</td><td><span class="chip '+esc(c.status)+'">'+esc(c.status)+'</span><span class="sub">'+(c.status==="scheduled"?fmtDate(c.scheduled_at,true):c.sent_at?fmtDate(c.sent_at,true):"")+'</span></td>'+
        '<td class="r mono">'+(s.sent||"—")+'</td><td class="r mono">'+(s.sent?pct(s.opened,s.sent):"—")+'</td><td class="r mono">'+(s.sent?pct(s.clicked,s.sent):"—")+'</td></tr>' }).join("")+'</tbody></table></div>';
    v.innerHTML=html;
    $("#newEmail").onclick=function(){ api("POST","campaigns",{name:"Untitled email"}).then(function(r){ refreshNav(); go("#/emails/"+r.campaign.id) }).catch(function(e){ toast(e.message,true) }) };
    $$("[data-go]").forEach(function(tr){ tr.onclick=function(){ go("#/emails/"+tr.dataset.go) }; tr.onkeydown=function(e){ if(e.key==="Enter") go("#/emails/"+tr.dataset.go) } });
  });
}

function emailView(cid){
  return Promise.all([api("GET","campaigns/"+cid), api("GET","lists"), api("GET","sites"), api("GET","segments")]).then(function(r){
    var cp=r[0].campaign, stats=r[0].stats||{}, audience=r[0].audience, lists=r[1].lists, sites=r[2].sites, segs=r[3].segments;
    var v=$("#view"), editable = cp.status==="draft"||cp.status==="scheduled";
    var listLabel=function(id){ if(id&&id.indexOf("seg:")===0){ var g=segs.filter(function(x){return "seg:"+x.id===id})[0]; return g? g.name+" (smart list)" : "a smart list" } var l=lists.filter(function(x){return x.id===id})[0]; return l? l.name : "Everyone subscribed" };
    var html='<div class="pagehead"><div><span class="eyebrow"><a href="#/emails" style="color:inherit;text-decoration:none">Emails</a> · '+esc(cp.status)+'</span><h1 id="cpTitle">'+esc(cp.name)+'</h1><p class="sub"><span class="chip '+esc(cp.status)+'">'+esc(cp.status)+'</span> '+
      (cp.status==="scheduled" ? "Goes out "+fmtDate(cp.scheduled_at,true) : cp.sent_at ? "Sent "+fmtDate(cp.sent_at,true)+" to "+esc(listLabel(cp.list_id)) : "")+'</p></div>'+
      '<div class="actions"><button class="btn" type="button" id="dupBtn">Duplicate</button>'+(cp.status!=="sending"?'<button class="btn danger" type="button" id="delBtn">Delete</button>':'')+'</div></div><div id="delConfirm"></div><div id="campHost"></div>';
    if(!editable){
      var sent=stats.sent||0;
      html+='<div class="stats"><div><b>'+sent+'</b><span>sent'+(stats.queued?' · '+stats.queued+' to go':'')+'</span></div><div><b>'+pct(stats.opened||0,sent)+'</b><span>opened ('+(stats.opened||0)+')</span></div><div><b>'+pct(stats.clicked||0,sent)+'</b><span>clicked ('+(stats.clicked||0)+')</span></div><div><b>'+(stats.bounced||0)+'</b><span>bounced'+(stats.complained?' · '+stats.complained+' spam':'')+'</span></div><div><b>'+(stats.failed||0)+'</b><span>failed</span></div></div>';
      if(stats.failed) html+='<div class="notice danger"><p>'+stats.failed+' didn’t send. Last error: '+esc(stats.last_error||"unknown")+'</p><button class="btn sm" type="button" id="retryBtn">Try again</button></div>';
      html+='<p class="hint">Opens are approximate: some email apps block the tracking image, others load it automatically.</p>';
      html+='<div class="proof email"><div class="proofbar"><span class="url">'+esc(cp.subject)+'</span></div><iframe id="pv" title="Email preview" sandbox=""></iframe></div>';
      v.innerHTML=html;
      campaignPicker($("#campHost"),"email",cid,cp.initiative_id);
      emailPreview($("#pv"),{subject:cp.subject, preheader:cp.preheader, body:cp.body, site_id:cp.site_id});
      if(cp.status==="sending"){ var poll=setInterval(function(){ route() },5000); S.cleanup.push(function(){ clearInterval(poll) }) }
      var rb=$("#retryBtn"); if(rb) rb.onclick=function(){ api("POST","campaigns/"+cid+"/retry").then(function(){ toast("Retrying"); route() }).catch(function(e){ toast(e.message,true) }) };
    } else {
      html+=emailBanner()+'<div class="editor"><form class="form panel" id="cpForm" autocomplete="off"><h2 class="sec">Compose <span class="saving" id="cpSave">Saved</span></h2>'+
        '<div class="field"><label for="cpName">Internal name</label><input type="text" id="cpName" maxlength="80" value="'+esc(cp.name)+'"><span class="hint">Only you see this.</span></div>'+
        '<div class="fieldrow"><div class="field"><label for="cpList">Send to</label><select id="cpList"><option value="">Everyone subscribed</option><optgroup label="Lists">'+lists.map(function(l){ return '<option value="'+esc(l.id)+'"'+(cp.list_id===l.id?" selected":"")+'>'+esc(l.name)+' ('+l.subscribed+')</option>' }).join("")+'</optgroup>'+(segs.length?'<optgroup label="Smart lists">'+segs.map(function(g){ return '<option value="seg:'+esc(g.id)+'"'+(cp.segment_id===g.id?" selected":"")+'>'+esc(g.name)+' ('+g.subscribed+')</option>' }).join("")+'</optgroup>':'')+'</select></div>'+
        '<div class="field"><label for="cpSite">Styled as</label><select id="cpSite"><option value="">Just me</option>'+sites.map(function(s){ return '<option value="'+esc(s.id)+'"'+(cp.site_id===s.id?" selected":"")+'>'+esc(s.name)+'</option>' }).join("")+'</select></div></div>'+
        '<div class="field"><label for="cpSubj">Subject</label><input type="text" id="cpSubj" maxlength="150" value="'+esc(cp.subject)+'" placeholder="What’s in it for them?"></div>'+
        '<div class="field"><label for="cpPre">Preview line</label><input type="text" id="cpPre" maxlength="200" value="'+esc(cp.preheader)+'"><span class="hint">The grey text after the subject in most inboxes.</span></div>'+
        '<div class="field"><label for="cpBody">Message</label><textarea id="cpBody" class="code">'+esc(cp.body)+'</textarea><span class="hint">{{name}} becomes their first name, or “there”. Markdown: ## heading, **bold**, [link](https://…), - list.</span></div>'+
        '<h2 class="sec">Test</h2><div class="actions"><label class="sr" for="cpTest">Send a test to</label><input type="email" id="cpTest" value="'+esc(store("proof.testto")||(S.me.email.indexOf("@localhost")>-1?"":S.me.email))+'" placeholder="you@email.com" style="flex:1 1 200px;width:auto"><button class="btn" type="button" id="testBtn">Send test</button></div>'+
        '<h2 class="sec">Send</h2><p id="audience" class="muted"></p>'+
        (cp.status==="scheduled" ? '<div class="notice"><p>Scheduled for '+fmtDate(cp.scheduled_at,true)+'.</p><button class="btn sm" type="button" id="unschedBtn">Cancel schedule</button></div>' :
        '<div class="actions"><button class="btn primary" type="button" id="sendBtn">Send now</button><span class="muted">or</span><label class="sr" for="cpAt">Schedule for</label><input type="datetime-local" id="cpAt" style="width:auto"><button class="btn" type="button" id="schedBtn">Schedule</button></div>')+
        '<div id="sendConfirm"></div></form>'+
        '<div class="proof email"><div class="proofbar"><span class="url">inbox view</span></div><iframe id="pv" title="Email preview" sandbox=""></iframe></div></div>';
      v.innerHTML=html;
      campaignPicker($("#campHost"),"email",cid,cp.initiative_id);
      imageButton($("#cpBody"), $("#cpBody").nextElementSibling);
      var showAudience=function(n){ audience=n; var val=$("#cpList").value||null; $("#audience").textContent = "Goes to "+n+" subscribed "+(n===1?"person":"people")+" "+(val&&val.indexOf("seg:")===0?"in":"on")+" “"+listLabel(val)+"”"+(val&&val.indexOf("seg:")===0?", counted again at the moment it sends":"")+". Unsubscribed people are always left out." };
      showAudience(audience);
      var t; function preview(){ clearTimeout(t); t=setTimeout(function(){ emailPreview($("#pv"),{subject:$("#cpSubj").value, preheader:$("#cpPre").value, body:$("#cpBody").value, site_id:$("#cpSite").value||null}) },250) }
      S.cleanup.push(function(){ clearTimeout(t) });
      var save=saver($("#cpSave"), function(d){ return api("PATCH","campaigns/"+cid,d).then(function(r){ cp=r.campaign; showAudience(r.audience); $("#cpTitle").textContent=cp.name }) });
      $("#cpName").oninput=function(){ save({name:this.value}) };
      $("#cpSubj").oninput=function(){ save({subject:this.value}); preview() };
      $("#cpPre").oninput=function(){ save({preheader:this.value}); preview() };
      $("#cpBody").oninput=function(){ save({body:this.value}); preview() };
      $("#cpList").onchange=function(){ var val=this.value; if(val.indexOf("seg:")===0) save({segment_id:val.slice(4)}); else save({list_id:val||null}); save.now() };
      $("#cpSite").onchange=function(){ save({site_id:this.value||null}); save.now(); preview() };
      $("#testBtn").onclick=function(){
        var to=$("#cpTest").value.trim(), b=this; store("proof.testto",to); save.now(); b.disabled=true;
        setTimeout(function(){ api("POST","campaigns/"+cid+"/test",{to:to}).then(function(){ toast("Test sent to "+to) }).catch(function(e){ toast(e.message,true) }).then(function(){ b.disabled=false }) },400);
      };
      var confirmBox=function(text, label, fn){
        $("#sendConfirm").innerHTML='<div class="confirm"><span>'+text+'</span><button class="btn sm primary" type="button" id="cfYes">'+label+'</button><button class="btn sm ghost" type="button" id="cfNo">Not yet</button></div>';
        $("#cfNo").onclick=function(){ $("#sendConfirm").innerHTML="" };
        $("#cfYes").onclick=function(){ this.disabled=true; fn() };
      };
      var sb=$("#sendBtn");
      if(sb) sb.onclick=function(){ save.now();
        if(!$("#cpSubj").value.trim()){ toast("Add a subject line first.",true); return }
        confirmBox("Send “"+esc($("#cpSubj").value)+"” to "+audience+" "+(audience===1?"person":"people")+" now? This can’t be undone.", "Send it", function(){
          setTimeout(function(){ api("POST","campaigns/"+cid+"/send",{}).then(function(r){ toast("Sending to "+r.queued); route() }).catch(function(e){ toast(e.message,true); $("#sendConfirm").innerHTML="" }) },400);
        });
      };
      var sc=$("#schedBtn");
      if(sc) sc.onclick=function(){ save.now();
        var val=$("#cpAt").value; if(!val){ toast("Pick a date and time first.",true); return }
        var at=new Date(val).getTime();
        confirmBox("Send to "+audience+" "+(audience===1?"person":"people")+" on "+esc(fmtDate(at,true))+"?", "Schedule", function(){
          setTimeout(function(){ api("POST","campaigns/"+cid+"/send",{at:at}).then(function(){ toast("Scheduled"); route() }).catch(function(e){ toast(e.message,true); $("#sendConfirm").innerHTML="" }) },400);
        });
      };
      var us=$("#unschedBtn"); if(us) us.onclick=function(){ api("POST","campaigns/"+cid+"/cancel").then(function(){ toast("Back to draft"); route() }) };
      preview();
    }
    $("#dupBtn").onclick=function(){ api("POST","campaigns/"+cid+"/duplicate").then(function(r){ toast("Copy made"); go("#/emails/"+r.campaign.id) }).catch(function(e){ toast(e.message,true) }) };
    var db=$("#delBtn"); if(db) db.onclick=function(){
      $("#delConfirm").innerHTML='<div class="confirm"><span>Delete this email'+(cp.status==="sent"?" and its stats":"")+'?</span><button class="btn sm danger" type="button" id="dYes">Delete</button><button class="btn sm ghost" type="button" id="dNo">Keep it</button></div>';
      $("#dNo").onclick=function(){ $("#delConfirm").innerHTML="" };
      $("#dYes").onclick=function(){ api("DELETE","campaigns/"+cid).then(function(){ toast("Deleted"); go("#/emails") }).catch(function(e){ toast(e.message,true) }) };
    };
  });
}

/* ============ automations ============ */
var CONDS = [
  ["always","Always send"],
  ["opened","Only if they opened the last email"],
  ["not_opened","Only if they didn’t open the last email"],
  ["clicked","Only if they clicked a link in the last email"],
  ["not_clicked","Only if they didn’t click the last email"]
];
var CONDS_SHORT = { opened:"if they opened the last one", not_opened:"if they didn’t open the last one", clicked:"if they clicked the last one", not_clicked:"if they didn’t click the last one" };
function splitDelay(min){ if(!min) return [0,"days"]; if(min%1440===0) return [min/1440,"days"]; if(min%60===0) return [min/60,"hours"]; return [min,"minutes"] }
function delayText(min, first){
  if(!min) return first ? "Straight away" : "Straight after the last one";
  var d=splitDelay(min), unit=d[1].replace(/s$/,""); return "Wait "+d[0]+" "+unit+(d[0]===1?"":"s");
}
function triggerText(q){
  if(q.trigger==="click") return q.campaign_name ? "Clicks a link in “"+q.campaign_name+"”" : "Clicks a link in an email";
  if(q.trigger==="manual") return "Added by hand";
  return q.list_name ? "Joins "+q.list_name : "Joins a list";
}

function automationsView(){
  return api("GET","sequences").then(function(d){
    var v=$("#view");
    var html=head("Marketing","Automations","Emails that send themselves when someone signs up or clicks, spaced out over days.",'<button class="btn primary" type="button" id="newAuto">New automation</button>')+emailBanner();
    if(!d.sequences.length){
      html+='<div class="empty"><b>No automations yet</b>A good first one: when someone joins a waitlist, send a welcome now, a behind-the-scenes email in 3 days, and a nudge a week later.</div>';
    } else {
      html+='<div class="tablewrap"><table><thead><tr><th>Automation</th><th>Starts when someone</th><th>Status</th><th class="r">Emails</th><th class="r">In it now</th><th class="r">Finished</th><th class="r">Sent</th></tr></thead><tbody>'+
        d.sequences.map(function(q){
          return '<tr class="click" data-go="'+esc(q.id)+'" tabindex="0"><td>'+esc(q.name)+'</td><td>'+esc(triggerText(q))+'</td><td><span class="chip '+esc(q.status)+'">'+esc(q.status==="active"?"on":q.status)+'</span></td>'+
            '<td class="r mono">'+q.steps+'</td><td class="r mono">'+q.active+'</td><td class="r mono">'+q.completed+'</td><td class="r mono">'+q.sent+'</td></tr>' }).join("")+'</tbody></table></div>';
    }
    v.innerHTML=html;
    $("#newAuto").onclick=function(){ this.disabled=true; api("POST","sequences",{name:"Untitled automation"}).then(function(r){ refreshNav(); go("#/automations/"+r.id) }).catch(function(e){ toast(e.message,true) }) };
    $$("[data-go]").forEach(function(tr){ tr.onclick=function(){ go("#/automations/"+tr.dataset.go) }; tr.onkeydown=function(e){ if(e.key==="Enter") go("#/automations/"+tr.dataset.go) } });
  });
}

function automationView(qid, stepParam){
  return Promise.all([api("GET","sequences/"+qid), api("GET","lists"), api("GET","campaigns"), api("GET","sites")]).then(function(r){
    var d=r[0], q=d.sequence, steps=d.steps, lists=r[1].lists, camps=r[2].campaigns, sites=r[3].sites, counts=d.counts||{};
    var v=$("#view");
    var sel = steps.filter(function(s){return s.id===stepParam})[0] || steps[0];
    var on = q.status==="active";
    var listById=function(id){ return lists.filter(function(l){return l.id===id})[0] };

    var html='<div class="pagehead"><div><span class="eyebrow"><a href="#/automations" style="color:inherit;text-decoration:none">Automations</a> · '+(on?"on":esc(q.status))+'</span><h1 id="aTitle">'+esc(q.name)+'</h1>'+
      '<p class="sub">'+(counts.total||0)+' started · '+(counts.active||0)+' in it now · '+(counts.completed||0)+' finished'+(counts.exited?' · '+counts.exited+' left early':'')+'</p></div>'+
      '<div class="actions"><button class="btn danger" type="button" id="aDel">Delete</button>'+
      (on ? '<button class="btn" type="button" id="aPause">Pause</button>' : '<button class="btn primary" type="button" id="aOn">'+(q.status==="paused"?"Turn back on":"Turn on")+'</button>')+'</div></div><div id="aConfirm"></div>';
    if(on) html+='<div class="notice"><p><b>This is on.</b> Changes to the emails apply to the next one each person gets. People already waiting keep their place.</p></div>';
    else if(q.status==="paused") html+='<div class="notice"><p><b>Paused.</b> Nobody new starts and nothing sends. People already in it wait where they are until you turn it back on.</p></div>';
    else html+=emailBanner();

    // left: the flow
    var flow='<div class="flow"><section class="node trig panel"><span class="eyebrow">Starts when someone</span>'+
      '<div class="field"><label for="aName">Name</label><input type="text" id="aName" maxlength="80" value="'+esc(q.name)+'"></div>'+
      '<div class="field"><label for="aTrig">Trigger</label><select id="aTrig">'+
        [["list","Joins a list"],["click","Clicks a link in an email"],["manual","Is added by hand"]].map(function(o){ return '<option value="'+o[0]+'"'+(q.trigger===o[0]?" selected":"")+'>'+o[1]+'</option>' }).join("")+'</select></div>'+
      '<div class="field" id="aListF"'+(q.trigger==="list"?"":" hidden")+'><label for="aList">List</label><select id="aList"><option value="">Pick a list</option>'+lists.map(function(l){ return '<option value="'+esc(l.id)+'"'+(q.trigger_list_id===l.id?" selected":"")+'>'+esc(l.name)+'</option>' }).join("")+'</select>'+
        '<span class="hint">Counts new sign-ups from your pages (after they confirm, if double opt-in is on). Imports and people you add by hand don’t start it.</span></div>'+
      '<div class="field" id="aCampF"'+(q.trigger==="click"?"":" hidden")+'><label for="aCamp">Email</label><select id="aCamp"><option value="">Pick an email</option>'+camps.map(function(c){ return '<option value="'+esc(c.id)+'"'+(q.trigger_campaign_id===c.id?" selected":"")+'>'+esc(c.name)+(c.status==="draft"?" (draft)":"")+'</option>' }).join("")+'</select>'+
        '<span class="hint">Starts for anyone who clicks any link in that email, the first time they click.</span></div>'+
      '<p class="hint" id="aManF"'+(q.trigger==="manual"?"":" hidden")+'>Add people from their page in Contacts.</p>'+
      '<div class="field"><label for="aSite">Styled as</label><select id="aSite"><option value="">Just me</option>'+sites.map(function(s){ return '<option value="'+esc(s.id)+'"'+(q.site_id===s.id?" selected":"")+'>'+esc(s.name)+'</option>' }).join("")+'</select></div>'+
      (on && q.trigger==="list" && q.trigger_list_id ? '<div class="actions"><button class="btn sm" type="button" id="aBack">Also start everyone already on '+esc((listById(q.trigger_list_id)||{}).name||"the list")+'</button></div><div id="aBackC"></div>' : '')+
      '<span class="saving" id="aSave">Saved</span></section>';
    steps.forEach(function(s,i){
      flow+='<div class="wait"><span>'+esc(delayText(s.delay_minutes, i===0))+(i>0 && s.condition!=="always" ? ', then only '+esc(CONDS_SHORT[s.condition]) : '')+'</span></div>'+
        '<a class="node step" href="#/automations/'+esc(q.id)+'/'+esc(s.id)+'" aria-current="'+(sel&&s.id===sel.id)+'"><span class="n">'+(i+1)+'</span><span class="t"><b>'+esc(s.subject||"No subject yet")+'</b>'+
        '<small>'+(s.sent ? s.sent+' sent · '+pct(s.opened,s.sent)+' opened · '+pct(s.clicked,s.sent)+' clicked' : 'Not sent yet')+(s.queued?' · '+s.queued+' sending':'')+'</small></span></a>';
    });
    flow+='<div class="wait end"><span>'+(steps.length?"Then they’re done":"")+'</span></div><button class="btn" type="button" id="aAdd">Add an email</button>';
    flow+='<section class="panel"><h2 class="sec">People <span class="hint">latest 25</span></h2>'+(d.people.length ? '<div class="tablewrap"><table><tbody>'+d.people.map(function(p){
        var where = p.status==="active" ? "Email "+(p.step_index+1)+" due "+(p.next_at?fmtDate(p.next_at,true):"soon") : p.status==="completed" ? "Got every email" : "Left early: "+(p.exit_reason||"");
        return '<tr><td><a href="#/contacts" data-contact="'+esc(p.contact_id)+'" style="text-decoration:none">'+esc(p.name||p.email)+'</a><span class="sub">'+esc(where)+'</span></td><td class="r"><span class="chip '+esc(p.status)+'">'+esc(p.status==="active"?"in it":p.status)+'</span></td></tr>' }).join("")+'</tbody></table></div>'
      : '<div class="empty">Nobody yet.</div>')+'</section></div>';

    // right: the selected email
    var edit='';
    if(sel){
      var idx=steps.indexOf(sel), dl=splitDelay(sel.delay_minutes);
      edit='<div class="stack"><form class="form panel" id="stForm" autocomplete="off"><h2 class="sec">Email '+(idx+1)+' of '+steps.length+' <span class="saving" id="stSave">Saved</span></h2>'+
        '<div class="fieldrow"><div class="field"><label for="stWait">'+(idx===0?"After they start, wait":"After the last email, wait")+'</label><div class="affix"><input type="number" id="stWait" min="0" max="365" step="1" value="'+dl[0]+'" style="border:0;padding:8px 11px;background:none;width:100%"><select id="stUnit" style="border:0;border-left:1px solid var(--line);width:auto;background:var(--soft)">'+
          ["minutes","hours","days"].map(function(u){ return '<option'+(dl[1]===u?" selected":"")+'>'+u+'</option>' }).join("")+'</select></div><span class="hint">0 sends it straight away.</span></div>'+
        (idx>0 ? '<div class="field"><label for="stCond">Send it</label><select id="stCond">'+CONDS.map(function(c){ return '<option value="'+c[0]+'"'+(sel.condition===c[0]?" selected":"")+'>'+c[1]+'</option>' }).join("")+'</select><span class="hint">If not, this one is skipped and they carry on to the next.</span></div>' : '')+'</div>'+
        '<div class="field"><label for="stSubj">Subject</label><input type="text" id="stSubj" maxlength="150" value="'+esc(sel.subject)+'" placeholder="What’s in it for them?"></div>'+
        '<div class="field"><label for="stPre">Preview line</label><input type="text" id="stPre" maxlength="200" value="'+esc(sel.preheader)+'"><span class="hint">The grey text after the subject in most inboxes.</span></div>'+
        '<div class="field"><label for="stBody">Message</label><textarea id="stBody" class="code">'+esc(sel.body)+'</textarea><span class="hint">{{name}} becomes their first name, or “there”. Markdown: ## heading, **bold**, [link](https://…), - list.</span></div>'+
        '<div class="actions"><label class="sr" for="stTest">Send a test to</label><input type="email" id="stTest" value="'+esc(store("proof.testto")||S.me.email)+'" style="flex:1 1 200px;width:auto"><button class="btn" type="button" id="stTestBtn">Send test</button></div>'+
        '<div class="actions"><button class="btn sm" type="button" id="stUp"'+(idx===0?" disabled":"")+'>Move up</button><button class="btn sm" type="button" id="stDown"'+(idx===steps.length-1?" disabled":"")+'>Move down</button><button class="btn sm danger" type="button" id="stDel">Delete this email</button></div><div id="stConfirm"></div>'+
        '</form><div class="proof email"><div class="proofbar"><span class="url">inbox view</span></div><iframe id="pv" title="Email preview" sandbox=""></iframe></div></div>';
    } else edit='<div class="empty"><b>No emails yet</b>Add the first one on the left.</div>';

    html+='<div class="flowgrid">'+flow+edit+'</div>';
    v.innerHTML=html;

    // automation settings
    var qsave=saver($("#aSave"), function(x){ return api("PATCH","sequences/"+qid,x).then(function(r){ q=r.sequence; $("#aTitle").textContent=q.name }) });
    $("#aName").oninput=function(){ qsave({name:this.value}) };
    $("#aTrig").onchange=function(){ var t=this.value; $("#aListF").hidden=t!=="list"; $("#aCampF").hidden=t!=="click"; $("#aManF").hidden=t!=="manual"; qsave({trigger:t}); qsave.now() };
    $("#aList").onchange=function(){ qsave({trigger_list_id:this.value||null}); qsave.now() };
    $("#aCamp").onchange=function(){ qsave({trigger_campaign_id:this.value||null}); qsave.now() };
    $("#aSite").onchange=function(){ qsave({site_id:this.value||null}); qsave.now(); if(typeof preview==="function") preview() };
    var setStatus=function(st, msg){ qsave.now(); setTimeout(function(){ api("PATCH","sequences/"+qid,{status:st}).then(function(){ toast(msg); refreshNav(); route() }).catch(function(e){ toast(e.message,true) }) },300) };
    var bOn=$("#aOn"); if(bOn) bOn.onclick=function(){ setStatus("active","On. New people start from now.") };
    var bP=$("#aPause"); if(bP) bP.onclick=function(){ setStatus("paused","Paused") };
    $("#aDel").onclick=function(){
      $("#aConfirm").innerHTML='<div class="confirm"><span>Delete “'+esc(q.name)+'”? Anyone in it stops getting its emails. Emails already sent stay in each contact’s history.</span><button class="btn sm danger" type="button" id="adYes">Delete</button><button class="btn sm ghost" type="button" id="adNo">Keep it</button></div>';
      $("#adNo").onclick=function(){ $("#aConfirm").innerHTML="" };
      $("#adYes").onclick=function(){ api("DELETE","sequences/"+qid).then(function(){ toast("Automation deleted"); refreshNav(); go("#/automations") }).catch(function(e){ toast(e.message,true) }) };
    };
    var back=$("#aBack"); if(back) back.onclick=function(){
      var l=listById(q.trigger_list_id);
      $("#aBackC").innerHTML='<div class="confirm"><span>Start up to '+(l?l.subscribed:0)+' people who are already on '+esc(l?l.name:"the list")+'? Anyone who’s been through it before is skipped.</span><button class="btn sm primary" type="button" id="abYes">Start them</button><button class="btn sm ghost" type="button" id="abNo">Not now</button></div>';
      $("#abNo").onclick=function(){ $("#aBackC").innerHTML="" };
      $("#abYes").onclick=function(){ this.disabled=true; api("POST","sequences/"+qid+"/enroll-list").then(function(r){ toast(r.added+" started"); route() }).catch(function(e){ toast(e.message,true) }) };
    };
    $("#aAdd").onclick=function(){ this.disabled=true; api("POST","sequences/"+qid+"/steps").then(function(){ return api("GET","sequences/"+qid) }).then(function(x){ var last=x.steps[x.steps.length-1]; go("#/automations/"+qid+"/"+last.id) }).catch(function(e){ toast(e.message,true) }) };
    $$("[data-contact]").forEach(function(a){ a.onclick=function(e){ e.preventDefault(); store("studio.openContact",a.dataset.contact); go("#/contacts") } });

    if(!sel) return;
    // selected email
    imageButton($("#stBody"), $("#stBody").nextElementSibling);
    var t, preview=function(){ clearTimeout(t); t=setTimeout(function(){ emailPreview($("#pv"),{ subject:$("#stSubj").value, preheader:$("#stPre").value, body:$("#stBody").value, site_id:$("#aSite").value||null }) },250) };
    S.cleanup.push(function(){ clearTimeout(t) });
    var ssave=saver($("#stSave"), function(x){ return api("PATCH","steps/"+sel.id,x).then(function(r){ Object.assign(sel, r.step);
      var node=$('.node.step[aria-current="true"] b'); if(node) node.textContent=sel.subject||"No subject yet";
      var w=$('.node.step[aria-current="true"]'); w=w&&w.previousElementSibling; var i=steps.indexOf(sel);
      if(w) w.firstChild.textContent=delayText(sel.delay_minutes, i===0)+(i>0 && sel.condition!=="always" ? ', then only '+CONDS_SHORT[sel.condition] : '') }) });
    var delay=function(){ var n=Math.max(0, Math.round(Number($("#stWait").value)||0)), u=$("#stUnit").value; return n*(u==="days"?1440:u==="hours"?60:1) };
    $("#stWait").oninput=function(){ ssave({delay_minutes:delay()}) };
    $("#stUnit").onchange=function(){ ssave({delay_minutes:delay()}); ssave.now() };
    var c=$("#stCond"); if(c) c.onchange=function(){ ssave({condition:this.value}); ssave.now() };
    $("#stSubj").oninput=function(){ ssave({subject:this.value}); preview() };
    $("#stPre").oninput=function(){ ssave({preheader:this.value}); preview() };
    $("#stBody").oninput=function(){ ssave({body:this.value}); preview() };
    $("#stTestBtn").onclick=function(){ var to=$("#stTest").value.trim(), b=this; store("proof.testto",to); ssave.now(); b.disabled=true;
      setTimeout(function(){ api("POST","steps/"+sel.id+"/test",{to:to}).then(function(){ toast("Test sent to "+to) }).catch(function(e){ toast(e.message,true) }).then(function(){ b.disabled=false }) },400) };
    var move=function(dir){ ssave.now(); api("POST","steps/"+sel.id+"/move",{dir:dir}).then(function(){ route() }).catch(function(e){ toast(e.message,true) }) };
    $("#stUp").onclick=function(){ move(-1) };
    $("#stDown").onclick=function(){ move(1) };
    $("#stDel").onclick=function(){
      $("#stConfirm").innerHTML='<div class="confirm"><span>Delete this email? People waiting for it skip to the next one.</span><button class="btn sm danger" type="button" id="sdYes">Delete</button><button class="btn sm ghost" type="button" id="sdNo">Keep it</button></div>';
      $("#sdNo").onclick=function(){ $("#stConfirm").innerHTML="" };
      $("#sdYes").onclick=function(){ api("DELETE","steps/"+sel.id).then(function(){ toast("Email deleted"); go("#/automations/"+qid) }).catch(function(e){ toast(e.message,true) }) };
    };
    preview();
  });
}

/* ============ calendar ============ */
var DAYS_SHORT=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function dayKey(d){ return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate() }
function fmtTime(ms){ return new Date(ms).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"}) }
function calendarView(){
  var off=Number(store("studio.calOff")||0);
  var now=new Date(), first=new Date(now.getFullYear(), now.getMonth()+off, 1);
  var start=new Date(first); start.setDate(1-((first.getDay()+6)%7)); // Monday on or before the 1st
  var end=new Date(start); end.setDate(start.getDate()+42);
  return api("GET","calendar?from="+start.getTime()+"&to="+end.getTime()).then(function(d){
    var v=$("#view"), byDay={};
    d.items.forEach(function(it){ var k=dayKey(new Date(it.at)); (byDay[k]=byDay[k]||[]).push(it) });
    var monthName=first.toLocaleDateString(undefined,{month:"long",year:"numeric"});
    var html=head("Plan","Calendar","Every scheduled post and email in one place. Drag a scheduled item to another day to move it.",
      '<div class="seg" role="group" aria-label="Month"><button type="button" id="calPrev" aria-label="Previous month">‹</button><button type="button" id="calToday">Today</button><button type="button" id="calNext" aria-label="Next month">›</button></div>');
    html+='<div class="calwrap"><section class="panel cal"><h2 class="sec">'+esc(monthName)+' <span class="legend"><span><i class="k-social"></i>Social</span><span><i class="k-email"></i>Email</span>'+((d.campaigns||[]).length?'<span><i class="k-camp"></i>Campaign</span>':'')+'</span></h2>'+
      '<div class="calgrid" role="grid">'+["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(function(x){ return '<div class="calhd" role="columnheader">'+x+'</div>' }).join("");
    var today=dayKey(now);
    for(var i=0;i<42;i++){
      var day=new Date(start); day.setDate(start.getDate()+i);
      var k=dayKey(day), items=byDay[k]||[], out=day.getMonth()!==first.getMonth(), past=day<new Date(now.getFullYear(),now.getMonth(),now.getDate());
      var dayUtc=Date.UTC(day.getFullYear(),day.getMonth(),day.getDate()), isoDay=new Date(dayUtc).toISOString().slice(0,10);
      var running=(d.campaigns||[]).filter(function(c){ return c.starts_at<dayUtc+864e5 && (c.ends_at||c.starts_at)>=dayUtc });
      html+='<div class="calday'+(out?" out":"")+(k===today?" today":"")+(past?" past":"")+'" role="gridcell" data-day="'+day.getTime()+'"><span class="dn">'+day.getDate()+'<span class="dw">'+day.toLocaleDateString(undefined,{weekday:"short"})+'</span></span>'+
        running.map(function(c){ var first=i%7===0||new Date(c.starts_at).toISOString().slice(0,10)===isoDay; return '<a class="calcamp" href="#/campaigns/'+esc(c.id)+'" title="'+esc(c.name)+'">'+(first?esc(c.name):"&nbsp;")+'</a>' }).join("")+
        items.map(function(it){ return '<a class="calit k-'+it.type+' st-'+esc(it.status)+'" href="'+esc(it.href)+'"'+(it.movable?' draggable="true" data-move="'+esc(it.type)+':'+esc(it.id)+':'+it.at+'"':'')+' title="'+esc(it.title+" · "+it.sub)+'"><b>'+fmtTime(it.at)+'</b> '+esc(it.title)+'</a>' }).join("")+'</div>';
    }
    html+='</div></section><aside class="stack"><section class="panel"><h2 class="sec">Drafts <span class="hint">'+d.drafts.length+'</span></h2>'+
      (d.drafts.length ? '<div class="rows">'+d.drafts.map(function(p){ return '<div class="rowi nosq"><a class="t" href="'+esc(p.href)+'" style="text-decoration:none">'+esc(p.title)+'<small>'+esc([p.brand,p.sub].filter(Boolean).join(" · ")||"No accounts picked")+'</small></a><span class="meta"><button class="btn sm" type="button" data-q="'+esc(p.id)+'">Add to queue</button></span></div>' }).join("")+'</div>'
        : '<div class="empty">No social drafts. <a href="#/social">Write one</a>.</div>')+'</section>'+
      '<p class="hint">Add to queue puts a post in its brand’s next free posting time. Set posting times on the <a href="#/social">Social</a> page.</p></aside></div>';
    v.innerHTML=html;
    $("#calPrev").onclick=function(){ store("studio.calOff",String(off-1)); route() };
    $("#calNext").onclick=function(){ store("studio.calOff",String(off+1)); route() };
    $("#calToday").onclick=function(){ store("studio.calOff","0"); route() };
    $$("[data-q]").forEach(function(b){ b.onclick=function(){ b.disabled=true; api("POST","social/posts/"+b.dataset.q+"/queue",{}).then(function(r){ toast("Queued for "+fmtDate(r.post.scheduled_at,true)); route() }).catch(function(e){ b.disabled=false; toast(e.message,true) }) } });
    var dragging=null;
    $$("[data-move]").forEach(function(a){
      a.addEventListener("dragstart",function(e){ dragging=a.dataset.move; e.dataTransfer.effectAllowed="move"; try{ e.dataTransfer.setData("text/plain",dragging) }catch(x){} a.classList.add("dragging") });
      a.addEventListener("dragend",function(){ a.classList.remove("dragging"); $$(".calday.over").forEach(function(c){ c.classList.remove("over") }) });
    });
    $$(".calday:not(.past)").forEach(function(c){
      c.addEventListener("dragover",function(e){ if(dragging){ e.preventDefault(); c.classList.add("over") } });
      c.addEventListener("dragleave",function(){ c.classList.remove("over") });
      c.addEventListener("drop",function(e){ e.preventDefault(); c.classList.remove("over"); if(!dragging) return;
        var parts=dragging.split(":"), type=parts[0], id=parts[1], old=new Date(Number(parts[2])), day=new Date(Number(c.dataset.day));
        day.setHours(old.getHours(), old.getMinutes(), 0, 0); dragging=null;
        if(dayKey(day)===dayKey(old)) return;
        if(day.getTime()<Date.now()+120000){ toast("That time has already passed. Open it to pick a new time.",true); return }
        var req = type==="social" ? api("POST","social/posts/"+id+"/reschedule",{at:day.getTime()}) : api("POST","campaigns/"+id+"/send",{at:day.getTime()});
        req.then(function(){ toast("Moved to "+fmtDate(day.getTime(),true)); route() }).catch(function(err){ toast(err.message,true) });
      });
    });
  });
}

/* posting times for a brand, used on the Social page */
function slotsPanel(host, brand){
  api("GET","social/brands/"+brand._id+"/slots").then(function(d){
    var slots=d.slots, picked=[2,4];
    function draw(){
      var byTime={}; slots.forEach(function(s){ (byTime[s.time]=byTime[s.time]||[]).push(s.day) });
      host.innerHTML='<section class="panel"><h2 class="sec">Posting times <span class="hint">'+esc(d.timezone)+'</span></h2><div class="pad stack" style="gap:12px">'+
        (slots.length ? '<div class="slots">'+Object.keys(byTime).sort().map(function(t){ return '<div class="slotrow"><b>'+esc(t)+'</b><span class="daydots">'+[1,2,3,4,5,6,0].map(function(dd){ var on=byTime[t].indexOf(dd)>-1; return '<button type="button" class="dd" data-tog="'+dd+'|'+esc(t)+'" aria-pressed="'+on+'" aria-label="'+DAYS_SHORT[dd]+' at '+esc(t)+'">'+DAYS_SHORT[dd].slice(0,2)+'</button>' }).join("")+'</span><button type="button" class="btn sm ghost" data-rmt="'+esc(t)+'">Remove</button></div>' }).join("")+'</div>'
          : '<p class="hint" style="margin:0">No posting times yet. Add a few, then “Add to queue” picks the next free one for you.</p>')+
        '<div class="actions"><span class="daydots">'+[1,2,3,4,5,6,0].map(function(dd){ return '<button type="button" class="dd" data-new="'+dd+'" aria-pressed="'+(picked.indexOf(dd)>-1)+'" aria-label="'+DAYS_SHORT[dd]+'">'+DAYS_SHORT[dd].slice(0,2)+'</button>' }).join("")+'</span>'+
          '<label class="sr" for="slTime">Time</label><input type="time" id="slTime" value="09:00" style="width:auto"><button class="btn sm" type="button" id="slAdd">Add time</button></div>'+
        (d.next ? '<p class="hint" style="margin:0">Next free slot: <b>'+fmtDate(d.next,true)+'</b></p>' : '')+'</div></section>';
      $$("[data-new]",host).forEach(function(b){ b.onclick=function(){ var dd=Number(b.dataset.new), i=picked.indexOf(dd); if(i>-1) picked.splice(i,1); else picked.push(dd); b.setAttribute("aria-pressed",String(i<0)) } });
      $$("[data-tog]",host).forEach(function(b){ b.onclick=function(){ var pr=b.dataset.tog.split("|"), dd=Number(pr[0]), t=pr[1], i=slots.findIndex(function(s){return s.day===dd&&s.time===t});
        if(i>-1) slots.splice(i,1); else slots.push({day:dd,time:t}); saveSlots() } });
      $$("[data-rmt]",host).forEach(function(b){ b.onclick=function(){ slots=slots.filter(function(s){return s.time!==b.dataset.rmt}); saveSlots() } });
      $("#slAdd",host).onclick=function(){ var t=$("#slTime",host).value; if(!t||!picked.length){ toast("Pick at least one day and a time.",true); return }
        picked.forEach(function(dd){ if(!slots.some(function(s){return s.day===dd&&s.time===t})) slots.push({day:dd,time:t}) }); saveSlots() };
    }
    function saveSlots(){ api("PUT","social/brands/"+brand._id+"/slots",{slots:slots}).then(function(r){ slots=r.slots; d.next=r.next; draw() }).catch(function(e){ toast(e.message,true) }) }
    draw();
  }).catch(function(e){ host.innerHTML='<div class="notice danger"><p>'+esc(e.message)+'</p></div>' });
}

/* performance panel for a brand, on the Social page */
function perfPanel(host, brand){
  api("GET","social/performance?brand="+encodeURIComponent(brand._id)+"&days=90").then(function(d){
    if(!d.posts){ host.innerHTML=""; return }
    var plats=Object.keys(d.totals);
    var h='<section class="panel"><h2 class="sec">How posts are doing <span class="actions"><span class="hint">'+(d.updated?"Updated "+fmtDate(d.updated,true):"Numbers arrive within the hour after posting")+'</span><button class="btn sm ghost" type="button" id="pfRefresh">Refresh</button></span></h2>';
    if(!d.measured){ host.innerHTML=h+'<div class="empty">No numbers yet. Zernio reports likes, comments and reach a little while after each post goes out.</div></section>'; bind(); return }
    h+='<div class="plats">'+plats.map(function(pl){ var t=d.totals[pl]; return '<div class="plat"><span class="pn">'+esc(platName(pl))+'</span><span class="pu">'+t.posts+' post'+(t.posts===1?"":"s")+' · '+Math.round(t.engagement/t.posts*10)/10+' interactions each</span><span class="pu">'+t.likes+' likes · '+t.comments+' comments · '+t.shares+' shares'+(t.reach?' · '+t.reach.toLocaleString()+' seen':'')+'</span></div>' }).join("")+'</div>';
    h+='<div class="perfgrid"><div><h3 class="mini">Best times <span class="hint">average interactions per post, '+esc(d.timezone)+'</span></h3>';
    if(d.enough){
      var max=0; d.grid.forEach(function(r){ r.forEach(function(c){ if(c.avg>max) max=c.avg }) });
      var order=[1,2,3,4,5,6,0];
      h+='<div class="heat" role="table" aria-label="Average interactions by day and time"><div role="row" class="hrow"><span></span>'+d.blocks.map(function(b){ return '<span role="columnheader" class="hh" title="'+b.from+':00–'+b.to+':00">'+esc(b.name)+'</span>' }).join("")+'</div>'+
        order.map(function(di){ return '<div role="row" class="hrow"><span role="rowheader" class="hd">'+DAYS_SHORT[di]+'</span>'+d.grid[di].map(function(c){ var a=max?c.avg/max:0;
          return '<span role="cell" class="hc'+(c.posts?"":" none")+'" style="--a:'+a.toFixed(2)+'" title="'+(c.posts?c.avg+" avg from "+c.posts+" post"+(c.posts===1?"":"s"):"No posts yet")+'">'+(c.posts?c.avg:"")+'</span>' }).join("")+'</div>' }).join("")+'</div>';
      h+= d.best ? '<p class="suggest"><b>'+esc(d.best.dayName)+' '+esc(d.best.block.toLowerCase())+'</b> works best so far'+(d.best.lift>0?' ('+d.best.lift+'% above your average)':'')+'. <button class="btn sm" type="button" id="pfAdd" data-day="'+d.best.day+'" data-time="'+esc(d.best.slot)+'">Add '+DAYS_SHORT[d.best.day]+' '+esc(d.best.slot)+' as a posting time</button></p>'
        : '<p class="hint">No clear winner yet. Keep posting at a few different times and this fills in.</p>';
    } else h+='<p class="hint">Once '+esc(brand.name)+' has 5 posts with numbers ('+d.measured+' so far), Studio shows which days and times work best.</p>';
    h+='</div><div><h3 class="mini">Top posts <span class="hint">last '+d.days+' days</span></h3><div class="rows">'+d.top.map(function(t){ return '<a class="rowi nosq" href="#/social/p/'+esc(t.id)+'"><span class="t">'+esc(t.title)+'<small>'+fmtDate(t.at)+(t.reach?' · '+t.reach.toLocaleString()+' seen':'')+'</small></span><span class="meta num">'+t.engagement+'</span></a>' }).join("")+'</div></div></div></section>';
    host.innerHTML=h; bind();
    function bind(){
      var r=$("#pfRefresh",host); if(r) r.onclick=function(){ r.disabled=true; api("POST","social/performance/refresh").then(function(x){ toast(x.updated+" post"+(x.updated===1?"":"s")+" updated"); perfPanel(host,brand) }).catch(function(e){ r.disabled=false; toast(e.message,true) }) };
      var a=$("#pfAdd",host); if(a) a.onclick=function(){ a.disabled=true;
        api("GET","social/brands/"+brand._id+"/slots").then(function(s){ var slots=s.slots.concat([{day:Number(a.dataset.day), time:a.dataset.time}]); return api("PUT","social/brands/"+brand._id+"/slots",{slots:slots}) })
          .then(function(){ toast("Posting time added"); slotsPanel($("#slotsHost"), brand) }).catch(function(e){ a.disabled=false; toast(e.message,true) }) };
    }
  }).catch(function(){ host.innerHTML="" });
}

/* ============ file library ============ */
function fmtBytes(n){ n=Number(n)||0; if(n<1024) return n+" B"; if(n<1048576) return Math.round(n/1024)+" KB"; if(n<1073741824) return (n/1048576).toFixed(n<10485760?1:0)+" MB"; return (n/1073741824).toFixed(2)+" GB" }
function imageSize(file){
  return new Promise(function(res){
    if(!/^image\//.test(file.type)||/svg/.test(file.type)) return res(null);
    var u=URL.createObjectURL(file), im=new Image();
    im.onload=function(){ res({w:im.naturalWidth,h:im.naturalHeight}); URL.revokeObjectURL(u) };
    im.onerror=function(){ res(null); URL.revokeObjectURL(u) };
    im.src=u;
  });
}
/** Upload one file to the library. Big files go up in parts. onProgress(0..1). */
function uploadToLibrary(file, folder, onProgress){
  onProgress=onProgress||function(){};
  var type=file.type||"application/octet-stream";
  return imageSize(file).then(function(dim){
    var h={"content-type":type,"x-filename":encodeURIComponent(file.name),"x-folder":encodeURIComponent(folder||""),"x-size":String(file.size)};
    if(dim){ h["x-width"]=String(dim.w); h["x-height"]=String(dim.h) }
    var parse=function(res){ return res.json().then(function(d){ if(res.status===401){ location.href="/login" } if(!res.ok) throw new Error(d.error||"Upload failed"); return d }) };
    if(file.size<=90*1024*1024){
      onProgress(0.1);
      return fetch("/api/files",{method:"POST",headers:h,body:file}).then(parse).then(function(d){ onProgress(1); return d.file });
    }
    return fetch("/api/files/big",{method:"POST",headers:h}).then(parse).then(function(start){
      var id=start.file.id, size=start.partSize, n=Math.ceil(file.size/size), parts=[], i=0;
      var next=function(){
        if(i>=n) return fetch("/api/files/"+id+"/finish",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({parts:parts})}).then(parse).then(function(d){ onProgress(1); return d.file });
        var chunk=file.slice(i*size, Math.min(file.size,(i+1)*size)), num=i+1;
        var attempt=function(tries){ return fetch("/api/files/"+id+"/parts/"+num,{method:"PUT",body:chunk}).then(parse).catch(function(e){ if(tries<2) return attempt(tries+1); throw e }) };
        return attempt(0).then(function(p){ parts.push(p); i++; onProgress(i/n*0.98); return next() });
      };
      return next();
    });
  });
}
function thumb(f){
  if(f.kind==="image") return '<img src="'+esc(f.url)+'" alt="'+esc(f.alt)+'" loading="lazy">';
  if(f.kind==="video") return '<video src="'+esc(f.url)+'#t=0.5" muted playsinline preload="metadata"></video>';
  return '<span class="ftype">'+esc((f.name.split(".").pop()||f.kind).toUpperCase())+'</span>';
}

/** Choose files from the library. opts: {kind:"image"|"", multiple:bool, folder:""} → Promise<[file]> (empty if cancelled). */
function pickFromLibrary(opts){
  opts=opts||{};
  return new Promise(function(resolve){
    var chosen=[], folder=opts.folder||"*";
    var ov=document.createElement("div"); ov.className="modal"; ov.setAttribute("role","dialog"); ov.setAttribute("aria-modal","true"); ov.setAttribute("aria-label","Choose from your files");
    ov.innerHTML='<div class="modalbox"><div class="modalhead"><b>Choose '+(opts.kind==="image"?"an image":"files")+'</b><button class="btn sm ghost" type="button" data-x>Cancel</button></div>'+
      '<div class="filters" style="padding:12px 18px"><input type="search" id="pkQ" placeholder="Search"><select id="pkF"></select><label class="btn sm" style="cursor:pointer"><input type="file" id="pkUp" hidden multiple accept="'+(opts.kind==="image"?"image/*":"image/*,video/*,application/pdf")+'">Upload</label></div>'+
      '<div class="fgrid pk" id="pkGrid"><div class="loading">Loading…</div></div><div class="modalfoot"><span class="hint" id="pkN"></span><button class="btn primary" type="button" id="pkGo" disabled>Use '+(opts.multiple?"these":"this")+'</button></div></div>';
    document.body.appendChild(ov);
    var close=function(val){ document.removeEventListener("keydown",esc_); ov.remove(); resolve(val) };
    var esc_=function(e){ if(e.key==="Escape") close([]) };
    document.addEventListener("keydown",esc_);
    ov.addEventListener("click",function(e){ if(e.target===ov) close([]) });
    ov.querySelector("[data-x]").onclick=function(){ close([]) };
    var files=[];
    function load(){
      var qs="folder="+encodeURIComponent(folder)+(opts.kind?"&kind="+opts.kind:"")+($("#pkQ",ov).value?"&q="+encodeURIComponent($("#pkQ",ov).value):"");
      api("GET","files?"+qs).then(function(d){
        if(!d.enabled){ $("#pkGrid",ov).innerHTML='<div class="empty">File storage isn’t switched on yet.</div>'; return }
        var fs=$("#pkF",ov); if(!fs.options.length) fs.innerHTML='<option value="*">All folders</option><option value="">Unfiled</option>'+d.folders.filter(function(x){return x.folder}).map(function(x){ return '<option>'+esc(x.folder)+'</option>' }).join("");
        fs.value=folder;
        files=d.files; draw();
      }).catch(function(e){ $("#pkGrid",ov).innerHTML='<div class="notice danger"><p>'+esc(e.message)+'</p></div>' });
    }
    function draw(){
      $("#pkGrid",ov).innerHTML = files.length ? files.map(function(f){ var on=chosen.some(function(c){return c.id===f.id});
        return '<button type="button" class="fcard" data-f="'+esc(f.id)+'" aria-pressed="'+on+'"><span class="fthumb">'+thumb(f)+'</span><span class="fname">'+esc(f.name)+'</span></button>' }).join("") : '<div class="empty">Nothing here yet. Upload something.</div>';
      $$("[data-f]",ov).forEach(function(b){ b.onclick=function(){ var f=files.filter(function(x){return x.id===b.dataset.f})[0];
        if(opts.multiple){ var i=chosen.findIndex(function(c){return c.id===f.id}); if(i>-1) chosen.splice(i,1); else chosen.push(f) } else chosen=[f];
        draw() }; b.ondblclick=function(){ if(!opts.multiple) close([files.filter(function(x){return x.id===b.dataset.f})[0]]) } });
      $("#pkN",ov).textContent = chosen.length ? chosen.length+" chosen" : "";
      $("#pkGo",ov).disabled=!chosen.length;
    }
    $("#pkGo",ov).onclick=function(){ close(chosen) };
    var qt; $("#pkQ",ov).oninput=function(){ clearTimeout(qt); qt=setTimeout(load,250) };
    $("#pkF",ov).onchange=function(){ folder=this.value; load() };
    $("#pkUp",ov).onchange=function(){ var list=Array.prototype.slice.call(this.files); this.value="";
      list.reduce(function(ch,f){ return ch.then(function(){ toast("Uploading "+f.name+"…"); return uploadToLibrary(f, folder==="*"?(opts.folder||""):folder).then(function(nf){ chosen=opts.multiple?chosen.concat([nf]):[nf]; toast(f.name+" uploaded") }) }) }, Promise.resolve())
        .then(load).catch(function(e){ toast(e.message,true) }) };
    load();
    setTimeout(function(){ $("#pkQ",ov).focus() },30);
  });
}
/** Add an "Insert image" button that puts ![alt](url) into a textarea at the cursor. */
function imageButton(textarea, after){
  if(!S.me.files||!textarea) return;
  var b=document.createElement("button"); b.type="button"; b.className="btn sm"; b.textContent="Insert image"; b.style.alignSelf="flex-start";
  b.onclick=function(){ pickFromLibrary({kind:"image"}).then(function(fs){ if(!fs.length) return; var f=fs[0];
    var md="\n![" + (f.alt||"").replace(/[\[\]]/g,"") + "](" + f.url + ")\n", s=(document.activeElement===textarea||textarea.selectionStart)?textarea.selectionStart:textarea.value.length;
    textarea.value=textarea.value.slice(0,s)+md+textarea.value.slice(s); textarea.dispatchEvent(new Event("input",{bubbles:true})); textarea.focus() }) };
  (after||textarea).insertAdjacentElement("afterend", b);
}

function filesView(folderParam){
  return api("GET","files?folder="+encodeURIComponent(folderParam==null?"*":folderParam)).then(function(d){
    var v=$("#view"), folder=folderParam==null?"*":folderParam, files=d.files, open=null;
    var sub='Pictures, video and documents for every brand. Use them in posts, emails and pages.';
    if(!d.enabled){ v.innerHTML=head("Library","Files",sub)+'<div class="notice"><p><b>File storage isn’t switched on yet.</b> Turn on R2 in Cloudflare, then Studio sets up its storage on the next update.</p></div>'; return }
    var pctUsed=Math.min(100, d.usage.bytes/d.usage.free*100);
    var html=head("Library","Files",sub,'<label class="btn primary" style="cursor:pointer"><input type="file" id="fUp" multiple hidden accept="image/*,video/*,application/pdf,audio/*">Upload</label>')+
      '<div class="cols"><aside class="stack" style="gap:10px"><div class="actions" style="justify-content:space-between"><span class="eyebrow">Folders</span><button class="btn sm" type="button" id="newFolder">New folder</button></div><div id="nfHost"></div><div class="listnav">'+
        '<button type="button" data-folder="*" aria-pressed="'+(folder==="*")+'"><span>All files</span><span class="num">'+d.usage.n+'</span></button>'+
        d.folders.map(function(x){ return '<button type="button" data-folder="'+esc(x.folder)+'" aria-pressed="'+(folder===x.folder)+'"><span>'+esc(x.folder||"Unfiled")+'</span><span class="num">'+x.n+'</span></button>' }).join("")+
        (folder!=="*"&&folder!==""&&!d.folders.some(function(x){return x.folder===folder})?'<button type="button" data-folder="'+esc(folder)+'" aria-pressed="true"><span>'+esc(folder)+'</span><span class="num">0</span></button>':'')+'</div>'+
        '<div class="meter" role="img" aria-label="'+fmtBytes(d.usage.bytes)+' of '+fmtBytes(d.usage.free)+' free storage used"><i style="width:'+Math.max(pctUsed,0.5)+'%"></i></div><p class="hint" style="margin:0">'+fmtBytes(d.usage.bytes)+' of '+fmtBytes(d.usage.free)+' free space used</p></aside>'+
      '<section class="stack"><div id="fPanel"></div><div class="drop" id="drop"><b>Drop files here</b><span>or use Upload. Images, video (up to 4 GB), PDFs and audio.</span><div id="fProg"></div></div>'+
      '<div class="filters"><input type="search" id="fQ" placeholder="Search files"><select id="fK" style="width:auto"><option value="">Everything</option><option value="image">Images</option><option value="video">Video</option><option value="document">Documents</option></select></div>'+
      '<div class="fgrid" id="fGrid"></div></section></div>';
    v.innerHTML=html;
    function draw(list){
      $("#fGrid").innerHTML = list.length ? list.map(function(f){ return '<button type="button" class="fcard" data-f="'+esc(f.id)+'" aria-pressed="'+(open===f.id)+'"><span class="fthumb">'+thumb(f)+'</span><span class="fname">'+esc(f.name)+'</span><span class="fmeta">'+fmtBytes(f.size)+(f.width?' · '+f.width+'×'+f.height:'')+'</span></button>' }).join("")
        : '<div class="empty"><b>No files here yet</b>Drop some in above.</div>';
      $$("[data-f]").forEach(function(b){ b.onclick=function(){ open=b.dataset.f; panel(files.filter(function(x){return x.id===open})[0]); draw(list); window.scrollTo({top:0,behavior:"smooth"}) } });
    }
    function reload(){ var qs="folder="+encodeURIComponent(folder)+($("#fQ").value?"&q="+encodeURIComponent($("#fQ").value):"")+($("#fK").value?"&kind="+$("#fK").value:"");
      return api("GET","files?"+qs).then(function(r){ files=r.files; draw(files) }) }
    function panel(f){
      var p=$("#fPanel"); if(!f){ p.innerHTML=""; return }
      var folders=d.folders.map(function(x){return x.folder}).filter(Boolean);
      p.innerHTML='<form class="drawer" id="fdForm" autocomplete="off"><h2 class="sec">'+esc(f.name)+' <span class="saving" id="fdSave">Saved</span></h2>'+
        '<div class="fdetail"><div class="fbig">'+(f.kind==="image"?'<img src="'+esc(f.url)+'" alt="">':f.kind==="video"?'<video src="'+esc(f.url)+'" controls playsinline preload="metadata"></video>':'<span class="ftype">'+esc(f.name.split(".").pop().toUpperCase())+'</span>')+'</div>'+
        '<div class="stack" style="gap:12px"><div class="field"><label for="fdName">Name</label><input type="text" id="fdName" maxlength="160" value="'+esc(f.name)+'"></div>'+
        '<div class="field"><label for="fdFolder">Folder</label><input type="text" id="fdFolder" list="fdFolders" maxlength="60" value="'+esc(f.folder)+'" placeholder="Unfiled"><datalist id="fdFolders">'+folders.map(function(x){return '<option value="'+esc(x)+'">'}).join("")+'</datalist></div>'+
        (f.kind==="image"?'<div class="field"><label for="fdAlt">Description</label><input type="text" id="fdAlt" maxlength="300" value="'+esc(f.alt)+'" placeholder="What’s in the picture"><span class="hint">Read out by screen readers and shown if the image doesn’t load.</span></div>':'')+
        '<div class="field"><label for="fdUrl">Link</label><div class="affix"><input type="text" id="fdUrl" readonly value="'+esc(f.url)+'"><button class="btn sm" type="button" id="fdCopy" style="border:0;border-left:1px solid var(--line)">Copy</button></div></div>'+
        '<p class="hint" style="margin:0">'+esc(f.type)+' · '+fmtBytes(f.size)+(f.width?' · '+f.width+'×'+f.height:'')+' · added '+fmtDate(f.created_at,true)+'</p>'+
        '<div class="actions">'+((f.kind==="image"||f.kind==="video")?'<button class="btn sm" type="button" id="fdPost">Use in a social post</button>':'')+'<a class="btn sm" href="'+esc(f.url)+'" download="'+esc(f.name)+'" target="_blank" rel="noopener">Download</a><button class="btn sm danger" type="button" id="fdDel">Delete</button><button class="btn sm ghost" type="button" id="fdClose">Close</button></div><div id="fdConfirm"></div></div></div></form>';
      var save=saver($("#fdSave"), function(x){ return api("PATCH","files/"+f.id,x).then(function(r){ Object.assign(f,r.file); var c=$('[data-f="'+f.id+'"] .fname'); if(c) c.textContent=f.name }) });
      $("#fdName").oninput=function(){ save({name:this.value}) };
      $("#fdFolder").onchange=function(){ save({folder:this.value}); save.now(); setTimeout(route,600) };
      var al=$("#fdAlt"); if(al) al.oninput=function(){ save({alt:this.value}) };
      $("#fdCopy").onclick=function(){ var i=$("#fdUrl"); i.select(); (navigator.clipboard?navigator.clipboard.writeText(i.value):Promise.reject()).then(function(){ toast("Link copied") },function(){ document.execCommand("copy"); toast("Link copied") }) };
      $("#fdClose").onclick=function(){ open=null; panel(null); draw(files) };
      var fp=$("#fdPost"); if(fp) fp.onclick=function(){ fp.disabled=true;
        var brand=store("studio.brand");
        (brand?Promise.resolve(brand):api("GET","social/brands").then(function(r){ return r.brands[0]&&r.brands[0]._id })).then(function(bid){
          if(!bid) throw new Error("Set up a brand on the Social page first.");
          return api("POST","social/posts",{profile_id:bid, targets:[]}).then(function(r){ return api("PATCH","social/posts/"+r.post.id,{media:[{url:f.url,type:f.kind==="video"?"video":(f.type==="image/gif"?"gif":"image"),name:f.name}]}) }).then(function(r){ go("#/social/p/"+r.post.id) });
        }).catch(function(e){ fp.disabled=false; toast(e.message,true) }) };
      $("#fdDel").onclick=function(){
        $("#fdConfirm").innerHTML='<div class="confirm"><span>Delete '+esc(f.name)+'? Anything that uses it (emails already sent, pages, scheduled posts) will show a broken image.</span><button class="btn sm danger" type="button" id="fdY">Delete</button><button class="btn sm ghost" type="button" id="fdN">Keep it</button></div>';
        $("#fdN").onclick=function(){ $("#fdConfirm").innerHTML="" };
        $("#fdY").onclick=function(){ api("DELETE","files/"+f.id).then(function(){ toast("Deleted"); route() }).catch(function(e){ toast(e.message,true) }) };
      };
    }
    function uploadList(list){
      var target=folder==="*"?"":folder, prog=$("#fProg"), done=0;
      list.reduce(function(ch,f){ return ch.then(function(){
        var row=document.createElement("div"); row.className="prog"; row.innerHTML='<span>'+esc(f.name)+'</span><i><b style="width:0"></b></i>'; prog.appendChild(row);
        return uploadToLibrary(f, target, function(x){ row.querySelector("b").style.width=Math.round(x*100)+"%" }).then(function(){ done++; row.remove() }).catch(function(e){ row.classList.add("bad"); row.querySelector("span").textContent=f.name+": "+e.message });
      }) }, Promise.resolve()).then(function(){ if(done){ toast(done+" file"+(done===1?"":"s")+" added"); reload() } });
    }
    $("#fUp").onchange=function(){ var l=Array.prototype.slice.call(this.files); this.value=""; uploadList(l) };
    var dz=$("#drop");
    ["dragenter","dragover"].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.classList.add("over") }) });
    ["dragleave","drop"].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.classList.remove("over") }) });
    dz.addEventListener("drop",function(e){ uploadList(Array.prototype.slice.call(e.dataTransfer.files||[])) });
    $$("[data-folder]").forEach(function(b){ b.onclick=function(){ go(b.dataset.folder==="*"?"#/files":"#/files/"+encodeURIComponent(b.dataset.folder||"_")) } });
    $("#newFolder").onclick=function(){
      $("#nfHost").innerHTML='<form class="sheet" id="nfForm"><div class="field"><label for="nfName">Folder name</label><input type="text" id="nfName" required maxlength="60" placeholder="e.g. Ciúnas"></div><div class="actions"><button class="btn sm primary" type="submit">Open folder</button></div><p class="hint" style="margin:0">It appears once there’s a file in it.</p></form>';
      $("#nfName").focus(); $("#nfForm").onsubmit=function(e){ e.preventDefault(); go("#/files/"+encodeURIComponent($("#nfName").value.trim()||"_")) };
    };
    var qt; $("#fQ").oninput=function(){ clearTimeout(qt); qt=setTimeout(reload,250) };
    $("#fK").onchange=reload;
    draw(files);
  });
}

/* ============ cropping ============ */
var RATIOS=[["1:1",1,"Square","Most feeds"],["4:5",0.8,"Portrait","Instagram feed"],["9:16",0.5625,"Tall","TikTok, Reels, Stories"],["2:3",0.6667,"Pin","Pinterest"],["1.91:1",1.91,"Wide","LinkedIn, X, Facebook links"]];
function bestRatio(platforms){
  if(platforms.indexOf("tiktok")>-1) return "9:16";
  if(platforms.indexOf("pinterest")>-1 && platforms.length===1) return "2:3";
  if(platforms.indexOf("instagram")>-1) return "4:5";
  if(platforms.length && platforms.every(function(p){ return ["linkedin","twitter","facebook","bluesky","threads"].indexOf(p)>-1 })) return "1.91:1";
  return "1:1";
}
/** Crop an image from the library to a ratio. Resolves with the new library file, or null. */
function cropImage(src, name, suggest, folder){
  return new Promise(function(resolve){
    var img=new Image(); img.crossOrigin="anonymous";
    var ov=document.createElement("div"); ov.className="modal"; ov.setAttribute("role","dialog"); ov.setAttribute("aria-modal","true"); ov.setAttribute("aria-label","Crop image");
    ov.innerHTML='<div class="modalbox"><div class="modalhead"><b>Crop</b><button class="btn sm ghost" type="button" data-x>Cancel</button></div>'+
      '<div class="croptools"><div class="seg" role="group" aria-label="Shape">'+RATIOS.map(function(r){ return '<button type="button" data-r="'+r[0]+'" aria-pressed="'+(r[0]===suggest)+'" title="'+esc(r[3])+'">'+r[2]+' '+r[0]+'</button>' }).join("")+'</div><span class="hint" id="crHint"></span></div>'+
      '<div class="cropstage" id="crStage"><div class="loading">Loading image…</div></div>'+
      '<div class="modalfoot"><span class="hint">Drag the frame to choose what’s in. Use the slider to zoom.</span><span class="actions"><input type="range" id="crZoom" min="40" max="100" value="100" aria-label="Frame size"><button class="btn primary" type="button" id="crGo" disabled>Save cropped copy</button></span></div></div>';
    document.body.appendChild(ov);
    var close=function(v){ document.removeEventListener("keydown",k); ov.remove(); resolve(v) }, k=function(e){ if(e.key==="Escape") close(null) };
    document.addEventListener("keydown",k); ov.querySelector("[data-x]").onclick=function(){ close(null) };
    var ratio=RATIOS.filter(function(r){return r[0]===suggest})[0]||RATIOS[0], box={x:0,y:0,w:0,h:0}, scale=1, stage=$("#crStage",ov);
    function fit(){
      var W=img.naturalWidth, H=img.naturalHeight, z=Number($("#crZoom",ov).value)/100;
      var w=W, h=w/ratio[1]; if(h>H){ h=H; w=h*ratio[1] } w*=z; h*=z;
      var cx=box.w?box.x+box.w/2:W/2, cy=box.h?box.y+box.h/2:H/2;
      box={w:w,h:h,x:Math.min(Math.max(0,cx-w/2),W-w),y:Math.min(Math.max(0,cy-h/2),H-h)}; draw();
      $("#crHint",ov).textContent=ratio[3]+" · "+Math.round(w)+"×"+Math.round(h)+"px"+(w<1080&&ratio[1]<=1?" (small: may look soft)":"");
    }
    function draw(){ var f=$(".cropframe",stage); f.style.left=box.x*scale+"px"; f.style.top=box.y*scale+"px"; f.style.width=box.w*scale+"px"; f.style.height=box.h*scale+"px" }
    img.onload=function(){
      var maxW=Math.min(800, window.innerWidth-64), maxH=Math.min(520, window.innerHeight-260);
      scale=Math.min(maxW/img.naturalWidth, maxH/img.naturalHeight, 1);
      stage.innerHTML='<div class="cropimg" style="width:'+Math.round(img.naturalWidth*scale)+'px;height:'+Math.round(img.naturalHeight*scale)+'px;background-image:url(\''+src.replace(/'/g,"%27")+'\')"><div class="cropframe" tabindex="0" aria-label="Crop frame. Use arrow keys to move."></div></div>';
      fit(); $("#crGo",ov).disabled=false;
      var fr=$(".cropframe",stage), start=null;
      fr.addEventListener("pointerdown",function(e){ start={x:e.clientX,y:e.clientY,bx:box.x,by:box.y}; fr.setPointerCapture(e.pointerId) });
      fr.addEventListener("pointermove",function(e){ if(!start) return; box.x=Math.min(Math.max(0,start.bx+(e.clientX-start.x)/scale),img.naturalWidth-box.w); box.y=Math.min(Math.max(0,start.by+(e.clientY-start.y)/scale),img.naturalHeight-box.h); draw() });
      fr.addEventListener("pointerup",function(){ start=null });
      fr.addEventListener("keydown",function(e){ var st=20/scale, mv={ArrowLeft:[-st,0],ArrowRight:[st,0],ArrowUp:[0,-st],ArrowDown:[0,st]}[e.key]; if(!mv) return; e.preventDefault();
        box.x=Math.min(Math.max(0,box.x+mv[0]),img.naturalWidth-box.w); box.y=Math.min(Math.max(0,box.y+mv[1]),img.naturalHeight-box.h); draw() });
    };
    img.onerror=function(){ stage.innerHTML='<div class="notice danger"><p>That image couldn’t be opened for cropping.</p></div>' };
    img.src=src;
    $$("[data-r]",ov).forEach(function(b){ b.onclick=function(){ ratio=RATIOS.filter(function(r){return r[0]===b.dataset.r})[0]; $$("[data-r]",ov).forEach(function(x){ x.setAttribute("aria-pressed",String(x===b)) }); box={x:0,y:0,w:0,h:0}; if(img.naturalWidth) fit() } });
    $("#crZoom",ov).oninput=function(){ if(img.naturalWidth) fit() };
    $("#crGo",ov).onclick=function(){
      var b=this; b.disabled=true; b.textContent="Saving…";
      var outW=Math.min(Math.round(box.w), ratio[1]>=1?2160:1440), outH=Math.round(outW/ratio[1]);
      var c=document.createElement("canvas"); c.width=outW; c.height=outH;
      var ctx=c.getContext("2d"); ctx.imageSmoothingQuality="high"; ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, outW, outH);
      var png=/\.png$/i.test(name);
      c.toBlob(function(blob){
        if(!blob){ toast("That image couldn’t be cropped.",true); b.disabled=false; b.textContent="Save cropped copy"; return }
        var base=name.replace(/\.[a-z0-9]+$/i,""), file=new File([blob], base+"-"+ratio[0].replace(":","x")+(png?".png":".jpg"), {type:png?"image/png":"image/jpeg"});
        uploadToLibrary(file, folder||"").then(function(f){ toast("Cropped copy saved to your files"); close(f) }).catch(function(e){ toast(e.message,true); b.disabled=false; b.textContent="Save cropped copy" });
      }, png?"image/png":"image/jpeg", 0.9);
    };
  });
}

/* ============ social ============ */
var PLAT_ORDER = ["instagram","tiktok","linkedin","threads","bluesky","twitter","pinterest","facebook"];
var SOCIAL_STATUS = { draft:"Draft", scheduled:"Scheduled", publishing:"Posting", published:"Posted", partial:"Partly posted", failed:"Failed" };
function socialChip(st){ var cls = st==="published"?"sent": st==="partial"||st==="failed"?"failed": st==="scheduled"||st==="publishing"?"scheduled":"draft"; return '<span class="chip '+cls+'">'+esc(SOCIAL_STATUS[st]||st)+'</span>' }
function hashQuery(){ var i=location.hash.indexOf("?"); return new URLSearchParams(i>-1?location.hash.slice(i+1):"") }
function platName(p){ return (S.social&&S.social.platforms[p]&&S.social.platforms[p].name)||p }
function loadSocialMeta(){ return S.social ? Promise.resolve(S.social) : api("GET","social/status").then(function(d){ S.social=d; return d }) }

/* ============ bulk scheduling and import (Social page) ============ */
function runBulk(action, list, onStep){
  // list: ids, or {id, at} for "times". Sent 10 at a time so big batches don't time out.
  var done=[], failed=[], i=0;
  function next(){
    if(i>=list.length) return Promise.resolve({done:done, failed:failed});
    var chunk=list.slice(i,i+10); i+=chunk.length;
    var body=action==="times"?{action:action, items:chunk}:{action:action, ids:chunk};
    return api("POST","social/bulk",body).then(function(r){ done=done.concat(r.done); failed=failed.concat(r.failed); if(onStep) onStep(done.length+failed.length, list.length); return next() });
  }
  return next();
}
function bulkResult(r, verb){
  if(r.done.length) toast(r.done.length+" post"+(r.done.length===1?"":"s")+" "+verb);
  if(r.failed.length) toast(r.failed.length+" couldn’t be "+verb+": "+r.failed[0].error, true);
}
function bulkSetup(posts, brand, accounts){
  var bar=$("#bulkBar"); if(!bar) return;
  var byId={}; posts.forEach(function(p){ byId[p.id]=p });
  function picked(){ return $$("[data-sel]:checked").map(function(x){ return byId[x.dataset.sel] }).filter(Boolean) }
  function draw(){
    var sel=picked(), drafts=sel.filter(function(p){return p.status==="draft"}), sched=sel.filter(function(p){return p.status==="scheduled"});
    $$("[data-selall]").forEach(function(a){ var boxes=$$('[data-sel][data-grp="'+a.dataset.selall+'"]'); a.checked=boxes.length&&boxes.every(function(b){return b.checked}) });
    if(!sel.length){ bar.hidden=true; bar.innerHTML=""; return }
    bar.hidden=false;
    var blocked=drafts.filter(function(p){return p.problems&&p.problems.length}).length;
    var h='<span class="bn"><b>'+sel.length+'</b> selected</span>';
    if(drafts.length===sel.length) h+='<button class="btn sm primary" type="button" data-bk="queue">Add to queue</button><button class="btn sm" type="button" data-bk="spread">Spread out…</button><button class="btn sm" type="button" data-bk="same">Same time…</button>';
    if(sched.length===sel.length) h+='<button class="btn sm" type="button" data-bk="unschedule">Unschedule</button>';
    h+='<button class="btn sm" type="button" data-bk="edit">Edit…</button>';
    h+='<button class="btn sm danger" type="button" data-bk="delete">Delete</button><button class="btn sm ghost" type="button" data-bk="clear">Clear</button>';
    if(drafts.length&&sched.length) h+='<span class="hint">Pick only drafts to schedule, or only scheduled posts to pull back.</span>';
    else if(blocked) h+='<span class="hint">'+blocked+' still need'+(blocked===1?"s":"")+' something and will be skipped.</span>';
    bar.innerHTML='<div class="bulkrow">'+h+'</div><div id="bulkMore"></div>';
    $$("[data-bk]",bar).forEach(function(b){ b.onclick=function(){ act(b.dataset.bk, sel) } });
  }
  function finish(r, verb){ bulkResult(r, verb); route() }
  function act(kind, sel){
    var more=$("#bulkMore"), ids=sel.map(function(p){return p.id}), n=sel.length, s=n===1?"":"s";
    if(kind==="clear"){ $$("[data-sel]").forEach(function(x){ x.checked=false }); draw(); return }
    var confirmIn=function(text, label, fn, danger){ more.innerHTML='<div class="confirm"><span>'+text+'</span><button class="btn sm '+(danger?"danger":"primary")+'" type="button" id="bkY">'+label+'</button><button class="btn sm ghost" type="button" id="bkN">Not yet</button></div>';
      $("#bkN").onclick=function(){ more.innerHTML="" }; $("#bkY").onclick=function(){ this.disabled=true; this.textContent="Working…"; fn() } };
    if(kind==="queue") confirmIn("Put "+n+" post"+s+" into "+esc(brand.name)+"’s next free posting times, in the order shown?", "Queue "+n, function(){ runBulk("queue", ids).then(function(r){ finish(r,"queued") }).catch(function(e){ toast(e.message,true) }) });
    if(kind==="unschedule") confirmIn("Pull "+n+" post"+s+" back to drafts? They won’t go out.", "Unschedule "+n, function(){ runBulk("unschedule", ids).then(function(r){ finish(r,"pulled back") }).catch(function(e){ toast(e.message,true) }) });
    if(kind==="delete") confirmIn("Delete "+n+" post"+s+" from Studio? Scheduled ones won’t go out. Posts already up stay on the platforms.", "Delete "+n, function(){ runBulk("delete", ids).then(function(r){ finish(r,"deleted") }).catch(function(e){ toast(e.message,true) }) }, true);
    if(kind==="edit"){ bulkEdit(more, sel, brand, accounts||[], function(){ route() }); return }
    if(kind==="same"){
      more.innerHTML='<div class="sheet"><div class="actions"><label for="bkAt">Post all '+n+' at</label><input type="datetime-local" id="bkAt" style="width:auto"><button class="btn sm primary" type="button" id="bkGo">Schedule '+n+'</button><button class="btn sm ghost" type="button" id="bkN">Cancel</button></div></div>';
      $("#bkN").onclick=function(){ more.innerHTML="" };
      $("#bkGo").onclick=function(){ var v=$("#bkAt").value; if(!v){ toast("Pick a date and time.",true); return } var at=new Date(v).getTime(); this.disabled=true;
        runBulk("times", ids.map(function(id){ return {id:id, at:at} })).then(function(r){ finish(r,"scheduled") }).catch(function(e){ toast(e.message,true) }) };
    }
    if(kind==="spread"){
      var start=new Date(); start.setDate(start.getDate()+1); start.setHours(9,0,0,0);
      more.innerHTML='<div class="sheet"><div class="fieldrow"><div class="field"><label for="bkStart">First one</label><input type="datetime-local" id="bkStart" value="'+localInput(start.getTime())+'"></div>'+
        '<div class="field"><label for="bkEvery">Then one every</label><div class="actions" style="flex-wrap:nowrap"><input type="number" id="bkEvery" min="1" max="60" value="1" style="width:80px"><select id="bkUnit" style="width:auto"><option value="day">day(s)</option><option value="hour">hour(s)</option><option value="week">week(s)</option></select></div></div></div>'+
        '<label class="check"><input type="checkbox" id="bkWk"> Skip weekends</label><ol class="bkplan" id="bkPlan"></ol>'+
        '<div class="actions"><button class="btn sm primary" type="button" id="bkGo">Schedule '+n+'</button><button class="btn sm ghost" type="button" id="bkN">Cancel</button></div></div>';
      var plan=[];
      var ready=sel.filter(function(p){ return !(p.problems&&p.problems.length) }), blockedL=sel.filter(function(p){ return p.problems&&p.problems.length });
      function compute(){
        var v=$("#bkStart").value, every=Math.max(1,Number($("#bkEvery").value)||1), unit=$("#bkUnit").value, wk=$("#bkWk").checked;
        plan=[]; if(!v){ $("#bkPlan").innerHTML=""; return }
        var d=new Date(v);
        ready.forEach(function(p,i){
          if(i){ if(unit==="hour") d=new Date(d.getTime()+every*3600e3); else { d=new Date(d); d.setDate(d.getDate()+every*(unit==="week"?7:1)) } }
          if(wk) while(d.getDay()===0||d.getDay()===6) d.setDate(d.getDate()+1);
          plan.push({id:p.id, at:d.getTime()});
        });
        $("#bkPlan").innerHTML=ready.map(function(p,i){ var first=(p.content||"").split("\n")[0]||"Picture post"; return '<li><b>'+fmtDate(plan[i].at,true)+'</b> <span>'+esc(first.slice(0,70))+'</span></li>' }).join("")+
          blockedL.map(function(p){ var first=(p.content||"").split("\n")[0]||"Picture post"; return '<li class="skip"><b>Skipped</b> <span>'+esc(first.slice(0,60))+'</span> <em>needs: '+esc(p.problems[0])+'</em></li>' }).join("");
        var go=$("#bkGo"); if(go){ go.textContent="Schedule "+plan.length; go.disabled=!plan.length }
      }
      ["bkStart","bkEvery","bkUnit","bkWk"].forEach(function(k){ $("#"+k).oninput=compute; $("#"+k).onchange=compute });
      compute();
      $("#bkN").onclick=function(){ more.innerHTML="" };
      $("#bkGo").onclick=function(){ if(!plan.length){ toast("Pick when the first one goes out.",true); return } if(plan[0].at<Date.now()+120000){ toast("The first time has already passed.",true); return } this.disabled=true; this.textContent="Scheduling…";
        runBulk("times", plan).then(function(r){ finish(r,"scheduled") }).catch(function(e){ toast(e.message,true) }) };
    }
  }
  $$("[data-sel]").forEach(function(x){ x.onchange=draw });
  $$("[data-selall]").forEach(function(a){ a.onchange=function(){ var on=a.checked; $$('[data-sel][data-grp="'+a.dataset.selall+'"]').forEach(function(b){ b.checked=on }); draw() } });
  draw();
}

/* Bulk edit: one set of changes for every selected post, previewed before anything is saved. */
function lineDiff(a, b){
  // Line-level diff (LCS) so the preview shows what each post loses and gains.
  var x=a.split("\n"), y=b.split("\n"), n=x.length, m=y.length, L=[], i, j;
  for(i=0;i<=n;i++){ L.push(new Array(m+1).fill(0)) }
  for(i=n-1;i>=0;i--) for(j=m-1;j>=0;j--) L[i][j]= x[i]===y[j] ? L[i+1][j+1]+1 : Math.max(L[i+1][j], L[i][j+1]);
  var out=[]; i=0; j=0;
  while(i<n&&j<m){ if(x[i]===y[j]){ out.push([" ",x[i]]); i++; j++ } else if(L[i+1][j]>=L[i][j+1]) out.push(["-",x[i++]]); else out.push(["+",y[j++]]) }
  while(i<n) out.push(["-",x[i++]]); while(j<m) out.push(["+",y[j++]]);
  return out.map(function(r){ return '<span class="dl'+(r[0]==="+"?" add":r[0]==="-"?" del":"")+'">'+(r[1]?esc(r[1]):"&nbsp;")+'</span>' }).join("");
}
function runEdit(ids, edit, dry, onStep){
  var results=[], i=0;
  function next(){
    if(i>=ids.length) return Promise.resolve(results);
    var chunk=ids.slice(i,i+10); i+=chunk.length;
    return api("POST","social/bulk-edit",{ids:chunk, edit:edit, dry:dry}).then(function(r){ results=results.concat(r.results); if(onStep) onStep(results.length, ids.length); return next() });
  }
  return next();
}
function bulkEdit(host, sel, brand, accounts, done){
  var n=sel.length, ids=sel.map(function(p){return p.id}), sched=sel.filter(function(p){return p.status==="scheduled"}).length;
  var inUse={}; sel.forEach(function(p){ p.targets.forEach(function(t){ inUse[t.platform]=1 }) });
  var connected=accounts.map(function(a){return a.platform});
  var pin=accounts.filter(function(a){return a.platform==="pinterest"})[0];
  var box=function(attr, p){ return '<label class="check"><input type="checkbox" '+attr+'="'+p+'"> '+esc(platName(p))+'</label>' };
  host.innerHTML='<div class="sheet bkedit"><h3>Edit '+n+' post'+(n===1?"":"s")+'</h3>'+
    (sched?'<p class="hint" style="margin:0">'+sched+' of these '+(sched===1?"is":"are")+' scheduled. '+(sched===1?"It’s":"They’re")+' pulled back, changed and put back at the same time.</p>':'')+
    '<div class="fieldrow"><div class="field"><label for="beFind">Find</label><input type="text" id="beFind" placeholder="Exact text, e.g. #guessthequote"></div>'+
      '<div class="field"><label for="beRep">Replace with</label><input type="text" id="beRep" placeholder="Leave empty to remove it"></div></div>'+
    '<div class="fieldrow"><div class="field"><label for="beStart">Add a line at the start</label><input type="text" id="beStart"></div>'+
      '<div class="field"><label for="beEnd">Add a line at the end</label><input type="text" id="beEnd" placeholder="e.g. Link in bio."><span class="hint">Goes above the hashtags. Skipped where it’s already there.</span></div></div>'+
    '<div class="fieldrow"><div class="field"><label for="beTagAdd">Add hashtags</label><input type="text" id="beTagAdd" placeholder="#wordsearch #cozygames"></div>'+
      '<div class="field"><label for="beTagRm">Remove hashtags</label><input type="text" id="beTagRm" placeholder="#puzzlegame"></div></div>'+
    '<div class="fieldrow"><fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label">Also post to</legend>'+(connected.map(function(p){ return box("data-pa",p) }).join("")||'<span class="hint">No accounts connected.</span>')+'</fieldset>'+
      '<fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label">Stop posting to</legend>'+(Object.keys(inUse).map(function(p){ return box("data-pr",p) }).join("")||'<span class="hint">None picked yet.</span>')+'</fieldset></div>'+
    ((pin||inUse.pinterest)?'<div class="fieldrow"><div class="field"><label for="bePinLink">Pinterest link</label><input type="text" id="bePinLink" placeholder="https://apps.apple.com/…"><span class="hint">Where a tap on the pin goes. Only changes posts that go to Pinterest.</span></div>'+
      '<div class="field"><label for="bePinBoard">Pinterest board</label><select id="bePinBoard"><option value="">Leave as it is</option></select></div></div>':'')+
    '<div class="actions"><button class="btn sm primary" type="button" id="beGo">Preview changes</button><button class="btn sm ghost" type="button" id="beN">Cancel</button></div><div id="bePrev"></div></div>';
  $("#beN").onclick=function(){ host.innerHTML="" };
  if(pin) api("GET","social/accounts/"+pin._id+"/boards").then(function(d){ var s=$("#bePinBoard"); if(!s) return; s.innerHTML='<option value="">Leave as it is</option>'+d.boards.map(function(b){ return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>' }).join("") }).catch(function(){});
  function read(){
    var v=function(k){ var el=$("#"+k); return el?el.value:"" };
    var tags=function(k){ return v(k).split(/[\s,]+/).map(function(x){return x.replace(/^#+/,"").trim()}).filter(Boolean) };
    var e={find:v("beFind"), replace:v("beRep"), start:v("beStart"), end:v("beEnd"), tags_add:tags("beTagAdd"), tags_remove:tags("beTagRm"),
      platforms_add:$$("[data-pa]:checked").map(function(x){return x.dataset.pa}), platforms_remove:$$("[data-pr]:checked").map(function(x){return x.dataset.pr})};
    if(v("bePinLink").trim()) e.pinterest_link=v("bePinLink").trim();
    if(v("bePinBoard")) e.pinterest_board=v("bePinBoard");
    return e;
  }
  var lastEdit=null;
  $$("input,select",host).forEach(function(el){ el.oninput=el.onchange=function(){ if(lastEdit){ lastEdit=null; $("#bePrev").innerHTML=""; $("#beGo").textContent="Preview changes" } } });
  $("#beGo").onclick=function(){
    var btn=this, e=read();
    if(lastEdit){ // second press: save
      btn.disabled=true; btn.textContent="Saving…";
      runEdit(ids, lastEdit, false, function(a,b){ btn.textContent="Saving "+a+" of "+b+"…" }).then(function(rs){
        var saved=rs.filter(function(r){return r.saved}), back=rs.filter(function(r){return r.saved&&r.error}), bad=rs.filter(function(r){return r.skipped});
        if(saved.length) toast(saved.length+" post"+(saved.length===1?"":"s")+" updated");
        if(back.length||bad.length){
          $("#bePrev").innerHTML='<ul class="probs">'+back.concat(bad).map(function(r){ var p=sel.filter(function(x){return x.id===r.id})[0]; return '<li><b>'+esc(((p&&p.content)||"").split("\n")[0].slice(0,50)||"Post")+'</b>: '+esc(r.error)+'</li>' }).join("")+'</ul><div class="actions"><button class="btn sm" type="button" id="beDone">Done</button></div>';
          $("#beDone").onclick=done; btn.remove();
        } else done();
      }).catch(function(err){ btn.disabled=false; btn.textContent="Try again"; toast(err.message,true) });
      return;
    }
    btn.disabled=true; btn.textContent="Checking…";
    runEdit(ids, e, true).then(function(rs){
      btn.disabled=false;
      var ch=rs.filter(function(r){return r.changed}), same=rs.filter(function(r){return !r.changed&&!r.skipped}), bad=rs.filter(function(r){return r.skipped});
      var h='<p class="hint" style="margin:0"><b>'+ch.length+'</b> will change'+(same.length?', '+same.length+' already match':'')+(bad.length?', '+bad.length+' can’t be changed':'')+'.</p><div class="bediffs">';
      h+=ch.map(function(r){
        var pl=r.platforms_before.join(",")!==r.platforms_after.join(",") ? '<span class="sub">Platforms: '+esc(r.platforms_before.map(platName).join(", ")||"none")+' → '+esc(r.platforms_after.map(platName).join(", ")||"none")+'</span>' : '';
        var warn=(r.notes||[]).concat(r.status==="scheduled"&&r.problems.length?["Will go back to drafts: "+r.problems[0]]:[]);
        return '<div class="bediff"><div class="bdh"><b>'+(r.at?esc(fmtDate(r.at,true)):"Draft")+'</b> '+socialChip(r.status)+'</div>'+pl+(r.before!==r.after?'<pre class="dlines">'+lineDiff(r.before,r.after)+'</pre>':'<span class="sub">Caption unchanged.</span>')+
          (warn.length?'<span class="sub warnx">'+esc(warn.join(" "))+'</span>':'')+'</div>' }).join("");
      h+=bad.map(function(r){ var p=sel.filter(function(x){return x.id===r.id})[0]; return '<div class="bediff"><span class="sub warnx"><b>'+esc(((p&&p.content)||"").split("\n")[0].slice(0,50)||"Post")+'</b>: '+esc(r.error)+'</span></div>' }).join("")+'</div>';
      $("#bePrev").innerHTML=h; $("#bePrev").scrollIntoView({block:"nearest"});
      if(ch.length){ lastEdit=e; btn.textContent="Save changes to "+ch.length } else btn.textContent="Preview changes";
    }).catch(function(err){ btn.disabled=false; btn.textContent="Preview changes"; toast(err.message,true) });
  };
  $("#beFind").focus();
}

/* Spreadsheet import: one row per post. */
var IMPORT_TEMPLATE="date,time,caption,platforms,media\n2026-10-14,09:30,\"First post. Links get tracked automatically: https://example.com\",\"instagram, bluesky\",https://example.com/photo.jpg\n2026-10-16,19:00,\"A text-only post for LinkedIn and Bluesky\",\"linkedin, bluesky\",\n";
var PLAT_WORDS={instagram:"instagram",ig:"instagram",insta:"instagram",tiktok:"tiktok",tt:"tiktok",linkedin:"linkedin",li:"linkedin",threads:"threads",bluesky:"bluesky",bsky:"bluesky",x:"twitter",twitter:"twitter",pinterest:"pinterest",pin:"pinterest",facebook:"facebook",fb:"facebook"};
function csvRows(text){
  var first=(text.split(/\r?\n/)[0]||""), counts={",":0,";":0,"\t":0};
  for(var k=0;k<first.length;k++) if(counts[first[k]]!==undefined) counts[first[k]]++;
  var delim=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a]})[0];
  var rows=[], row=[], f="", q=false;
  for(var i=0;i<text.length;i++){ var ch=text[i];
    if(q){ if(ch==='"'){ if(text[i+1]==='"'){ f+='"'; i++ } else q=false } else f+=ch }
    else if(ch==='"') q=true;
    else if(ch===delim){ row.push(f); f="" }
    else if(ch==='\n'||ch==='\r'){ if(ch==='\r'&&text[i+1]==='\n') i++; row.push(f); rows.push(row); row=[]; f="" }
    else f+=ch;
  }
  if(f||row.length){ row.push(f); rows.push(row) }
  return rows.filter(function(r){ return r.some(function(x){ return x.trim() }) });
}
function parseWhen(dateS, timeS){
  dateS=(dateS||"").trim(); timeS=(timeS||"").trim();
  if(!timeS){ var m0=dateS.match(/^(\S+)[ T](\d{1,2}[:.]\d{2}(?:\s*[ap]\.?m\.?)?)$/i); if(m0){ dateS=m0[1]; timeS=m0[2] } }
  if(!dateS) return {at:null};
  var y,mo,d, m;
  if((m=dateS.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))){ y=+m[1]; mo=+m[2]; d=+m[3] }
  else if((m=dateS.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/))){ d=+m[1]; mo=+m[2]; y=+m[3]; if(y<100) y+=2000 }  // day first, as in Spain and Ireland
  else return {error:"Can’t read the date “"+dateS+"”. Use 2026-10-14 or 14/10/2026."};
  var h=9, mi=0;
  if(timeS){ var t=timeS.match(/^(\d{1,2})[:.](\d{2})\s*([ap])?\.?m?\.?$/i); if(!t) return {error:"Can’t read the time “"+timeS+"”. Use 09:30 or 7:00 pm."}; h=+t[1]; mi=+t[2]; if(t[3]){ var pm=t[3].toLowerCase()==="p"; if(pm&&h<12) h+=12; if(!pm&&h===12) h=0 } }
  var dt=new Date(y,mo-1,d,h,mi);
  if(isNaN(dt)||dt.getMonth()!==mo-1) return {error:"“"+dateS+"” isn’t a real date."};
  return {at:dt.getTime(), noTime:!timeS};
}
function parsePostSheet(text, accounts){
  var rows=csvRows(text); if(!rows.length) return {rows:[], error:"That’s empty."};
  var hdr=rows[0].map(function(x){ return x.trim().toLowerCase() });
  var col=function(re){ return hdr.findIndex(function(h){ return re.test(h) }) };
  var ci=col(/^(caption|text|post|copy|content|message)/), di=col(/^(date|day)$/), ti=col(/^(time|hour)$/), wi=col(/^(when|datetime|date ?time|scheduled|publish)/), pi=col(/^(platforms?|channels?|networks?|accounts?)$/), mi=col(/^(media|image|images|video|photo|file|media ?urls?|image ?url)/);
  if(ci<0) return {rows:[], error:"Add a header row with at least a “caption” column. Download the template to see the layout."};
  var connected=accounts.map(function(a){return a.platform});
  var out=rows.slice(1).map(function(r,i){
    var o={row:i+2, caption:(r[ci]||"").trim(), issues:[]};
    var w=wi>-1 ? parseWhen(r[wi]) : parseWhen(di>-1?r[di]:"", ti>-1?r[ti]:"");
    if(w.error) o.issues.push(w.error); o.at=w.at||null; if(w.noTime&&o.at) o.issues.push("No time given, so 09:00.");
    var pl=pi>-1 ? (r[pi]||"").split(/[,;|\/]+/).map(function(x){ return PLAT_WORDS[x.trim().toLowerCase()] || (x.trim()?"?"+x.trim():"") }).filter(Boolean) : [];
    var unknown=pl.filter(function(x){ return x[0]==="?" }); if(unknown.length) o.issues.push("Unknown platform: "+unknown.map(function(x){return x.slice(1)}).join(", "));
    pl=pl.filter(function(x){ return x[0]!=="?" });
    var notConn=pl.filter(function(x){ return connected.indexOf(x)<0 }); if(notConn.length){ o.issues.push("Not connected: "+notConn.map(platName).join(", ")+" (left out)"); pl=pl.filter(function(x){ return connected.indexOf(x)>-1 }) }
    o.platforms=pl;
    o.media=mi>-1 ? (r[mi]||"").split(/[\s|,]+/).map(function(x){return x.trim()}).filter(function(x){ return /^https:\/\//.test(x) }) : [];
    if(!o.caption&&!o.media.length) o.issues.push("Nothing to post.");
    if(o.at && o.at<Date.now()+120000) o.issues.push("That time has passed; it’ll be a draft.");
    return o;
  }).filter(function(o){ return o.caption||o.media.length||o.issues.length>1 });
  return {rows:out};
}
function importSheet(host, brand, accounts){
  var parsed={rows:[]};
  host.innerHTML='<div class="sheet"><h3>Import posts for '+esc(brand.name)+'</h3>'+
    '<p class="hint" style="margin:0">One row per post: <span class="mono">date, time, caption, platforms, media</span>. Platforms can be left blank for every connected account. Media is a public link to a picture or video (Google Drive and Dropbox share links work). <a href="#" id="imTpl">Download the template</a></p>'+
    '<div class="actions"><label class="btn sm" style="cursor:pointer"><input type="file" id="imFile" accept=".csv,.tsv,.txt,text/csv" hidden> Choose a CSV file</label><span class="hint">or paste from a spreadsheet below</span></div>'+
    '<textarea id="imText" class="code" style="min-height:110px" placeholder="date,time,caption,platforms,media"></textarea>'+
    '<div id="imPrev"></div>'+
    '<label class="check"><input type="checkbox" id="imSched" checked> Schedule rows that have a date. Rows without one, or that still need something, are saved as drafts.</label>'+
    '<div class="actions"><button class="btn primary" type="button" id="imGo" disabled>Import</button><button class="btn ghost" type="button" id="imCancel">Cancel</button></div><div id="imOut"></div></div>';
  $("#imCancel").onclick=function(){ host.innerHTML="" };
  $("#imTpl").onclick=function(e){ e.preventDefault(); var a=document.createElement("a"); a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(IMPORT_TEMPLATE); a.download="studio-posts-template.csv"; document.body.appendChild(a); a.click(); a.remove() };
  function preview(){
    parsed=parsePostSheet($("#imText").value, accounts);
    var p=$("#imPrev");
    if(parsed.error){ p.innerHTML=$("#imText").value.trim()?'<p class="hint" style="color:var(--danger)">'+esc(parsed.error)+'</p>':''; $("#imGo").disabled=true; return }
    var rows=parsed.rows;
    p.innerHTML=rows.length?'<div class="tablewrap imtable"><table><thead><tr><th>Row</th><th>When</th><th>Where</th><th>Caption</th><th class="r">Media</th></tr></thead><tbody>'+rows.map(function(r){
      return '<tr><td class="mono">'+r.row+'</td><td class="mono">'+(r.at?esc(fmtDate(r.at,true)):"Draft")+'</td><td>'+esc(r.platforms.length?r.platforms.map(platName).join(", "):"All connected")+'</td><td>'+esc(r.caption.slice(0,90))+(r.caption.length>90?"…":"")+(r.issues.length?'<span class="sub warnx">'+esc(r.issues.join(" "))+'</span>':'')+'</td><td class="r mono">'+r.media.length+'</td></tr>' }).join("")+'</tbody></table></div>'
      : '';
    $("#imGo").disabled=!rows.length; $("#imGo").textContent=rows.length?"Import "+rows.length+" post"+(rows.length===1?"":"s"):"Import";
  }
  $("#imText").oninput=preview;
  $("#imFile").onchange=function(){ var f=this.files[0]; if(!f) return; var rd=new FileReader(); rd.onload=function(){ $("#imText").value=String(rd.result||""); preview() }; rd.readAsText(f) };
  $("#imGo").onclick=function(){
    var btn=this, rows=parsed.rows, sched=$("#imSched").checked, results=[], i=0; btn.disabled=true;
    function step(){
      if(i>=rows.length) return Promise.resolve();
      var chunk=rows.slice(i,i+5); i+=chunk.length; btn.textContent="Importing "+Math.min(i,rows.length)+" of "+rows.length+"…";
      return api("POST","social/import",{profile_id:brand._id, schedule:sched, rows:chunk.map(function(r){ return {row:r.row, caption:r.caption, platforms:r.platforms, media:r.media, at:r.at} })})
        .then(function(res){ results=results.concat(res.results); return step() });
    }
    step().then(function(){
      var sc=results.filter(function(r){return r.status==="scheduled"}), dr=results.filter(function(r){return r.status==="draft"}), sk=results.filter(function(r){return r.status==="skipped"});
      $("#imOut").innerHTML='<div class="notice"><p><b>'+sc.length+' scheduled</b>, '+dr.length+' saved as draft'+(dr.length===1?"":"s")+(sk.length?', '+sk.length+' skipped':'')+'.</p><button class="btn sm" type="button" id="imDone">Done</button></div>'+
        ((dr.length||sk.length)?'<ul class="probs" style="margin-top:10px">'+dr.concat(sk).filter(function(r){ return r.error||(r.problems&&r.problems.length) }).map(function(r){ return '<li>Row '+r.row+': '+esc(r.error||r.problems[0])+'</li>' }).join("")+'</ul>':'');
      $("#imDone").onclick=function(){ route() };
      btn.textContent="Imported";
    }).catch(function(e){ btn.disabled=false; btn.textContent="Try again"; toast(e.message,true) });
  };
}

function socialView(brandParam){
  return loadSocialMeta().then(function(meta){
    var v=$("#view");
    if(!meta.connected){
      v.innerHTML=head("Marketing","Social","Write once, post to every account, now or on a schedule.")+
        '<div class="panel"><div class="pad stack" style="gap:12px"><p style="margin:0"><b>Connect Zernio to start.</b> Zernio is the service that does the posting. You link each account once with the normal “log in with Instagram” screen, all from here.</p>'+
        '<p class="hint" style="margin:0">Your first 2 accounts are free, then it’s $6 a month per account. X charges a few cents per post on top.</p>'+
        '<div class="actions"><a class="btn primary" href="#/settings">Add your Zernio key in Settings</a></div></div></div>';
      return;
    }
    return api("GET","social/brands").then(function(bd){
      var brands=bd.brands, want=brandParam||store("studio.brand");
      var brand=brands.filter(function(b){return b._id===want})[0]||brands[0];
      var q=hashQuery();
      if(q.get("connected")) toast(platName(q.get("connected"))+" connected"+(q.get("username")?" as "+q.get("username"):""));
      if(q.get("error")) toast("That didn’t connect: "+(q.get("error_message")||q.get("error")), true);
      if(q.toString()) history.replaceState(null,"","#/social"+(brand?"/b/"+brand._id:""));
      if(!brand){
        v.innerHTML=head("Marketing","Social","Write once, post to every account, now or on a schedule.")+'<form class="sheet" id="brandForm"><h3>Add your first brand</h3><p class="hint" style="margin:0">A brand holds one account per platform, like Ciúnas’s Instagram, TikTok and LinkedIn.</p><div class="field"><label for="bName">Brand name</label><input type="text" id="bName" required maxlength="60" placeholder="e.g. Ciúnas"></div><div class="actions"><button class="btn primary" type="submit">Create brand</button></div></form>';
        $("#brandForm").onsubmit=function(e){ e.preventDefault(); api("POST","social/brands",{name:$("#bName").value}).then(function(r){ store("studio.brand",r.brand._id); go("#/social/b/"+r.brand._id) }).catch(function(e){ toast(e.message,true) }) };
        return;
      }
      store("studio.brand",brand._id);
      return Promise.all([api("GET","social/brands/"+brand._id+"/accounts"), api("GET","social/posts?brand="+encodeURIComponent(brand._id))]).then(function(r){
        var accounts=r[0].accounts, posts=r[1].posts;
        var byPlat={}; accounts.forEach(function(a){ byPlat[a.platform]=a });
        var html=head("Marketing","Social","Write once, post to every account, now or on a schedule.",'<button class="btn" type="button" id="importBtn"'+(accounts.length?'':' disabled')+'>Import posts</button><button class="btn primary" type="button" id="newPost"'+(accounts.length?'':' disabled')+'>New post</button>')+'<div id="importHost"></div>';
        if(meta.simulated) html+='<div class="notice"><p>Local test copy: posting is simulated.</p></div>';
        html+='<nav class="tabs" role="tablist" aria-label="Brands">'+brands.map(function(b){ return '<a role="tab" href="#/social/b/'+esc(b._id)+'" aria-selected="'+(b._id===brand._id)+'">'+esc(b.name)+'</a>' }).join("")+'<button type="button" id="briefBtn">Brief for Claude</button><button type="button" id="renameBrand">Rename</button><button type="button" id="addBrand">+ Brand</button></nav><div id="brandHost"></div>';
        html+='<section class="panel"><h2 class="sec">Accounts <span class="hint">One per platform. Set up Studio’s own platform apps in <a href="#/settings">Settings</a>.</span></h2><div class="plats">'+
          PLAT_ORDER.map(function(p){ var a=byPlat[p];
            return '<div class="plat'+(a?" on":"")+'"><span class="pn">'+esc(platName(p))+'</span>'+
              (a ? '<span class="pu">@'+esc(a.username)+(a.via==="zernio"?' · via Zernio':'')+(a.active?'':' · <span class="warnx" title="'+esc(a.note||"")+'">needs reconnecting</span>')+'</span>'+(a.active?'':'<button class="btn sm" type="button" data-conn="'+p+'">Reconnect</button>')+'<button class="btn sm ghost" type="button" data-disc="'+esc(a._id)+'" data-plat="'+p+'">Disconnect</button>'
                 : '<button class="btn sm" type="button" data-conn="'+p+'">Connect</button>')+'</div>' }).join("")+'</div><div id="discHost"></div></section><div id="resHost"></div><div id="perfHost"></div><div id="slotsHost"></div>';
        var groups=[["Needs attention",function(p){return p.status==="failed"||p.status==="partial"}],["Coming up",function(p){return p.status==="scheduled"||p.status==="publishing"}],["Drafts",function(p){return p.status==="draft"}],["Posted",function(p){return p.status==="published"}]];
        if(!posts.length) html+='<div class="empty"><b>No posts yet</b>'+(accounts.length?'Write one and send it everywhere at once.':'Connect an account above, then write your first post.')+'</div>';
        groups.forEach(function(g){
          var list=posts.filter(g[1]); if(!list.length) return;
          var grp=g[0]==="Drafts"?"d":g[0]==="Coming up"?"s":"";
          html+='<section class="panel"><h2 class="sec"><span class="sechd">'+(grp?'<label class="pk"><input type="checkbox" data-selall="'+grp+'" aria-label="Select all '+g[0].toLowerCase()+'"></label>':'')+g[0]+'</span> <span class="hint">'+list.length+'</span></h2><div class="rows">'+list.map(function(p){
            var when = p.status==="draft" ? (p.planned_at?"Planned "+fmtDate(p.planned_at,true):"Edited "+fmtDate(p.updated_at,true)) : p.status==="published"||p.status==="partial" ? fmtDate(p.published_at||p.scheduled_at,true) : fmtDate(p.scheduled_at,true);
            var first=(p.content||"").split("\n")[0]||(p.media.length?"Picture post":"Empty post");
            var sub=esc(when)+' · '+esc(p.targets.map(function(t){return platName(t.platform)}).join(", ")||"No accounts picked")+(p.media.length?' · '+p.media.length+' media':'')+(p.status==="draft"&&p.problems&&p.problems.length?' · <span class="warnx">needs: '+esc(p.problems[0])+'</span>':'');
            var canPick=grp&&(p.status==="draft"||p.status==="scheduled");
            return '<div class="rowi nosq'+(canPick?' pickrow':'')+'">'+(canPick?'<label class="pk"><input type="checkbox" data-sel="'+esc(p.id)+'" data-grp="'+grp+'" aria-label="Select '+esc(first.slice(0,40))+'"></label>':'')+'<a class="t" href="#/social/p/'+esc(p.id)+'">'+esc(first)+'<small>'+sub+'</small></a><span class="meta">'+socialChip(p.status)+'</span></div>' }).join("")+'</div></section>';
        });
        html+='<div id="bulkBar" class="bulkbar" hidden></div>';
        v.innerHTML=html;
        bulkSetup(posts, brand, accounts);
        $("#importBtn").onclick=function(){ importSheet($("#importHost"), brand, accounts); $("#imText").focus() };
        slotsPanel($("#slotsHost"), brand);
        perfPanel($("#perfHost"), brand);
        api("GET","links/stats?brand="+encodeURIComponent(brand._id)+"&days=30").then(function(d){ if(!d.platforms.length) return; var h=$("#resHost"); if(!h) return;
          var tc=0, ts=0; d.platforms.forEach(function(x){ tc+=x.clicks; ts+=x.signups });
          h.innerHTML='<section class="panel"><h2 class="sec">Last 30 days <span class="hint">'+tc+' clicks · '+ts+' sign-ups from '+esc(brand.name)+' posts</span></h2><div class="plats">'+d.platforms.map(function(x){ return '<div class="plat"><span class="pn">'+esc(platName(x.platform))+'</span><span class="pu">'+x.clicks+' click'+(x.clicks===1?"":"s")+' · '+x.signups+' sign-up'+(x.signups===1?"":"s")+'</span></div>' }).join("")+'</div></section>' }).catch(function(){});
        $("#newPost").onclick=function(){ this.disabled=true; api("POST","social/posts",{profile_id:brand._id, targets:accounts.map(function(a){ return {platform:a.platform, accountId:a._id} })}).then(function(r){ go("#/social/p/"+r.post.id) }).catch(function(e){ toast(e.message,true) }) };
        $("#briefBtn").onclick=function(){ go("#/social/b/"+brand._id+"/brief") };
        $("#renameBrand").onclick=function(){
          $("#brandHost").innerHTML='<form class="sheet" id="rbForm"><div class="field"><label for="rbName">Rename '+esc(brand.name)+'</label><input type="text" id="rbName" required maxlength="60" value="'+esc(brand.name)+'"></div><div class="actions"><button class="btn primary sm" type="submit">Save name</button><button class="btn ghost sm" type="button" id="rbCancel">Cancel</button></div></form>';
          var i=$("#rbName"); i.focus(); i.select(); $("#rbCancel").onclick=function(){ $("#brandHost").innerHTML="" };
          $("#rbForm").onsubmit=function(e){ e.preventDefault(); var b=this.querySelector("[type=submit]"); b.disabled=true;
            api("PATCH","social/brands/"+brand._id,{name:i.value}).then(function(r){ toast("Renamed to "+r.brand.name); route() }).catch(function(err){ b.disabled=false; toast(err.message,true) }) };
        };
        $("#addBrand").onclick=function(){
          $("#brandHost").innerHTML='<form class="sheet" id="brandForm"><div class="field"><label for="bName">Brand name</label><input type="text" id="bName" required maxlength="60" placeholder="e.g. Seek"></div><div class="actions"><button class="btn primary sm" type="submit">Create brand</button><button class="btn ghost sm" type="button" id="bCancel">Cancel</button></div></form>';
          $("#bName").focus(); $("#bCancel").onclick=function(){ $("#brandHost").innerHTML="" };
          $("#brandForm").onsubmit=function(e){ e.preventDefault(); api("POST","social/brands",{name:$("#bName").value}).then(function(r){ go("#/social/b/"+r.brand._id) }).catch(function(e){ toast(e.message,true) }) };
        };
        $$("[data-conn]").forEach(function(b){ var label=b.textContent; b.onclick=function(){ b.disabled=true; b.textContent="Opening…";
          api("POST","social/brands/"+brand._id+"/connect",{platform:b.dataset.conn}).then(function(r){
            if(r.url){ location.href=r.url; return }
            b.disabled=false; b.textContent=label;
            if(r.password) passwordForm(b.dataset.conn);
          }).catch(function(e){ b.disabled=false; b.textContent=label; toast(e.message,true) }) } });
        function passwordForm(pl){
          var h=$("#discHost");
          h.innerHTML='<form class="sheet" id="pwForm" style="margin:0 18px 16px" autocomplete="off"><h3>Connect '+esc(platName(pl))+'</h3>'+
            '<p class="hint" style="margin:0">In '+esc(platName(pl))+', open <b>Settings → Privacy and security → App passwords</b>, add one called “Studio”, and paste it here. Studio never sees your main password.</p>'+
            '<div class="fieldrow"><div class="field"><label for="pwHandle">Handle</label><input type="text" id="pwHandle" required maxlength="200" placeholder="ciunas.bsky.social" spellcheck="false"></div>'+
            '<div class="field"><label for="pwPass">App password</label><input type="password" id="pwPass" required maxlength="40" placeholder="abcd-efgh-ijkl-mnop" spellcheck="false"></div></div>'+
            '<div class="actions"><button class="btn primary sm" type="submit">Connect</button><button class="btn ghost sm" type="button" id="pwCancel">Cancel</button></div></form>';
          $("#pwHandle").focus(); $("#pwCancel").onclick=function(){ h.innerHTML="" };
          $("#pwForm").onsubmit=function(e){ e.preventDefault(); var sb=this.querySelector("[type=submit]"); sb.disabled=true; sb.textContent="Checking…";
            api("POST","social/brands/"+brand._id+"/connect",{platform:pl, handle:$("#pwHandle").value.trim(), password:$("#pwPass").value.trim()})
              .then(function(r){ toast(platName(pl)+" connected as "+r.account.username); route() })
              .catch(function(err){ sb.disabled=false; sb.textContent="Connect"; toast(err.message,true) }) };
        }
        $$("[data-disc]").forEach(function(b){ b.onclick=function(){
          $("#discHost").innerHTML='<div class="confirm" style="margin:0 18px 16px"><span>Disconnect '+esc(platName(b.dataset.plat))+'? Scheduled posts for it will fail. You can connect it again any time.</span><button class="btn sm danger" type="button" id="dcYes">Disconnect</button><button class="btn sm ghost" type="button" id="dcNo">Keep it</button></div>';
          $("#dcNo").onclick=function(){ $("#discHost").innerHTML="" };
          $("#dcYes").onclick=function(){ api("DELETE","social/accounts/"+b.dataset.disc).then(function(){ toast("Disconnected"); route() }).catch(function(e){ toast(e.message,true) }) };
        } });
      });
    });
  });
}

function socialPostView(pid){
  return loadSocialMeta().then(function(meta){ return api("GET","social/posts/"+pid) }).then(function(r){
    var p=r.post;
    return Promise.all([api("GET","social/brands"), api("GET","social/brands/"+p.profile_id+"/accounts")]).then(function(rr){
      var brand=rr[0].brands.filter(function(b){return b._id===p.profile_id})[0]||{name:"Brand",_id:p.profile_id}, accounts=rr[1].accounts;
      var v=$("#view"), editable=p.status==="draft";
      var sel=function(){ return p.targets.map(function(t){return t.platform}) };
      var acctFor=function(pl){ return accounts.filter(function(a){return a.platform===pl})[0] };
      var where=function(){ return sel().map(platName).join(", ") };
      var html='<div class="pagehead"><div><span class="eyebrow"><a href="#/social/b/'+esc(brand._id)+'" style="color:inherit;text-decoration:none">Social · '+esc(brand.name)+'</a></span><h1>'+(editable?"Write a post":esc(SOCIAL_STATUS[p.status]||p.status))+'</h1>'+
        '<p class="sub">'+socialChip(p.status)+' '+(p.status==="scheduled"?"Goes out "+fmtDate(p.scheduled_at,true):p.published_at?"Went out "+fmtDate(p.published_at,true):"")+'</p></div>'+
        '<div class="actions"><button class="btn" type="button" id="spDup">Duplicate</button><button class="btn danger" type="button" id="spDel">Delete</button></div></div><div id="spConfirm"></div><div id="campHost"></div>';
      if(p.error && editable) html+='<div class="notice danger"><p>Last try didn’t go out: '+esc(p.error)+'</p></div>';
      if(editable && (p.note||p.planned_at)) html+='<div class="notice"><p>'+(p.note?'<b>Claude:</b> '+esc(p.note)+' ':'')+(p.planned_at?'Planned for <b>'+fmtDate(p.planned_at,true)+'</b>.':'')+'</p>'+(p.origin==="claude"?'<a class="btn sm" href="#/review">Back to review</a>':'')+'</div>';
      if(!editable){
        html+='<div class="editor"><div class="stack">';
        if(p.status==="scheduled") html+='<div class="notice"><p>Scheduled for <b>'+fmtDate(p.scheduled_at,true)+'</b>. To change the words or pictures, pull it back to a draft first.</p><button class="btn sm" type="button" id="spUnsched">Unschedule</button></div>'+
          '<div class="actions"><label class="sr" for="spMove">New time</label><input type="datetime-local" id="spMove" style="width:auto"><button class="btn sm" type="button" id="spMoveGo">Move to this time</button></div>';
        if(p.status==="publishing") html+='<div class="notice"><p>Going out now. This page updates when it’s done.</p></div>';
        html+='<section class="panel"><h2 class="sec">Where it went</h2><div class="rows">'+(p.results.length?p.results:p.targets.map(function(t){return {platform:t.platform,status:p.status}})).map(function(x){
          return '<div class="rowi nosq"><span class="t">'+esc(platName(x.platform))+(x.error?'<small class="err">'+esc(x.error)+'</small>':'')+'</span><span class="meta">'+(x.url?'<a href="'+esc(x.url)+'" target="_blank" rel="noopener">View post</a>':'')+socialChip(x.status==="scheduled"?"scheduled":x.error?"failed":x.status)+'</span></div>' }).join("")+'</div></section>';
        if(p.status==="published"||p.status==="partial") html+='<section class="panel"><h2 class="sec">Results <span class="hint">from each platform, plus clicks and sign-ups from tracked links</span></h2><div id="spLinks"><div class="loading" style="padding:14px 18px">Loading…</div></div></section>';
        if(p.status==="failed"||p.status==="partial") html+='<div class="actions"><button class="btn primary" type="button" id="spRetry">Try again'+(p.status==="partial"?" where it failed":"")+'</button></div>';
        html+='</div><div class="proof"><div class="proofbar"><span class="url">preview</span></div><div id="spPrev" class="spprev"></div></div></div>';
        v.innerHTML=html;
        campaignPicker($("#campHost"),"post",pid,p.initiative_id);
        renderPreview();
        var us=$("#spUnsched"); if(us) us.onclick=function(){ api("POST","social/posts/"+pid+"/unschedule").then(function(){ toast("Back to draft"); route() }).catch(function(e){ toast(e.message,true) }) };
        if($("#spLinks")) api("GET","links/stats?post="+encodeURIComponent(pid)+"&days=365").then(function(d){ var h=$("#spLinks"); if(!h) return;
          var link={}; d.platforms.forEach(function(x){ link[x.platform]=x });
          var plats=p.targets.map(function(t){return t.platform}), mt=p.metrics||{}, n=function(o,k){ return o&&o[k]!=null?Number(o[k]).toLocaleString():"—" };
          var seen=function(o){ if(!o) return "—"; var v=Math.max(o.impressions||0,o.reach||0,o.views||0,o.plays||0); return v?v.toLocaleString():"—" };
          h.innerHTML='<div class="tablewrap"><table><thead><tr><th>Platform</th><th class="r">Seen</th><th class="r">Likes</th><th class="r">Comments</th><th class="r">Shares</th><th class="r">Link clicks</th><th class="r">Sign-ups</th></tr></thead><tbody>'+plats.map(function(pl){ var m=mt[pl], l=link[pl];
            return '<tr><td>'+esc(platName(pl))+'</td><td class="r mono">'+seen(m)+'</td><td class="r mono">'+n(m,"likes")+'</td><td class="r mono">'+n(m,"comments")+'</td><td class="r mono">'+(m?((m.shares||0)+(m.reposts||0)).toLocaleString():"—")+'</td><td class="r mono">'+(l?l.clicks:"—")+'</td><td class="r mono">'+(l?l.signups:"—")+'</td></tr>' }).join("")+'</tbody></table></div>'+
            (p.metrics_at?'<p class="hint" style="margin:10px 18px">Numbers from '+fmtDate(p.metrics_at,true)+'. They refresh every hour.</p>':'<p class="hint" style="margin:10px 18px">Likes and reach arrive within the hour after posting.</p>') }).catch(function(){});
        var mv=$("#spMoveGo"); if(mv) mv.onclick=function(){ var val=$("#spMove").value; if(!val){ toast("Pick a new date and time first.",true); return }
          api("POST","social/posts/"+pid+"/reschedule",{at:new Date(val).getTime()}).then(function(){ toast("Moved"); route() }).catch(function(e){ toast(e.message,true) }) };
        var rt=$("#spRetry"); if(rt) rt.onclick=function(){ this.disabled=true; api("POST","social/posts/"+pid+"/publish",{}).then(function(){ toast("Trying again"); route() }).catch(function(e){ toast(e.message,true); rt.disabled=false }) };
        if(p.status==="publishing"||(p.status==="scheduled"&&p.scheduled_at<Date.now()+120000)){ var poll=setInterval(route, 8000); S.cleanup.push(function(){ clearInterval(poll) }) }
        common(); return;
      }

      html+='<div class="editor wide"><form class="form panel" id="spForm" autocomplete="off"><h2 class="sec">Post <span class="saving" id="spSave">Saved</span></h2>'+
        '<div class="field"><span class="label">Post to</span><div class="picks" role="group" aria-label="Accounts">'+
          (accounts.length ? accounts.map(function(a){ return '<button type="button" data-pick="'+esc(a.platform)+'" aria-pressed="'+(sel().indexOf(a.platform)>-1)+'">'+esc(platName(a.platform))+'</button>' }).join("") : '<span class="hint">No accounts connected for '+esc(brand.name)+'. <a href="#/social/b/'+esc(brand._id)+'">Connect one</a>.</span>')+'</div></div>'+
        '<div class="field"><label for="spText">Caption</label><textarea id="spText" class="code" style="min-height:200px" maxlength="70000">'+esc(p.content)+'</textarea><div class="counts" id="spCounts"></div></div>'+
        '<div class="field"><div class="actions" style="justify-content:space-between"><span class="label">Per platform</span><button class="btn sm" type="button" id="spTweak">Tweak for each platform</button></div><div id="spCaps"></div></div>'+
        '<div class="field"><label class="check"><input type="checkbox" id="spTrack"'+(p.options.track===false?"":" checked")+'> Track links</label><span class="hint">Links become go.'+esc(S.me.root)+'/l/… so Studio can count clicks and sign-ups from each platform.</span></div>'+
        '<div class="field"><span class="label">Pictures and video</span><div class="media" id="spMedia"></div>'+
          '<div class="actions"><label class="btn sm" style="cursor:pointer"><input type="file" id="spFile" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" multiple hidden> Upload</label>'+(S.me.files?'<button class="btn sm" type="button" id="spLib">From your files</button>':'')+'</div><span class="hint">'+(S.me.files?'Uploads are saved to your '+esc(brand.name)+' files too.':'Up to 100 MB each.')+' Instagram, TikTok and Pinterest need at least one.</span></div>'+
        '<div id="spExtras" class="stack" style="gap:14px"></div>'+
        '<h2 class="sec">Send</h2><ul class="probs" id="spProbs"></ul>'+
        '<div class="actions"><button class="btn primary" type="button" id="spQueue" disabled>Add to queue</button><button class="btn" type="button" id="spNow">Post now</button></div>'+
        '<div class="actions"><label class="sr" for="spAt">Schedule for</label><input type="datetime-local" id="spAt" style="width:auto" value="'+esc(p.planned_at&&p.planned_at>Date.now()+180000?localInput(p.planned_at):"")+'"><button class="btn" type="button" id="spSched">Schedule for this time</button></div><p class="hint" id="spQHint"></p><div id="spSend"></div>'+
        '</form><div class="proof"><div class="proofbar"><span class="url">preview</span></div><div id="spPrev" class="spprev"></div></div></div>';
      v.innerHTML=html;
      campaignPicker($("#campHost"),"post",pid,p.initiative_id);

      var save=saver($("#spSave"), function(x){ return api("PATCH","social/posts/"+pid,x).then(function(res){ p.problems=res.post.problems; showProblems() }) });
      p.options.captions=p.options.captions||{};
      var capTab=null, showCaps=Object.keys(p.options.captions).some(function(k){return p.options.captions[k]});
      function counts(){
        $("#spCounts").innerHTML=sel().map(function(pl){ var own=p.options.captions[pl], n=(own||$("#spText").value).length, lim=S.social.platforms[pl].limit, over=n>lim; return '<span class="'+(over?"over":"")+'">'+esc(platName(pl))+(own?"*":"")+' '+n.toLocaleString()+'/'+lim.toLocaleString()+'</span>' }).join("")+(Object.keys(p.options.captions).some(function(k){return p.options.captions[k]&&sel().indexOf(k)>-1})?'<span>* own caption</span>':'');
      }
      function caps(){
        var host=$("#spCaps"), list=sel(); if(!host) return;
        $("#spTweak").textContent=showCaps?"Hide":"Tweak for each platform";
        if(!showCaps||!list.length){ host.innerHTML=showCaps?'<p class="hint">Pick some accounts first.</p>':''; return }
        if(list.indexOf(capTab)<0) capTab=list[0];
        var own=p.options.captions[capTab]||"";
        host.innerHTML='<div class="captabs" role="tablist">'+list.map(function(pl){ return '<button type="button" role="tab" data-ct="'+pl+'" aria-selected="'+(pl===capTab)+'">'+esc(platName(pl))+(p.options.captions[pl]?" *":"")+'</button>' }).join("")+'</div>'+
          '<textarea id="spCap" class="code" style="min-height:130px" placeholder="Same as the main caption. Type here to give '+esc(platName(capTab))+' its own version.">'+esc(own)+'</textarea>'+
          '<div class="actions"><button class="btn sm" type="button" id="spCapCopy">Start from the main caption</button>'+(own?'<button class="btn sm ghost" type="button" id="spCapClear">Use the main caption</button>':'')+'</div>';
        $$("[data-ct]",host).forEach(function(b){ b.onclick=function(){ capTab=b.dataset.ct; caps(); renderPreview() } });
        var ta=$("#spCap"); ta.oninput=function(){ p.options.captions[capTab]=ta.value; save({options:p.options}); counts(); renderPreview(); var tab=$('[data-ct="'+capTab+'"]',host); if(tab) tab.textContent=platName(capTab)+(ta.value?" *":"") };
        $("#spCapCopy").onclick=function(){ ta.value=$("#spText").value; ta.dispatchEvent(new Event("input")); ta.focus() };
        var cl=$("#spCapClear"); if(cl) cl.onclick=function(){ delete p.options.captions[capTab]; save({options:p.options}); save.now(); caps(); counts(); renderPreview() };
      }
      var nextAt=null;
      function showProblems(){ var ul=$("#spProbs"); if(!ul) return; ul.innerHTML=(p.problems||[]).map(function(x){ return '<li>'+esc(x)+'</li>' }).join(""); var bad=!!(p.problems&&p.problems.length); $("#spNow").disabled=$("#spSched").disabled=bad; $("#spQueue").disabled=bad||!nextAt }
      api("GET","social/brands/"+brand._id+"/slots").then(function(d){ nextAt=d.next; var q=$("#spQueue"), h=$("#spQHint"); if(!q) return;
        if(nextAt){ q.textContent="Add to queue: "+fmtDate(nextAt,true); h.textContent="" } else { h.innerHTML='Set <a href="#/social/b/'+esc(brand._id)+'">posting times</a> for '+esc(brand.name)+' to use the queue.' }
        showProblems() }).catch(function(){});
      function mediaList(){
        $("#spMedia").innerHTML=p.media.map(function(m,i){ return '<figure>'+(m.type==="video"?'<video src="'+esc(m.url)+'" muted playsinline preload="metadata"></video>':'<img src="'+esc(m.url)+'" alt="">')+'<figcaption>'+esc(m.name||m.type)+'</figcaption><span class="figacts">'+(m.type==="image"&&S.me.files?'<button type="button" class="btn sm ghost" data-crop="'+i+'" aria-label="Crop '+esc(m.name||"image")+'">Crop</button>':'')+'<button type="button" class="btn sm ghost" data-rm="'+i+'" aria-label="Remove '+esc(m.name||"file")+'">Remove</button></span></figure>' }).join("");
        $$("[data-crop]").forEach(function(b){ b.onclick=function(){ var i=Number(b.dataset.crop), m=p.media[i];
          cropImage(m.url, m.name||"image.jpg", bestRatio(sel()), brand.name).then(function(f){ if(!f) return; p.media[i]={url:f.url, type:"image", name:f.name}; mediaList(); save({media:p.media}); save.now(); renderPreview() }) } });
        $$("[data-rm]").forEach(function(b){ b.onclick=function(){ p.media.splice(Number(b.dataset.rm),1); mediaList(); save({media:p.media}); save.now(); renderPreview() } });
      }
      function extras(){
        var h='', o=p.options;
        if(sel().indexOf("pinterest")>-1){
          o.pinterest=o.pinterest||{};
          h+='<fieldset class="xtra"><legend>Pinterest</legend><div class="field"><label for="pinBoard">Board</label><select id="pinBoard"><option value="">Loading boards…</option></select></div>'+
            '<div class="fieldrow"><div class="field"><label for="pinTitle">Pin title</label><input type="text" id="pinTitle" maxlength="100" value="'+esc(o.pinterest.title||"")+'" placeholder="First line of the caption"></div>'+
            '<div class="field"><label for="pinLink">Link</label><input type="text" id="pinLink" maxlength="500" value="'+esc(o.pinterest.link||"")+'" placeholder="https://"></div></div></fieldset>';
        }
        if(sel().indexOf("tiktok")>-1){
          o.tiktok=o.tiktok||{};
          h+='<fieldset class="xtra"><legend>TikTok</legend><div class="field"><label for="tkPriv">Who can see it</label><select id="tkPriv"><option value="">Loading…</option></select></div>'+
            '<label class="check"><input type="checkbox" id="tkCom"'+(o.tiktok.allow_comment===false?"":" checked")+'> Allow comments</label>'+
            (p.media.some(function(m){return m.type==="video"}) ? '<label class="check"><input type="checkbox" id="tkDuet"'+(o.tiktok.allow_duet===false?"":" checked")+'> Allow duets</label><label class="check"><input type="checkbox" id="tkStitch"'+(o.tiktok.allow_stitch===false?"":" checked")+'> Allow stitches</label>' : '')+
            '<label class="check"><input type="checkbox" id="tkBrand"'+(o.tiktok.brand?" checked":"")+'> This promotes my own brand or business</label>'+
            '<label class="check"><input type="checkbox" id="tkOk"'+(o.tiktok.consent?" checked":"")+'> By posting, I agree to TikTok’s <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener">Music Usage Confirmation</a>'+(o.tiktok.brand?' and <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener">Branded Content Policy</a>':'')+'.</label></fieldset>';
        }
        $("#spExtras").innerHTML=h;
        var setO=function(){ save({options:p.options}) };
        if($("#pinBoard")){
          var acc=acctFor("pinterest");
          api("GET","social/accounts/"+acc._id+"/boards").then(function(d){ var s=$("#pinBoard"); if(!s) return; s.innerHTML='<option value="">Pick a board</option>'+d.boards.map(function(b){ return '<option value="'+esc(b.id)+'"'+(p.options.pinterest.boardId===b.id?" selected":"")+'>'+esc(b.name)+'</option>' }).join("") }).catch(function(e){ var s=$("#pinBoard"); if(s) s.innerHTML='<option value="">Couldn’t load boards</option>'; toast(e.message,true) });
          $("#pinBoard").onchange=function(){ p.options.pinterest.boardId=this.value; setO(); save.now() };
          $("#pinTitle").oninput=function(){ p.options.pinterest.title=this.value; setO() };
          $("#pinLink").oninput=function(){ p.options.pinterest.link=this.value.trim(); setO() };
        }
        if($("#tkPriv")){
          var ta=acctFor("tiktok"), labels={PUBLIC_TO_EVERYONE:"Everyone",MUTUAL_FOLLOW_FRIENDS:"Friends (people who follow each other)",FOLLOWER_OF_CREATOR:"Followers",SELF_ONLY:"Only me"};
          var mt=p.media.some(function(m){return m.type==="video"})?"video":p.media.length?"photo":"";
          api("GET","social/accounts/"+ta._id+"/tiktok"+(mt?"?media="+mt:"")).then(function(d){ var s=$("#tkPriv"); if(!s) return; s.innerHTML='<option value="">Choose</option>'+d.info.privacy.map(function(x){ return '<option value="'+esc(x)+'"'+(p.options.tiktok.privacy_level===x?" selected":"")+'>'+esc(labels[x]||d.info.labels[x]||x)+'</option>' }).join("");
            if(d.info.commentsOff){ var c=$("#tkCom"); c.checked=false; c.disabled=true }
            ["Duet","Stitch"].forEach(function(k){ var el=$("#tk"+k); if(el&&d.info[k.toLowerCase()+"Off"]){ el.checked=false; el.disabled=true; p.options.tiktok["allow_"+k.toLowerCase()]=false } });
            if(!d.info.canPostMore) toast("TikTok says this account has hit its posting limit for today. Try again tomorrow.",true);
          }).catch(function(e){ var s=$("#tkPriv"); if(s) s.innerHTML='<option value="">Couldn’t load TikTok’s options</option>'; toast(e.message,true) });
          $("#tkPriv").onchange=function(){ p.options.tiktok.privacy_level=this.value; setO(); save.now() };
          $("#tkCom").onchange=function(){ p.options.tiktok.allow_comment=this.checked; setO(); save.now() };
          if($("#tkDuet")) $("#tkDuet").onchange=function(){ p.options.tiktok.allow_duet=this.checked; setO(); save.now() };
          if($("#tkStitch")) $("#tkStitch").onchange=function(){ p.options.tiktok.allow_stitch=this.checked; setO(); save.now() };
          $("#tkBrand").onchange=function(){ p.options.tiktok.brand=this.checked; setO(); save.now(); extras() };
          $("#tkOk").onchange=function(){ p.options.tiktok.consent=this.checked; setO(); save.now() };
        }
      }
      $$("[data-pick]").forEach(function(b){ b.onclick=function(){
        var pl=b.dataset.pick, on=b.getAttribute("aria-pressed")!=="true"; b.setAttribute("aria-pressed",String(on));
        p.targets = on ? p.targets.concat([{platform:pl, accountId:acctFor(pl)._id}]) : p.targets.filter(function(t){return t.platform!==pl});
        save({targets:p.targets}); save.now(); counts(); caps(); extras(); renderPreview();
      } });
      var lib=$("#spLib"); if(lib) lib.onclick=function(){ pickFromLibrary({multiple:true, folder:brand.name}).then(function(fs){ fs.forEach(function(nf){ if(nf.kind!=="image"&&nf.kind!=="video") return; p.media.push({url:nf.url, type:nf.kind==="video"?"video":(nf.type==="image/gif"?"gif":"image"), name:nf.name}) }); if(fs.length){ mediaList(); save({media:p.media}); save.now(); extras(); renderPreview() } }) };
      $("#spTweak").onclick=function(){ showCaps=!showCaps; caps() };
      $("#spTrack").onchange=function(){ p.options.track=this.checked; save({options:p.options}); save.now() };
      $("#spText").oninput=function(){ p.content=this.value; save({content:this.value}); counts(); renderPreview() };
      $("#spFile").onchange=function(){
        var files=Array.prototype.slice.call(this.files); this.value="";
        files.reduce(function(chain,f){ return chain.then(function(){
          if(!S.me.files && f.size>100*1024*1024){ toast(f.name+" is over 100 MB. Make it smaller first.",true); return }
          toast("Uploading "+f.name+"…");
          var up = S.me.files
            ? uploadToLibrary(f, brand.name).then(function(nf){ return {url:nf.url, type:nf.kind==="video"?"video":(nf.type==="image/gif"?"gif":"image"), name:nf.name} })
            : fetch("/api/social/media",{method:"POST",headers:{"content-type":f.type||"application/octet-stream","x-filename":encodeURIComponent(f.name)},body:f})
              .then(function(res){ return res.json().then(function(d){ if(!res.ok) throw new Error(d.error||"Upload failed"); return d.media }) });
          return up.then(function(m){ p.media.push(m); mediaList(); save({media:p.media}); save.now(); extras(); renderPreview(); toast(f.name+" added") })
            .catch(function(e){ toast(e.message,true) });
        }) }, Promise.resolve());
      };
      var confirmBox=function(text, label, fn){
        $("#spSend").innerHTML='<div class="confirm"><span>'+text+'</span><button class="btn sm primary" type="button" id="cfYes">'+label+'</button><button class="btn sm ghost" type="button" id="cfNo">Not yet</button></div>';
        $("#cfNo").onclick=function(){ $("#spSend").innerHTML="" };
        $("#cfYes").onclick=function(){ this.disabled=true; fn() };
      };
      $("#spNow").onclick=function(){ save.now(); confirmBox("Post to "+esc(where())+" now?", "Post it", function(){
        setTimeout(function(){ api("POST","social/posts/"+pid+"/publish",{}).then(function(){ toast("Posting"); route() }).catch(function(e){ toast(e.message,true); $("#spSend").innerHTML="" }) },400) }) };
      $("#spQueue").onclick=function(){ save.now(); confirmBox("Queue for "+esc(where())+" on "+esc(fmtDate(nextAt,true))+"?", "Queue it", function(){
        setTimeout(function(){ api("POST","social/posts/"+pid+"/queue",{}).then(function(r){ toast("Queued for "+fmtDate(r.post.scheduled_at,true)); route() }).catch(function(e){ toast(e.message,true); $("#spSend").innerHTML="" }) },400) }) };
      $("#spSched").onclick=function(){ save.now(); var val=$("#spAt").value; if(!val){ toast("Pick a date and time first.",true); return }
        var at=new Date(val).getTime(); confirmBox("Post to "+esc(where())+" on "+esc(fmtDate(at,true))+"?", "Schedule", function(){
        setTimeout(function(){ api("POST","social/posts/"+pid+"/publish",{at:at}).then(function(){ toast("Scheduled"); route() }).catch(function(e){ toast(e.message,true); $("#spSend").innerHTML="" }) },400) }) };
      mediaList(); counts(); caps(); extras(); showProblems(); renderPreview(); common();

      function common(){}
      function renderPreview(){
        var host=$("#spPrev"); if(!host) return;
        var text=(editable?(showCaps&&capTab&&p.options.captions[capTab])||$("#spText").value:p.content)||"";
        var m=p.media, grid = m.length ? '<div class="pgrid n'+Math.min(m.length,4)+'">'+m.slice(0,4).map(function(x){ return x.type==="video"?'<video src="'+esc(x.url)+'" muted playsinline controls preload="metadata"></video>':'<img src="'+esc(x.url)+'" alt="">' }).join("")+'</div>' : '';
        host.innerHTML='<div class="pcard"><div class="phead"><span class="pav">'+esc((brand.name||"?").slice(0,1))+'</span><span><b>'+esc(brand.name)+'</b><small>'+esc(where()||"Pick where it goes")+'</small></span></div>'+
          (text?'<p class="ptext">'+esc(text)+'</p>':'')+grid+(m.length>4?'<p class="hint" style="margin:8px 14px">+'+(m.length-4)+' more</p>':'')+'</div>';
      }
    }).then(function(){
      $("#spDup").onclick=function(){ api("POST","social/posts/"+pid+"/duplicate").then(function(r){ toast("Copy made"); go("#/social/p/"+r.post.id) }).catch(function(e){ toast(e.message,true) }) };
      $("#spDel").onclick=function(){
        $("#spConfirm").innerHTML='<div class="confirm"><span>Delete this post from Studio?'+(p.status==="published"||p.status==="partial"?' It stays up on the platforms; delete it there if you want it gone.':p.status==="scheduled"?' It won’t go out.':'')+'</span><button class="btn sm danger" type="button" id="sdY">Delete</button><button class="btn sm ghost" type="button" id="sdN">Keep it</button></div>';
        $("#sdN").onclick=function(){ $("#spConfirm").innerHTML="" };
        $("#sdY").onclick=function(){ api("DELETE","social/posts/"+pid).then(function(){ toast("Deleted"); go("#/social/b/"+p.profile_id) }).catch(function(e){ toast(e.message,true) }) };
      };
    });
  });
}

/* ============ campaigns ============ */
var PHASE={planning:"Planning", live:"Live", done:"Finished", archived:"Archived"};
function phaseChip(p){ var cls=p==="live"?"live":p==="planning"?"scheduled":p==="done"?"sent":"off"; return '<span class="chip '+cls+'">'+esc(PHASE[p]||p)+'</span>' }
function dateRange(a,b){ if(!a&&!b) return "No dates yet"; var f=function(ms){ return new Date(ms).toLocaleDateString(undefined,{day:"numeric",month:"short",year:new Date(ms).getFullYear()!==new Date().getFullYear()?"numeric":undefined}) }; return a&&b ? f(a)+" – "+f(b) : a ? "From "+f(a) : "Until "+f(b) }
function dayInput(ms){ return ms ? new Date(ms).toISOString().slice(0,10) : "" }

/* Small "Campaign" picker used in the email, post and form editors. */
function campaignPicker(host, kind, itemId, current){
  if(!host) return;
  api("GET","initiatives").then(function(d){
    var list=d.campaigns;
    if(current && !list.some(function(c){return c.id===current})) list=list.concat([{id:current, name:"(archived campaign)"}]);
    if(!list.length && !current){ host.innerHTML='<p class="camppick hint">Part of a launch? <a href="#/campaigns">Make a campaign</a> to see everything for it in one place.</p>'; return }
    host.innerHTML='<div class="camppick"><label for="cmpSel">Campaign</label><select id="cmpSel" style="width:auto;min-width:200px"><option value="">None</option>'+list.map(function(c){ return '<option value="'+esc(c.id)+'"'+(c.id===current?" selected":"")+'>'+esc(c.name)+'</option>' }).join("")+'</select><a id="cmpOpen" class="btn sm ghost" href="#/campaigns/'+esc(current||"")+'"'+(current?"":" hidden")+'>Open campaign</a></div>';
    $("#cmpSel",host).onchange=function(){ var val=this.value||null;
      api("POST","initiatives/assign",{kind:kind, id:itemId, initiative_id:val}).then(function(){ current=val; var o=$("#cmpOpen",host); o.hidden=!val; if(val) o.href="#/campaigns/"+val; toast(val?"Added to "+list.filter(function(c){return c.id===val})[0].name:"Taken out of the campaign") }).catch(function(e){ toast(e.message,true) }) };
  }).catch(function(){ host.innerHTML="" });
}

function campaignsView(){
  return api("GET","initiatives?all=1").then(function(d){
    var v=$("#view"), list=d.campaigns;
    var html=head("Marketing","Campaigns","A launch or a push: its emails, posts, forms and pages together, and what they added up to.",'<button class="btn primary" type="button" id="newCamp">New campaign</button>');
    html+='<div id="ncHost"></div>';
    if(!list.length) html+='<div class="empty"><b>No campaigns yet</b>Make one for your next launch, like “Cipherly autumn”, then add the emails and posts for it. Studio adds up the clicks and sign-ups.</div>';
    var groups=[["Live",function(c){return c.phase==="live"}],["Planning",function(c){return c.phase==="planning"}],["Finished",function(c){return c.phase==="done"}],["Archived",function(c){return c.phase==="archived"}]];
    groups.forEach(function(g){ var l=list.filter(g[1]); if(!l.length) return;
      html+='<section class="panel"><h2 class="sec">'+g[0]+' <span class="hint">'+l.length+'</span></h2><div class="rows">'+l.map(function(c){
        var bits=[c.emails?c.emails+" email"+(c.emails===1?"":"s"):"", c.posts?c.posts+" post"+(c.posts===1?"":"s"):"", c.forms?c.forms+" form"+(c.forms===1?"":"s"):"", c.pages?c.pages+" page"+(c.pages===1?"":"s"):""].filter(Boolean).join(" · ")||"Nothing in it yet";
        return '<a class="rowi nosq" href="#/campaigns/'+esc(c.id)+'"><span class="t">'+esc(c.name)+'<small>'+esc(dateRange(c.starts_at,c.ends_at))+' · '+esc(bits)+'</small></span><span class="meta">'+(c.clicks?'<span class="num">'+c.clicks+' click'+(c.clicks===1?"":"s")+'</span>':'')+phaseChip(c.phase)+'</span></a>' }).join("")+'</div></section>' });
    v.innerHTML=html;
    $("#newCamp").onclick=function(){
      $("#ncHost").innerHTML='<form class="sheet" id="ncForm"><h3>New campaign</h3><div class="field"><label for="ncName">Name</label><input type="text" id="ncName" required maxlength="80" placeholder="e.g. Cipherly autumn"></div>'+
        '<div class="fieldrow"><div class="field"><label for="ncStart">Starts</label><input type="date" id="ncStart"></div><div class="field"><label for="ncEnd">Ends</label><input type="date" id="ncEnd"></div><div class="field"><label for="ncTarget">Sign-ups to aim for</label><input type="number" id="ncTarget" min="0" placeholder="optional"></div></div>'+
        '<div class="field"><label for="ncGoal">Goal</label><input type="text" id="ncGoal" maxlength="500" placeholder="e.g. 200 new players before Halloween"></div>'+
        '<div class="actions"><button class="btn primary" type="submit">Create campaign</button><button class="btn ghost" type="button" id="ncCancel">Cancel</button></div></form>';
      $("#ncName").focus(); $("#ncCancel").onclick=function(){ $("#ncHost").innerHTML="" };
      $("#ncForm").onsubmit=function(e){ e.preventDefault(); var b=this.querySelector("[type=submit]"); b.disabled=true;
        api("POST","initiatives",{name:$("#ncName").value, starts_at:$("#ncStart").value||null, ends_at:$("#ncEnd").value||null, target:$("#ncTarget").value||null, goal:$("#ncGoal").value})
          .then(function(r){ go("#/campaigns/"+r.campaign.id) }).catch(function(err){ b.disabled=false; toast(err.message,true) }) };
    };
  });
}

function campChart(series, startMs, endMs){
  var W=560,H=170,pad=24,n=series.length, bw=(W-pad)/Math.max(1,n);
  var max=Math.max(4, Math.max.apply(null, series.map(function(d){ return Math.max(d.clicks,d.signups) })));
  var step=max<=4?1:max<=10?2:Math.ceil(max/4), top=Math.ceil(max/step)*step, y=function(v){ return 10+(H-36)*(1-v/top) };
  var s='<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Clicks and sign-ups per day">';
  for(var g=0; g<=top; g+=step) s+='<line class="grid" x1="'+pad+'" x2="'+W+'" y1="'+y(g)+'" y2="'+y(g)+'"/><text x="'+(pad-6)+'" y="'+(y(g)+3)+'" text-anchor="end">'+g+'</text>';
  var idx=function(ms){ if(!ms) return -1; var k=new Date(ms).toISOString().slice(0,10); for(var i=0;i<n;i++) if(series[i].day===k) return i; return -1 };
  var a=idx(startMs), b=idx(endMs);
  if(a>-1||b>-1){ var x0=pad+(a>-1?a:0)*bw, x1=pad+((b>-1?b:n-1)+1)*bw; s+='<rect class="window" x="'+x0+'" y="10" width="'+Math.max(1,x1-x0)+'" height="'+(y(0)-10)+'"><title>Campaign dates</title></rect>' }
  series.forEach(function(d,i){ var x=pad+i*bw;
    if(d.clicks) s+='<rect class="bar" x="'+(x+1)+'" y="'+y(d.clicks)+'" width="'+Math.max(1.5,bw-2)+'" height="'+(y(0)-y(d.clicks))+'"><title>'+d.day+': '+d.clicks+' click'+(d.clicks===1?"":"s")+'</title></rect>';
    if(d.signups) s+='<rect class="sig" x="'+(x+bw/2-3)+'" y="'+(y(d.signups)-3)+'" width="6" height="6"><title>'+d.day+': '+d.signups+' sign-up'+(d.signups===1?"":"s")+'</title></rect>';
  });
  s+='<line class="axis" x1="'+pad+'" x2="'+W+'" y1="'+y(0)+'" y2="'+y(0)+'"/>';
  var lab=function(k){ return new Date(k+"T12:00:00Z").toLocaleDateString(undefined,{day:"numeric",month:"short"}) };
  if(n) s+='<text x="'+pad+'" y="'+(H-8)+'">'+lab(series[0].day)+'</text><text x="'+W+'" y="'+(H-8)+'" text-anchor="end">'+lab(series[n-1].day)+'</text>';
  return s+'</svg><p class="clegend"><span class="lg bar"></span>Link clicks <span class="lg sig"></span>Sign-ups <span class="lg window"></span>Campaign dates</p>';
}

function campaignView(iid){
  return api("GET","initiatives/"+iid).then(function(d){
    var v=$("#view"), c=d.campaign, r=d.results;
    var html='<div class="pagehead"><div><span class="eyebrow"><a href="#/campaigns" style="color:inherit;text-decoration:none">Campaigns</a></span><h1 id="icTitle">'+esc(c.name)+'</h1><p class="sub">'+phaseChip(c.phase)+' '+esc(dateRange(c.starts_at,c.ends_at))+(c.goal?' · '+esc(c.goal):'')+'</p></div>'+
      '<div class="actions"><button class="btn" type="button" id="icNewEmail">New email</button><button class="btn" type="button" id="icNewPost">New post</button></div></div><div id="icBrand"></div>';
    var tgt=r.target? Math.min(100,Math.round(100*r.signups/r.target)) : null;
    html+='<section class="figures" aria-label="Results">'+
      '<div class="fig"><span>Sign-ups</span><b>'+r.signups+(r.target?'<em class="of"> / '+r.target+'</em>':'')+'</b>'+(tgt!==null?'<i class="meter" aria-hidden="true"><i style="width:'+tgt+'%"></i></i>':'')+'<small>'+(r.target?tgt+'% of the goal':'from its posts, forms and pages')+'</small></div>'+
      '<div class="fig"><span>Clicks</span><b>'+r.clicks.toLocaleString()+'</b><small>'+r.social_clicks+' from posts · '+r.email_clicks+' from emails</small></div>'+
      '<div class="fig"><span>Emails</span><b>'+r.emails_sent.toLocaleString()+'</b><small>'+(r.emails_sent?'sent · '+r.open_rate+'% opened':'none sent yet')+'</small></div>'+
      '<div class="fig"><span>Social</span><b>'+r.engagement.toLocaleString()+'</b><small>'+(r.posts_out?'interactions on '+r.posts_out+' post'+(r.posts_out===1?"":"s")+(r.reach?' · '+r.reach.toLocaleString()+' seen':''):'no posts out yet')+'</small></div></section>';
    html+='<div class="grid2"><div class="stack">'+
      '<section class="panel"><h2 class="sec">Day by day</h2><div class="pad">'+campChart(d.series, c.starts_at, c.ends_at)+'</div></section>'+
      '<section class="panel"><h2 class="sec">Emails and posts <span class="hint">in date order</span></h2>'+(d.timeline.length?'<div class="rows">'+d.timeline.map(function(x){
        var when=x.at?fmtDate(x.at,true):"No date yet", st=x.state==="planned"?"draft":x.state;
        return '<div class="rowi nosq tl"><span class="t"><a href="'+esc(x.href)+'">'+esc(x.title||"Untitled")+'</a><small>'+(x.type==="email"?"Email":"Post"+(x.sub?" · "+esc(x.sub):""))+' · '+esc(when)+(x.state==="planned"?" (planned)":"")+'</small></span><span class="meta"><span class="chip '+esc(st)+'">'+esc(x.type==="post"?(SOCIAL_STATUS[st]||st):st)+'</span><button type="button" class="btn sm ghost" data-out="'+x.type+'|'+esc(x.id)+'" aria-label="Take out of the campaign">Remove</button></span></div>' }).join("")+'</div>'
        : '<div class="empty">No emails or posts yet. Start one with the buttons above, or add ones you’ve already made below.</div>')+'</section>'+
      (d.emails.some(function(e){return e.sent})?'<section class="panel"><h2 class="sec">Email results</h2><div class="tablewrap"><table><thead><tr><th>Email</th><th class="r">Sent</th><th class="r">Opened</th><th class="r">Clicked</th></tr></thead><tbody>'+d.emails.filter(function(e){return e.sent}).map(function(e){ return '<tr><td><a href="#/emails/'+esc(e.id)+'">'+esc(e.subject||e.name)+'</a></td><td class="r mono">'+e.sent+'</td><td class="r mono">'+pct(e.opened,e.sent)+'</td><td class="r mono">'+pct(e.clicked,e.sent)+'</td></tr>' }).join("")+'</tbody></table></div></section>':'')+
      (d.posts.some(function(p){return p.when==="posted"})?'<section class="panel"><h2 class="sec">Post results</h2><div class="tablewrap"><table><thead><tr><th>Post</th><th class="r">Seen</th><th class="r">Interactions</th><th class="r">Clicks</th></tr></thead><tbody>'+d.posts.filter(function(p){return p.when==="posted"}).sort(function(a,b){return b.engagement-a.engagement}).map(function(p){ return '<tr><td><a href="#/social/p/'+esc(p.id)+'">'+esc(p.title)+'</a><span class="sub">'+esc(p.platforms.join(", "))+'</span></td><td class="r mono">'+(p.reach?p.reach.toLocaleString():"—")+'</td><td class="r mono">'+p.engagement+'</td><td class="r mono">'+p.clicks+'</td></tr>' }).join("")+'</tbody></table></div></section>':'')+
      '</div><div class="stack">'+
      '<section class="panel"><h2 class="sec">Details <span class="saving" id="icSave">Saved</span></h2><div class="pad stack" style="gap:14px">'+
        '<div class="field"><label for="icName">Name</label><input type="text" id="icName" maxlength="80" value="'+esc(c.name)+'"></div>'+
        '<div class="fieldrow"><div class="field"><label for="icStart">Starts</label><input type="date" id="icStart" value="'+dayInput(c.starts_at)+'"></div><div class="field"><label for="icEnd">Ends</label><input type="date" id="icEnd" value="'+dayInput(c.ends_at)+'"></div></div>'+
        '<div class="fieldrow"><div class="field"><label for="icGoal">Goal</label><input type="text" id="icGoal" maxlength="500" value="'+esc(c.goal)+'"></div><div class="field"><label for="icTarget">Sign-ups to aim for</label><input type="number" id="icTarget" min="0" value="'+(c.target||"")+'"></div></div>'+
        '<div class="field"><label for="icNotes">Notes</label><textarea id="icNotes" style="min-height:110px" placeholder="Key messages, the offer, links, anything Claude should know when drafting for it.">'+esc(c.notes)+'</textarea></div>'+
        '<p class="hint" style="margin:0">Links in its emails and posts are tagged <span class="mono">utm_campaign='+esc(c.tag)+'</span>.</p></div></section>'+
      '<section class="panel"><h2 class="sec">Forms and pages</h2>'+
        ((d.forms.length||d.pages.length)?'<div class="rows">'+
          d.forms.map(function(f){ return '<div class="rowi nosq tl"><span class="t"><a href="#/forms/'+esc(f.id)+'">'+esc(f.name)+'</a><small>Form · '+f.submissions+' sign-up'+(f.submissions===1?"":"s")+'</small></span><span class="meta"><button type="button" class="btn sm ghost" data-out="form|'+esc(f.id)+'">Remove</button></span></div>' }).join("")+
          d.pages.map(function(p){ return '<div class="rowi nosq tl"><span class="t"><a href="#/sites/'+esc(p.site_id)+'/pages/'+esc(p.id)+'">'+esc(p.site_name)+' / '+esc(p.slug||"home")+'</a><small>Page · '+p.views+' view'+(p.views===1?"":"s")+(p.published?"":" · not published")+'</small></span><span class="meta"><button type="button" class="btn sm ghost" data-out="page|'+esc(p.id)+'">Remove</button></span></div>' }).join("")+'</div>'
          : '<div class="empty">Add the sign-up form or landing page for this campaign, and its sign-ups count here.</div>')+'</section>'+
      '<section class="panel"><h2 class="sec">Add something you’ve already made</h2><div class="pad stack" style="gap:10px"><div class="fieldrow"><div class="field"><label for="icKind">What</label><select id="icKind"><option value="email">Email</option><option value="post">Social post</option><option value="form">Form</option><option value="page">Page</option></select></div><div class="field"><label for="icItem">Which</label><select id="icItem"><option value="">Loading…</option></select></div></div><div class="actions"><button class="btn sm" type="button" id="icAdd">Add to campaign</button></div></div></section>'+
      '<div class="actions"><button class="btn" type="button" id="icArchive">'+(c.archived?"Unarchive":"Archive")+'</button><button class="btn danger" type="button" id="icDel">Delete campaign</button></div><div id="icConfirm"></div>'+
      '</div></div>';
    v.innerHTML=html;
    var save=saver($("#icSave"), function(x){ return api("PATCH","initiatives/"+iid,x).then(function(res){ $("#icTitle").textContent=res.campaign.name }) });
    $("#icName").oninput=function(){ save({name:this.value}) };
    $("#icGoal").oninput=function(){ save({goal:this.value}) };
    $("#icTarget").oninput=function(){ save({target:this.value||null}) };
    $("#icNotes").oninput=function(){ save({notes:this.value}) };
    $("#icStart").onchange=function(){ save({starts_at:this.value||null}); save.now() };
    $("#icEnd").onchange=function(){ save({ends_at:this.value||null}); save.now() };
    $$("[data-out]").forEach(function(b){ b.onclick=function(){ var p=b.dataset.out.split("|"); b.disabled=true;
      api("POST","initiatives/assign",{kind:p[0], id:p[1], initiative_id:null}).then(function(){ toast("Taken out of the campaign"); route() }).catch(function(e){ b.disabled=false; toast(e.message,true) }) } });
    var opts=null;
    function fillItems(){ var k=$("#icKind").value, s=$("#icItem"); if(!opts){ s.innerHTML='<option value="">Loading…</option>'; return }
      var l=opts[k].filter(function(x){ return x.initiative_id!==iid });
      s.innerHTML=l.length? l.map(function(x){ return '<option value="'+esc(x.id)+'">'+esc(x.title||"Untitled")+(x.initiative_id?" (in another campaign)":"")+'</option>' }).join("") : '<option value="">Nothing to add</option>' }
    api("GET","initiatives/options").then(function(o){ opts=o; fillItems() }).catch(function(){});
    $("#icKind").onchange=fillItems;
    $("#icAdd").onclick=function(){ var id=$("#icItem").value, k=$("#icKind").value; if(!id) return; this.disabled=true;
      api("POST","initiatives/assign",{kind:k, id:id, initiative_id:iid}).then(function(){ toast("Added"); route() }).catch(function(e){ $("#icAdd").disabled=false; toast(e.message,true) }) };
    $("#icNewEmail").onclick=function(){ this.disabled=true; api("POST","campaigns",{name:c.name, initiative_id:iid}).then(function(x){ go("#/emails/"+x.campaign.id) }).catch(function(e){ toast(e.message,true) }) };
    $("#icNewPost").onclick=function(){ var btn=this;
      loadSocialMeta().then(function(meta){ if(!meta.connected){ toast("Connect social posting in Settings first.",true); return }
        return api("GET","social/brands").then(function(bd){
          var start=function(brand){ btn.disabled=true; return api("GET","social/brands/"+brand._id+"/accounts").then(function(a){ return api("POST","social/posts",{profile_id:brand._id, initiative_id:iid, targets:a.accounts.map(function(x){ return {platform:x.platform, accountId:x._id} })}) }).then(function(x){ go("#/social/p/"+x.post.id) }) };
          if(bd.brands.length===1) return start(bd.brands[0]);
          if(!bd.brands.length){ toast("Add a brand on the Social page first.",true); return }
          $("#icBrand").innerHTML='<div class="confirm"><span>Which brand is it for?</span>'+bd.brands.map(function(b){ return '<button class="btn sm" type="button" data-br="'+esc(b._id)+'">'+esc(b.name)+'</button>' }).join("")+'<button class="btn sm ghost" type="button" id="brNo">Cancel</button></div>';
          $("#brNo").onclick=function(){ $("#icBrand").innerHTML="" };
          $$("[data-br]").forEach(function(x){ x.onclick=function(){ start(bd.brands.filter(function(b){return b._id===x.dataset.br})[0]) } });
        }) }).catch(function(e){ btn.disabled=false; toast(e.message,true) }) };
    $("#icArchive").onclick=function(){ api("PATCH","initiatives/"+iid,{archived:!c.archived}).then(function(){ toast(c.archived?"Unarchived":"Archived"); route() }).catch(function(e){ toast(e.message,true) }) };
    $("#icDel").onclick=function(){
      $("#icConfirm").innerHTML='<div class="confirm"><span>Delete this campaign? Its emails, posts, forms and pages stay; they just stop being grouped.</span><button class="btn sm danger" type="button" id="icDY">Delete</button><button class="btn sm ghost" type="button" id="icDN">Keep it</button></div>';
      $("#icDN").onclick=function(){ $("#icConfirm").innerHTML="" };
      $("#icDY").onclick=function(){ api("DELETE","initiatives/"+iid).then(function(){ toast("Campaign deleted"); go("#/campaigns") }).catch(function(e){ toast(e.message,true) }) };
    };
  });
}

/* ============ review (drafts Claude made) ============ */
function localInput(ms){ if(!ms) return ""; var d=new Date(ms-new Date(ms).getTimezoneOffset()*60000); return d.toISOString().slice(0,16) }
function reviewView(){
  return loadSocialMeta().then(function(){ return api("GET","review") }).then(function(d){
    var v=$("#view"), posts=d.posts, byBatch={};
    posts.forEach(function(p){ var k=p.batch_id||"_"; (byBatch[k]=byBatch[k]||[]).push(p) });
    var ready=posts.filter(function(p){ return !p.problems.length });
    var html=head("Marketing","Review","Posts Claude drafted for you. Nothing goes out until you approve it.",
      ready.length?'<button class="btn primary" type="button" id="rvAll">'+allLabel()+'</button>':'');
    function allLabel(){ return ready.length===1?"Approve the 1 ready post":"Approve all "+ready.length+" ready" }
    html+='<div id="rvConfirm"></div>';
    if(!posts.length){
      var open=d.batches.filter(function(b){return b.status==="open"});
      html+='<div class="empty"><b>'+(open.length?"Claude is still drafting":"Nothing to review")+'</b>'+(open.length?esc(open[0].brand||"")+' drafts will appear here when they’re done.':'When Claude drafts posts for you, they land here. Turn on the weekly producer in a brand’s brief on the <a href="#/social">Social</a> page.')+'</div>';
      v.innerHTML=html; return;
    }
    var groups=d.batches.filter(function(b){ return byBatch[b.id] }).map(function(b){ return {b:b, list:byBatch[b.id]} });
    if(byBatch._) groups.push({b:{title:"Other drafts from Claude", brand:""}, list:byBatch._});
    groups.forEach(function(g){
      html+='<section class="panel"><h2 class="sec">'+esc(g.b.title)+(g.b.brand?' <span class="hint">'+esc(g.b.brand)+' · '+g.list.length+' draft'+(g.list.length===1?"":"s")+(g.b.status==="open"?' · Claude is still adding to this':'')+'</span>':'')+'</h2>'+
        (g.b.summary?'<p class="rvsum">'+esc(g.b.summary)+'</p>':'')+'<div class="rvlist">'+g.list.map(card).join("")+'</div></section>';
    });
    v.innerHTML=html;
    function card(p){
      var plats=p.targets.map(function(t){return platName(t.platform)}).join(", ")||"No accounts picked";
      var m=p.media.slice(0,4).map(function(x){ return x.type==="video"?'<video src="'+esc(x.url)+'" muted playsinline preload="metadata"></video>':'<img src="'+esc(x.url)+'" alt="" loading="lazy">' }).join("");
      var bad=p.problems.length;
      return '<article class="rv" id="rv-'+esc(p.id)+'">'+
        '<div class="rvmeta"><span class="eyebrow">'+esc(plats)+'</span>'+
          '<label class="sr" for="rt-'+esc(p.id)+'">Planned time</label><input type="datetime-local" id="rt-'+esc(p.id)+'" data-when="'+esc(p.id)+'" value="'+esc(localInput(p.planned_at))+'" style="width:auto">'+
          (p.planned_at?'':'<span class="hint">No time yet: approving uses the next posting slot.</span>')+'</div>'+
        '<div class="rvbody">'+(m?'<div class="rvmedia">'+m+'</div>':'')+'<p class="ptext">'+esc(p.content||"")+'</p></div>'+
        (p.note?'<p class="rvnote"><b>Claude:</b> '+esc(p.note)+'</p>':'')+
        (bad?'<ul class="probs">'+p.problems.map(function(x){return '<li>'+esc(x)+'</li>'}).join("")+'</ul>':'')+
        '<div class="actions">'+(bad?'<a class="btn primary sm" href="#/social/p/'+esc(p.id)+'">Finish in the editor</a>':'<button class="btn primary sm" type="button" data-ok="'+esc(p.id)+'">Approve</button><a class="btn sm" href="#/social/p/'+esc(p.id)+'">Edit</a>')+
          '<button class="btn sm ghost" type="button" data-bin="'+esc(p.id)+'">Bin</button></div></article>';
    }
    function gone(id){ var el=$("#rv-"+id); if(el) el.remove(); ready=ready.filter(function(p){ return p.id!==id }); var a=$("#rvAll"); if(a){ if(ready.length) a.textContent=allLabel(); else a.remove() } refreshNav() }
    function approve(ids, btn){
      if(btn) btn.disabled=true;
      return api("POST","review/approve",{ids:ids}).then(function(r){
        r.done.forEach(function(x){ gone(x.id) });
        if(r.done.length) toast(r.done.length===1?"Scheduled for "+fmtDate(r.done[0].at,true):r.done.length+" posts scheduled");
        r.failed.forEach(function(x){ toast(x.error,true) });
        if(!$$(".rv").length) route();
      }).catch(function(e){ if(btn) btn.disabled=false; toast(e.message,true) });
    }
    $$("[data-ok]").forEach(function(b){ b.onclick=function(){ approve([b.dataset.ok], b) } });
    $$("[data-bin]").forEach(function(b){ b.onclick=function(){ b.disabled=true; api("POST","review/bin",{ids:[b.dataset.bin]}).then(function(){ gone(b.dataset.bin); toast("Binned"); if(!$$(".rv").length) route() }).catch(function(e){ b.disabled=false; toast(e.message,true) }) } });
    $$("[data-when]").forEach(function(i){ i.onchange=function(){ var ms=i.value?new Date(i.value).getTime():0;
      if(ms && ms<Date.now()+5*60000){ toast("Pick a time in the future.",true); return }
      api("PATCH","social/posts/"+i.dataset.when,{planned_at:ms}).then(function(){ toast(ms?"Planned for "+fmtDate(ms,true):"Time cleared") }).catch(function(e){ toast(e.message,true) }) } });
    var all=$("#rvAll"); if(all) all.onclick=function(){
      $("#rvConfirm").innerHTML='<div class="confirm"><span>Schedule all '+ready.length+' ready posts at their planned times? Drafts that still need something stay here.</span><button class="btn sm primary" type="button" id="raY">Approve all</button><button class="btn sm ghost" type="button" id="raN">Not yet</button></div>';
      $("#raN").onclick=function(){ $("#rvConfirm").innerHTML="" };
      $("#raY").onclick=function(){ this.disabled=true; approve(ready.map(function(p){return p.id})).then(function(){ $("#rvConfirm").innerHTML="" }) };
    };
  });
}

/* ============ brand brief (what Claude writes from) ============ */
function briefView(bid){
  return loadSocialMeta().then(function(){ return Promise.all([api("GET","social/brands"), api("GET","social/brands/"+bid+"/brief"), api("GET","social/brands/"+bid+"/accounts")]) }).then(function(r){
    var brand=r[0].brands.filter(function(b){return b._id===bid})[0]||{_id:bid,name:"Brand"}, b=r[1].brief, accounts=r[2].accounts;
    var v=$("#view"), pin=accounts.filter(function(a){return a.platform==="pinterest"})[0];
    var ta=function(id, label, hint, val, rows){ return '<div class="field"><label for="'+id+'">'+label+'</label>'+(hint?'<span class="hint">'+hint+'</span>':'')+'<textarea id="'+id+'" style="min-height:'+(rows||90)+'px">'+esc(val||"")+'</textarea></div>' };
    var html='<div class="pagehead"><div><span class="eyebrow"><a href="#/social/b/'+esc(bid)+'" style="color:inherit;text-decoration:none">Social · '+esc(brand.name)+'</a></span><h1>Brief</h1><p class="sub">What Claude reads before drafting '+esc(brand.name)+' posts. Plain words are fine.</p></div><div class="actions"><span class="saving" id="brSave">'+(b.updated_at?"Saved":"")+'</span></div></div>';
    html+='<div class="editor wide"><form class="form panel" id="brForm" autocomplete="off"><div class="pad stack" style="gap:16px">'+
      '<label class="check"><input type="checkbox" id="brOn"'+(b.producer_on?" checked":"")+'> <span><b>Draft next week’s posts every Monday</b><br><span class="hint">Claude drafts into the free posting slots and emails you. Nothing goes out until you approve it on the Review page.</span></span></label>'+
      ta("brVoice","Voice","How "+esc(brand.name)+" sounds. Calm? Cheeky? First person?",b.voice,110)+
      ta("brAud","Audience","Who it’s for, and what they care about.",b.audience)+
      ta("brPil","Themes","One per line. Claude rotates through them.",b.pillars.join("\n"))+
      '<div class="fieldrow">'+ta("brDo","Always","",b.dos)+ta("brDont","Never","e.g. no emoji, no “game-changer”, no made-up offers.",b.donts)+'</div>'+
      ta("brTags","Hashtags","",b.hashtags,60)+
      '<div class="field"><span class="label">Links posts can point to</span><div id="brLinks" class="stack" style="gap:8px"></div><div class="actions"><button class="btn sm" type="button" id="brAddLink">Add a link</button></div></div>'+
      ta("brEx","Example posts","Paste a few captions that sound right. Claude copies the feel, not the words.",b.examples,150)+
      '</div></form><div class="stack"><section class="panel"><h2 class="sec">Posts per week</h2><div class="pad stack" style="gap:10px">'+
        (accounts.length?accounts.map(function(a){ return '<div class="fieldrow" style="align-items:center"><label for="cd-'+esc(a.platform)+'">'+esc(platName(a.platform))+'</label><input type="number" min="0" max="21" id="cd-'+esc(a.platform)+'" data-cad="'+esc(a.platform)+'" value="'+(b.cadence[a.platform]||0)+'" style="width:90px"></div>' }).join(""):'<p class="hint" style="margin:0">Connect accounts on the <a href="#/social/b/'+esc(bid)+'">Social page</a> first.</p>')+
        '<p class="hint" style="margin:0">Claude only uses your posting times, so add enough of them for this.</p></div></section>'+
        (pin?'<section class="panel"><h2 class="sec">Pinterest</h2><div class="pad"><div class="field"><label for="brBoard">Board for new pins</label><select id="brBoard"><option value="">Loading…</option></select></div></div></section>':'')+
        '<section class="panel"><h2 class="sec">Ask Claude</h2><div class="pad stack" style="gap:8px"><p class="hint" style="margin:0">In Claude, with Studio connected, try:</p><p style="margin:0">“Read the '+esc(brand.name)+' brief in Studio and draft next week’s posts.”</p><p style="margin:0">“Look at my last 20 '+esc(brand.name)+' posts and fill in the brief.”</p></div></section></div></div>';
    v.innerHTML=html;
    var links=(b.links||[]).slice();
    var save=saver($("#brSave"), function(x){ return api("PUT","social/brands/"+bid+"/brief",x) });
    function drawLinks(){
      $("#brLinks").innerHTML=links.map(function(l,i){ return '<div class="fieldrow" style="grid-template-columns:1fr 2fr auto;align-items:center"><input type="text" data-ll="'+i+'" placeholder="Label, e.g. App Store" maxlength="80" value="'+esc(l.label)+'" aria-label="Link label"><input type="text" data-lu="'+i+'" placeholder="https://" maxlength="500" value="'+esc(l.url)+'" aria-label="Link"><button class="btn sm ghost" type="button" data-lrm="'+i+'">Remove</button></div>' }).join("");
      $$("[data-ll]").forEach(function(i){ i.oninput=function(){ links[i.dataset.ll].label=i.value; pushLinks() } });
      $$("[data-lu]").forEach(function(i){ i.oninput=function(){ links[i.dataset.lu].url=i.value.trim(); pushLinks() } });
      $$("[data-lrm]").forEach(function(x){ x.onclick=function(){ links.splice(Number(x.dataset.lrm),1); drawLinks(); pushLinks(); save.now() } });
    }
    function pushLinks(){ save({links:links.filter(function(l){ return /^https:\/\//.test(l.url) })}) }
    drawLinks();
    $("#brAddLink").onclick=function(){ links.push({label:"",url:""}); drawLinks(); var el=$('[data-ll="'+(links.length-1)+'"]'); if(el) el.focus() };
    [["brVoice","voice"],["brAud","audience"],["brDo","dos"],["brDont","donts"],["brTags","hashtags"],["brEx","examples"]].forEach(function(x){ $("#"+x[0]).oninput=function(){ var o={}; o[x[1]]=this.value; save(o) } });
    $("#brPil").oninput=function(){ save({pillars:this.value.split("\n").map(function(s){return s.trim()}).filter(Boolean)}) };
    $("#brOn").onchange=function(){ save({producer_on:this.checked}); save.now(); toast(this.checked?"Claude will draft "+brand.name+" posts every Monday":"Weekly drafts off") };
    $$("[data-cad]").forEach(function(i){ i.oninput=function(){ var c={}; $$("[data-cad]").forEach(function(j){ var n=Number(j.value)||0; if(n) c[j.dataset.cad]=n }); save({cadence:c}) } });
    if(pin){
      api("GET","social/accounts/"+pin._id+"/boards").then(function(d){ var s=$("#brBoard"); if(!s) return; s.innerHTML='<option value="">Ask each time</option>'+d.boards.map(function(x){ return '<option value="'+esc(x.id)+'"'+(b.pinterest_board===x.id?" selected":"")+'>'+esc(x.name)+'</option>' }).join("") }).catch(function(){ var s=$("#brBoard"); if(s) s.innerHTML='<option value="">Couldn’t load boards</option>' });
      $("#brBoard").onchange=function(){ save({pinterest_board:this.value}); save.now() };
    }
  });
}

/* ============ settings ============ */
function settingsView(){
  return Promise.all([api("GET","settings"), api("GET","settings/events"), api("GET","social/status"), api("GET","social/apps")]).then(function(r){
    var s=r[0].settings, ev=r[1], zr=r[2], apps=r[3].apps, v=$("#view"), dbl=s.double_optin==="1";
    var evName={"email.bounced":"Bounced","email.complained":"Marked as spam","email.failed":"Couldn’t send","email.suppressed":"On do-not-send list"};
    var hooks = ev.connected
      ? '<div class="pad stack" style="gap:10px"><p style="margin:0"><span class="chip sent">Connected</span> Studio stops emailing addresses that bounce or mark you as spam, and takes them out of automations.</p>'+
        '<p class="hint" style="margin:0">'+ev.bounced+' bounced · '+ev.complained+' marked as spam · '+(ev.lastEvent?'last update '+fmtDate(ev.lastEvent,true):'no updates from Resend yet (they arrive after your next send)')+'</p></div>'+
        (ev.recent.length ? '<div class="tablewrap"><table><tbody>'+ev.recent.map(function(e){ return '<tr><td>'+esc(e.email||"—")+'<span class="sub">'+esc(e.detail||"")+'</span></td><td>'+esc(evName[e.type]||e.type)+'</td><td class="r mono">'+fmtDate(e.created_at,true)+'</td></tr>' }).join("")+'</tbody></table></div>' : '')+
        '<div class="pad"><button class="btn sm ghost" type="button" id="whReplace">Replace the signing secret</button><div id="whManual" hidden></div></div>'
      : '<div class="pad stack" style="gap:12px"><p style="margin:0">Let Resend tell Studio when an email bounces or someone marks it as spam, so Studio stops emailing them. This protects your sending reputation.</p>'+
        '<div class="actions"><button class="btn primary" type="button" id="whAuto">Connect automatically</button></div><div id="whManual"></div></div>';
    v.innerHTML=head("Workspace","Settings","How your emails and signup forms introduce you.")+
      '<div class="grid2"><form class="form panel" id="setForm" autocomplete="off"><h2 class="sec">Sender <span class="saving" id="setSave">Saved</span></h2>'+
      '<div class="fieldrow"><div class="field"><label for="sName">From name</label><input type="text" id="sName" data-k="sender_name" maxlength="60" value="'+esc(s.sender_name)+'"><span class="hint">Emails styled as a site show “'+esc(s.sender_name)+' at Seek”.</span></div>'+
      '<div class="field"><label for="sEmail">From address</label><input type="email" id="sEmail" data-k="sender_email" maxlength="120" value="'+esc(s.sender_email)+'"><span class="hint">Must end in @'+esc(S.me.root)+'.</span></div></div>'+
      '<div class="field"><label for="sReply">Replies go to</label><input type="email" id="sReply" data-k="reply_to" maxlength="120" value="'+esc(s.reply_to)+'" placeholder="Same as the from address"></div>'+
      '<div class="field"><label for="sAddr">Postal address</label><input type="text" id="sAddr" data-k="postal_address" maxlength="200" value="'+esc(s.postal_address)+'"><span class="hint">Marketing email law (GDPR, CAN-SPAM) expects a way to reach you. It sits small in every email footer. A PO box or business address is fine.</span></div>'+
      '<div class="field"><label for="sTz">Your time zone</label><select id="sTz" data-k="timezone">'+(function(){ var zones=[]; try{ zones=Intl.supportedValuesOf("timeZone") }catch(e){ zones=["Europe/Madrid","Europe/Dublin","Europe/London","UTC"] } if(zones.indexOf(s.timezone)<0) zones.unshift(s.timezone); return zones.map(function(z){ return '<option'+(z===s.timezone?" selected":"")+'>'+esc(z)+'</option>' }).join("") })()+'</select><span class="hint">Posting times for social brands use this.</span></div>'+
      '<h2 class="sec">Signup forms</h2>'+
      '<div class="field"><label for="sConsent">Consent line</label><textarea id="sConsent" data-k="consent_text" maxlength="300">'+esc(s.consent_text)+'</textarea><span class="hint">People must tick this to sign up. Studio keeps the wording and the time they agreed, which is your GDPR record.</span></div>'+
      '<div class="actions"><button type="button" class="switch" role="switch" id="sDbl" aria-checked="'+dbl+'" aria-labelledby="sDblLbl"></button><span id="sDblLbl">Ask new sign-ups to confirm their email</span></div>'+
      '<p class="hint">When this is on, people get a “tap to confirm” email first. Welcome emails and automations start once they tap it. Fewer typos and fake addresses on your lists, at the cost of some people never confirming.</p>'+
      '</form><div class="stack"><section class="panel"><h2 class="sec">Social posting</h2>'+
        '<div class="pad"><p style="margin:0">Studio posts straight to each platform through its own developer app. Set one up per platform, then connect accounts on the <a href="#/social">Social</a> page.</p></div>'+
        '<div class="rows">'+apps.map(function(a){
          var on=a.configured, chip=a.kind==="password"?'<span class="chip sent">No setup needed</span>':on?'<span class="chip sent">Set up</span>':'<span class="chip draft">Not yet</span>';
          var sub=a.kind==="password"?"Connect with an app password":on?("App "+a.client_id+(a.options.sandbox?" · sandbox":"")):"Needs Studio’s own app";
          if(a.accounts) sub+=" · "+a.accounts+" account"+(a.accounts===1?"":"s")+(a.needsReconnect?" ("+a.needsReconnect+" to reconnect)":"");
          return '<div class="rowi" style="--pc:var(--'+(on?"moss":"brass")+')"><span class="t">'+esc(a.label)+'<small>'+esc(sub)+'</small></span><span class="meta">'+chip+(a.kind==="oauth"?'<button class="btn sm ghost" type="button" data-app="'+esc(a.platform)+'">'+(on?"Change":"Set up")+'</button>':'')+'</span></div>'+
            '<div id="app-'+esc(a.platform)+'" hidden></div>' }).join("")+'</div>'+
        '<h2 class="sec">Zernio <span class="hint">Optional. For platforms Studio doesn’t post to itself yet, like LinkedIn and X.</span></h2><div class="pad stack" style="gap:12px">'+
        (zr.zernio
          ? '<p style="margin:0"><span class="chip sent">Connected</span> Accounts connected through Zernio keep posting through it.</p><button class="btn sm ghost" type="button" id="zkReplace" style="align-self:flex-start">Replace the key</button><div id="zkHost" hidden></div>'
          : '<p class="hint" style="margin:0">Not connected. First 2 accounts free, then $6 a month each.</p><button class="btn sm ghost" type="button" id="zkReplace" style="align-self:flex-start">Add a Zernio key</button><div id="zkHost" hidden></div>')+
        '</div></section><section class="panel"><h2 class="sec">Connect Claude</h2><div class="pad stack" style="gap:12px">'+
        '<p style="margin:0">Let Claude draft posts and emails, add files and read your results. It can only save drafts: nothing goes out until you send it here.</p>'+
        '<ol class="steps"><li>In Claude, open <b>Settings → Connectors</b> and choose <b>Add custom connector</b>.</li>'+
        '<li>Name it <b>Studio</b> and paste this address:<div class="affix" style="margin-top:6px"><input type="text" id="mcpUrl" readonly value="https://studio.'+esc(S.me.root)+'/mcp"><button class="btn sm" type="button" id="mcpCopy" style="border:0;border-left:1px solid var(--line)">Copy</button></div></li>'+
        '<li>Click <b>Connect</b>, sign in here with your email link if asked, and press <b>Allow</b>.</li></ol></div></section>'+
        '<section class="panel"><h2 class="sec">Bounces and spam reports</h2>'+hooks+'</section>'+
      '<section class="panel"><h2 class="sec">Connections</h2><div class="rows">'+
      '<div class="rowi" style="--pc:var(--'+(S.me.emailConnected?"moss":"brass")+')"><span class="t">Email sending<small>Resend, from @'+esc(S.me.root)+'</small></span><span class="meta"><span class="chip '+(S.me.emailConnected?"sent":"draft")+'">'+(S.me.emailConnected?(S.me.dev?"Simulated":"Connected"):"Not yet")+'</span></span></div>'+
      '<div class="rowi" style="--pc:var(--'+(ev.connected?"moss":"brass")+')"><span class="t">Delivery updates<small>Bounces and spam reports from Resend</small></span><span class="meta"><span class="chip '+(ev.connected?"sent":"draft")+'">'+(ev.connected?"Connected":"Not yet")+'</span></span></div>'+
      '<div class="rowi" style="--pc:var(--moss)"><span class="t">Sign-in<small>'+esc(S.me.email)+'</small></span><span class="meta"><span class="chip sent">'+(S.me.dev?"Dev mode":"Email link")+'</span></span></div>'+
      '<div class="rowi" style="--pc:var(--moss)"><span class="t">Domain<small>*.'+esc(S.me.root)+'</small></span><span class="meta"><span class="chip sent">Every subdomain</span></span></div>'+
      '</div></section>'+(S.me.dev?'<p class="hint">This is the local test copy. Nothing is really emailed.</p>':'')+'</div></div>';
    var save=saver($("#setSave"), function(x){ return api("PUT","settings",x) });
    $$("[data-k]",v).forEach(function(i){ i.oninput=i.onchange=function(){ var o={}; o[i.dataset.k]=i.value; save(o) } });
    $("#sDbl").onclick=function(){ var on=this.getAttribute("aria-checked")!=="true"; this.setAttribute("aria-checked",String(on)); save({double_optin:on?"1":"0"}); save.now(); toast(on?"New sign-ups will be asked to confirm":"Sign-ups join straight away") };

    function manual(host, note){
      host.hidden=false;
      host.innerHTML=(note?'<div class="notice"><p>'+esc(note)+'</p></div>':'')+
        '<ol class="steps"><li>In Resend, open <b>Webhooks</b> and click <b>Add webhook</b>.</li>'+
        '<li>Paste this as the endpoint URL:<div class="affix" style="margin-top:6px"><input type="text" id="whUrl" readonly value="'+esc(ev.endpoint)+'"><button class="btn sm" type="button" id="whCopy" style="border:0;border-left:1px solid var(--line)">Copy</button></div>'+
        'Tick these events: <b>email.bounced</b>, <b>email.complained</b>, <b>email.delivered</b>, <b>email.failed</b> and <b>email.suppressed</b>. Then save it.</li>'+
        '<li>Open the new webhook, copy its <b>signing secret</b> (it starts with whsec_) and paste it here:'+
        '<div class="actions" style="margin-top:6px"><label class="sr" for="whSecret">Signing secret</label><input type="password" id="whSecret" autocomplete="off" spellcheck="false" placeholder="whsec_…" style="flex:1 1 220px;width:auto"><button class="btn primary" type="button" id="whSave">Save</button></div></li></ol>';
      $("#whCopy").onclick=function(){ var i=$("#whUrl"); i.select(); (navigator.clipboard?navigator.clipboard.writeText(i.value):Promise.reject()).then(function(){ toast("Copied") },function(){ document.execCommand("copy"); toast("Copied") }) };
      $("#whSave").onclick=function(){ var val=$("#whSecret").value.trim(); if(!val){ toast("Paste the signing secret first.",true); return }
        api("PUT","settings/webhook-secret",{secret:val}).then(function(){ toast("Connected"); route() }).catch(function(e){ toast(e.message,true) }) };
    }
    var auto=$("#whAuto");
    if(auto) auto.onclick=function(){ var b=this; b.disabled=true; b.textContent="Connecting…";
      api("POST","settings/connect-resend").then(function(){ toast("Connected"); route() })
        .catch(function(e){ b.disabled=false; b.textContent="Connect automatically"; manual($("#whManual"), e.message) }) };
    $("#mcpCopy").onclick=function(){ var i=$("#mcpUrl"); i.select(); (navigator.clipboard?navigator.clipboard.writeText(i.value):Promise.reject()).then(function(){ toast("Copied") },function(){ document.execCommand("copy"); toast("Copied") }) };
    var rp=$("#whReplace"); if(rp) rp.onclick=function(){ this.hidden=true; manual($("#whManual")) };
    function zkForm(host){
      host.hidden=false;
      host.innerHTML='<ol class="steps"><li>Sign up at <a href="https://zernio.com" target="_blank" rel="noopener">zernio.com</a> with '+esc(S.me.email)+'.</li><li>In Zernio, open <b>API keys</b> and create one called “Studio”.</li>'+
        '<li>Paste it here (it starts with sk_):<div class="actions" style="margin-top:6px"><label class="sr" for="zkKey">Zernio API key</label><input type="password" id="zkKey" autocomplete="off" spellcheck="false" placeholder="sk_…" style="flex:1 1 220px;width:auto"><button class="btn primary" type="button" id="zkSave">Save</button></div></li></ol>';
      $("#zkSave").onclick=function(){ var b=this, val=$("#zkKey").value.trim(); if(!val){ toast("Paste the key first.",true); return } b.disabled=true; b.textContent="Checking…";
        api("PUT","settings/zernio-key",{key:val}).then(function(){ S.social=null; toast("Social posting connected"); route() }).catch(function(e){ b.disabled=false; b.textContent="Save"; toast(e.message,true) }) };
    }
    var zk=$("#zkReplace"); if(zk) zk.onclick=function(){ this.hidden=true; zkForm($("#zkHost")) };
    $$("[data-app]").forEach(function(b){ b.onclick=function(){
      var a=apps.filter(function(x){ return x.platform===b.dataset.app })[0], host=$("#app-"+a.platform);
      if(!host.hidden){ host.hidden=true; host.innerHTML=""; return }
      host.hidden=false;
      host.innerHTML='<form class="sheet" style="margin:0 18px 16px" autocomplete="off"><p class="hint" style="margin:0">'+esc(a.note)+' <a href="'+esc(a.console)+'" target="_blank" rel="noopener">Open the developer console</a></p>'+
        '<div class="field"><label>Redirect URI <span class="hint">(paste this into the app’s settings)</span></label><div class="affix"><input type="text" readonly value="'+esc(a.redirect)+'" data-copyv><button class="btn sm" type="button" data-copy style="border:0;border-left:1px solid var(--line)">Copy</button></div></div>'+
        '<div class="fieldrow"><div class="field"><label for="ac-'+a.platform+'">App ID</label><input type="text" id="ac-'+a.platform+'" maxlength="200" spellcheck="false" value="'+esc(a.client_id)+'"></div>'+
        '<div class="field"><label for="as-'+a.platform+'">App secret</label><input type="password" id="as-'+a.platform+'" maxlength="300" spellcheck="false" placeholder="'+(a.configured?"Saved. Paste a new one to replace it":"")+'"></div></div>'+
        (a.platform==="pinterest"?'<label class="actions" style="gap:8px"><input type="checkbox" id="asb-'+a.platform+'"'+(a.options.sandbox?" checked":"")+'> Trial access: post to Pinterest’s sandbox</label>':'')+
        '<div class="actions"><button class="btn primary sm" type="submit">Save</button>'+(a.configured?'<button class="btn ghost sm" type="button" data-rm>Remove</button>':'')+'</div></form>';
      var f=host.querySelector("form");
      host.querySelector("[data-copy]").onclick=function(){ var i=host.querySelector("[data-copyv]"); i.select(); (navigator.clipboard?navigator.clipboard.writeText(i.value):Promise.reject()).then(function(){ toast("Copied") },function(){ document.execCommand("copy"); toast("Copied") }) };
      var sendApp=function(body, msg){ return api("PUT","social/apps/"+a.platform, body).then(function(){ toast(msg); route() }).catch(function(e){ toast(e.message,true) }) };
      f.onsubmit=function(e){ e.preventDefault(); var sb=$("#asb-"+a.platform);
        sendApp({client_id:$("#ac-"+a.platform).value.trim(), secret:$("#as-"+a.platform).value.trim(), options:{sandbox:!!(sb&&sb.checked)}}, a.label+" app saved") };
      var rm=host.querySelector("[data-rm]"); if(rm) rm.onclick=function(){ sendApp({client_id:""}, a.label+" app removed") };
    } });
  });
}

/* ============ start ============ */
api("GET","me").then(function(me){ S.me=me; loadSocialMeta().catch(function(){}); $("#rootDomain").textContent=me.root; $("#meEmail").textContent=me.dev?"local test copy":me.email; route(); refreshNav() })
  .catch(function(e){ $("#view").innerHTML='<div class="notice danger"><p>'+esc(e.message)+'</p></div>' });
})();
