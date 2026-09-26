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
var VERSION = "202609262230";

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
  var parts=(location.hash.replace(/^#\/?/,"")||"").split("/").filter(Boolean), top=parts[0]||"overview";
  $$("[data-nav]").forEach(function(a){ a.setAttribute("aria-current", a.dataset.nav===top && !(top==="sites"&&parts[1]&&parts[1]!=="new") ? "page" : "false") });
  $$("[data-site]").forEach(function(a){ a.setAttribute("aria-current", top==="sites"&&parts[1]===a.dataset.site ? "page" : "false") });
}

/* ============ router ============ */
function route(){
  S.cleanup.forEach(function(f){ try{f()}catch(e){} }); S.cleanup=[];
  var parts = (location.hash.replace(/^#\/?/,"")||"").split("/").filter(Boolean);
  var top = parts[0]||"overview";
  markNav();
  var v=$("#view"); v.innerHTML='<div class="loading">Loading…</div>';
  var p;
  if(top==="overview") p=overview();
  else if(top==="sites" && parts[1]==="new") p=sitesView(true);
  else if(top==="sites" && parts[1]) p=siteView(parts[1], parts[2]||"pages", parts[3]);
  else if(top==="sites") p=sitesView();
  else if(top==="contacts") p=contactsView(parts[1]);
  else if(top==="emails" && parts[1]) p=emailView(parts[1]);
  else if(top==="emails") p=emailsView();
  else if(top==="automations" && parts[1]) p=automationView(parts[1], parts[2]);
  else if(top==="automations") p=automationsView();
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
  if(tpl==="post") h+=f("pcEye","Heading above the signup","eyebrow",60);
  h+=f("pcCta","Button text","cta",30);
  h+=f("pcDesc","Search & share description","description",200,"What Google and link previews show. Leave blank to use the supporting line.");
  return h;
}

function siteView(sid, tab, pageId){
  return Promise.all([api("GET","sites"), api("GET","sites/"+sid+"/pages"), api("GET","lists")]).then(function(r){
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
  var st = { list:listParam||"", q:"", status:"", offset:0, rows:[], total:0, open:null, panel:null };
  var lists=[];
  function load(append){
    var qs="limit=100&offset="+st.offset+(st.q?"&q="+encodeURIComponent(st.q):"")+(st.list?"&list="+st.list:"")+(st.status?"&status="+st.status:"");
    return api("GET","contacts?"+qs).then(function(d){ st.rows = append? st.rows.concat(d.contacts) : d.contacts; st.total=d.total; renderTable() });
  }
  function listName(id){ var l=lists.filter(function(x){return x.id===id})[0]; return l? l.name : "" }
  function renderShell(){
    var cur = lists.filter(function(l){return l.id===st.list})[0];
    var v=$("#view");
    v.innerHTML = head("Audience", "Contacts", "Everyone who signed up, across every site.", '<button class="btn" type="button" id="exportBtn">Export CSV</button><button class="btn" type="button" id="importBtn">Import</button><button class="btn primary" type="button" id="addBtn">Add contact</button>')+
      '<div class="cols"><aside class="stack" style="gap:10px"><div class="actions" style="justify-content:space-between"><span class="eyebrow">Lists</span><button class="btn sm" type="button" id="newList">New list</button></div><div id="newListHost"></div><div class="listnav">'+
        '<button type="button" data-list="" aria-pressed="'+(!st.list)+'"><span>All contacts</span><span></span></button>'+
        lists.map(function(l){ return '<button type="button" data-list="'+esc(l.id)+'" aria-pressed="'+(st.list===l.id)+'"><span>'+esc(l.name)+'</span><span class="num">'+l.subscribed+'</span></button>' }).join("")+'</div>'+
        (cur ? '<div class="stack" style="margin-top:6px">'+(cur.site_id ? '<p class="hint">Signups from '+esc(cur.site_name)+' land here. <a href="#/sites/'+esc(cur.site_id)+'/welcome">Welcome email</a></p>' : '<div class="actions"><button type="button" class="btn sm" id="renameList">Rename</button><button type="button" class="btn sm danger" id="deleteList">Delete list</button></div><div id="listConfirm"></div>')+'</div>' : '')+
      '</aside><section class="stack"><div id="panel"></div><div class="filters"><label class="sr" for="cq">Search</label><input type="search" id="cq" placeholder="Search name or email" value="'+esc(st.q)+'">'+
        '<label class="sr" for="cs">Status</label><select id="cs"><option value="">Any status</option><option value="subscribed"'+(st.status==="subscribed"?" selected":"")+'>Subscribed</option><option value="unsubscribed"'+(st.status==="unsubscribed"?" selected":"")+'>Unsubscribed</option><option value="pending"'+(st.status==="pending"?" selected":"")+'>Waiting to confirm</option><option value="bounced"'+(st.status==="bounced"?" selected":"")+'>Bounced</option><option value="complained"'+(st.status==="complained"?" selected":"")+'>Marked as spam</option></select>'+
        '<span class="label" id="count"></span></div><div id="tableHost"></div></section></div>';
    $$("[data-list]").forEach(function(b){ b.onclick=function(){ st.list=b.dataset.list; st.offset=0; st.open=null; st.panel=null; history.replaceState(null,"","#/contacts"+(st.list?"/"+st.list:"")); renderShell(); load() } });
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
          '<p class="hint">Came from '+esc(c.source||"—")+' on '+fmtDate(c.created_at,true)+'. '+(c.consent_at ? 'Agreed to emails on '+fmtDate(c.consent_at,true)+': “'+esc(c.consent_text)+'”' : 'Added by hand or import, no signup consent recorded.')+'</p>'+
          (c.status==="bounced" ? '<div class="notice danger"><p>Emails to this address bounced, so Studio stopped sending to it. Only switch it back if you know the address works now.</p></div>' : '')+
          (c.status==="complained" ? '<div class="notice danger"><p>They marked one of your emails as spam, so Studio stopped emailing them. Leave this as it is unless they ask to hear from you again.</p></div>' : '')+
          (c.status==="pending" ? '<div class="notice"><p>They signed up but haven’t tapped the confirmation link yet. Nothing else is sent until they do.</p></div>' : '')+
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
  function refreshLists(){ return api("GET","lists").then(function(d){ lists=d.lists }) }
  var want=store("studio.openContact"); if(want){ store("studio.openContact",""); st.open=want; st.panel="detail" }
  return refreshLists().then(function(){ renderShell(); return load() });
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
  return Promise.all([api("GET","campaigns/"+cid), api("GET","lists"), api("GET","sites")]).then(function(r){
    var cp=r[0].campaign, stats=r[0].stats||{}, audience=r[0].audience, lists=r[1].lists, sites=r[2].sites;
    var v=$("#view"), editable = cp.status==="draft"||cp.status==="scheduled";
    var listLabel=function(id){ var l=lists.filter(function(x){return x.id===id})[0]; return l? l.name : "Everyone subscribed" };
    var html='<div class="pagehead"><div><span class="eyebrow"><a href="#/emails" style="color:inherit;text-decoration:none">Emails</a> · '+esc(cp.status)+'</span><h1 id="cpTitle">'+esc(cp.name)+'</h1><p class="sub"><span class="chip '+esc(cp.status)+'">'+esc(cp.status)+'</span> '+
      (cp.status==="scheduled" ? "Goes out "+fmtDate(cp.scheduled_at,true) : cp.sent_at ? "Sent "+fmtDate(cp.sent_at,true)+" to "+esc(listLabel(cp.list_id)) : "")+'</p></div>'+
      '<div class="actions"><button class="btn" type="button" id="dupBtn">Duplicate</button>'+(cp.status!=="sending"?'<button class="btn danger" type="button" id="delBtn">Delete</button>':'')+'</div></div><div id="delConfirm"></div>';
    if(!editable){
      var sent=stats.sent||0;
      html+='<div class="stats"><div><b>'+sent+'</b><span>sent'+(stats.queued?' · '+stats.queued+' to go':'')+'</span></div><div><b>'+pct(stats.opened||0,sent)+'</b><span>opened ('+(stats.opened||0)+')</span></div><div><b>'+pct(stats.clicked||0,sent)+'</b><span>clicked ('+(stats.clicked||0)+')</span></div><div><b>'+(stats.bounced||0)+'</b><span>bounced'+(stats.complained?' · '+stats.complained+' spam':'')+'</span></div><div><b>'+(stats.failed||0)+'</b><span>failed</span></div></div>';
      if(stats.failed) html+='<div class="notice danger"><p>'+stats.failed+' didn’t send. Last error: '+esc(stats.last_error||"unknown")+'</p><button class="btn sm" type="button" id="retryBtn">Try again</button></div>';
      html+='<p class="hint">Opens are approximate: some email apps block the tracking image, others load it automatically.</p>';
      html+='<div class="proof email"><div class="proofbar"><span class="url">'+esc(cp.subject)+'</span></div><iframe id="pv" title="Email preview" sandbox=""></iframe></div>';
      v.innerHTML=html;
      emailPreview($("#pv"),{subject:cp.subject, preheader:cp.preheader, body:cp.body, site_id:cp.site_id});
      if(cp.status==="sending"){ var poll=setInterval(function(){ route() },5000); S.cleanup.push(function(){ clearInterval(poll) }) }
      var rb=$("#retryBtn"); if(rb) rb.onclick=function(){ api("POST","campaigns/"+cid+"/retry").then(function(){ toast("Retrying"); route() }).catch(function(e){ toast(e.message,true) }) };
    } else {
      html+=emailBanner()+'<div class="editor"><form class="form panel" id="cpForm" autocomplete="off"><h2 class="sec">Compose <span class="saving" id="cpSave">Saved</span></h2>'+
        '<div class="field"><label for="cpName">Internal name</label><input type="text" id="cpName" maxlength="80" value="'+esc(cp.name)+'"><span class="hint">Only you see this.</span></div>'+
        '<div class="fieldrow"><div class="field"><label for="cpList">Send to</label><select id="cpList"><option value="">Everyone subscribed</option>'+lists.map(function(l){ return '<option value="'+esc(l.id)+'"'+(cp.list_id===l.id?" selected":"")+'>'+esc(l.name)+' ('+l.subscribed+')</option>' }).join("")+'</select></div>'+
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
      var showAudience=function(n){ audience=n; $("#audience").textContent = "Goes to "+n+" subscribed "+(n===1?"person":"people")+" on “"+listLabel($("#cpList").value||null)+"”. Unsubscribed people are always left out." };
      showAudience(audience);
      var t; function preview(){ clearTimeout(t); t=setTimeout(function(){ emailPreview($("#pv"),{subject:$("#cpSubj").value, preheader:$("#cpPre").value, body:$("#cpBody").value, site_id:$("#cpSite").value||null}) },250) }
      S.cleanup.push(function(){ clearTimeout(t) });
      var save=saver($("#cpSave"), function(d){ return api("PATCH","campaigns/"+cid,d).then(function(r){ cp=r.campaign; showAudience(r.audience); $("#cpTitle").textContent=cp.name }) });
      $("#cpName").oninput=function(){ save({name:this.value}) };
      $("#cpSubj").oninput=function(){ save({subject:this.value}); preview() };
      $("#cpPre").oninput=function(){ save({preheader:this.value}); preview() };
      $("#cpBody").oninput=function(){ save({body:this.value}); preview() };
      $("#cpList").onchange=function(){ save({list_id:this.value||null}); save.now() };
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

/* ============ settings ============ */
function settingsView(){
  return Promise.all([api("GET","settings"), api("GET","settings/events")]).then(function(r){
    var s=r[0].settings, ev=r[1], v=$("#view"), dbl=s.double_optin==="1";
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
      '<h2 class="sec">Signup forms</h2>'+
      '<div class="field"><label for="sConsent">Consent line</label><textarea id="sConsent" data-k="consent_text" maxlength="300">'+esc(s.consent_text)+'</textarea><span class="hint">People must tick this to sign up. Studio keeps the wording and the time they agreed, which is your GDPR record.</span></div>'+
      '<div class="actions"><button type="button" class="switch" role="switch" id="sDbl" aria-checked="'+dbl+'" aria-labelledby="sDblLbl"></button><span id="sDblLbl">Ask new sign-ups to confirm their email</span></div>'+
      '<p class="hint">When this is on, people get a “tap to confirm” email first. Welcome emails and automations start once they tap it. Fewer typos and fake addresses on your lists, at the cost of some people never confirming.</p>'+
      '</form><div class="stack"><section class="panel"><h2 class="sec">Bounces and spam reports</h2>'+hooks+'</section>'+
      '<section class="panel"><h2 class="sec">Connections</h2><div class="rows">'+
      '<div class="rowi" style="--pc:var(--'+(S.me.emailConnected?"moss":"brass")+')"><span class="t">Email sending<small>Resend, from @'+esc(S.me.root)+'</small></span><span class="meta"><span class="chip '+(S.me.emailConnected?"sent":"draft")+'">'+(S.me.emailConnected?(S.me.dev?"Simulated":"Connected"):"Not yet")+'</span></span></div>'+
      '<div class="rowi" style="--pc:var(--'+(ev.connected?"moss":"brass")+')"><span class="t">Delivery updates<small>Bounces and spam reports from Resend</small></span><span class="meta"><span class="chip '+(ev.connected?"sent":"draft")+'">'+(ev.connected?"Connected":"Not yet")+'</span></span></div>'+
      '<div class="rowi" style="--pc:var(--moss)"><span class="t">Sign-in<small>'+esc(S.me.email)+'</small></span><span class="meta"><span class="chip sent">'+(S.me.dev?"Dev mode":"Email link")+'</span></span></div>'+
      '<div class="rowi" style="--pc:var(--moss)"><span class="t">Domain<small>*.'+esc(S.me.root)+'</small></span><span class="meta"><span class="chip sent">Every subdomain</span></span></div>'+
      '</div></section>'+(S.me.dev?'<p class="hint">This is the local test copy. Nothing is really emailed.</p>':'')+'</div></div>';
    var save=saver($("#setSave"), function(x){ return api("PUT","settings",x) });
    $$("[data-k]",v).forEach(function(i){ i.oninput=function(){ var o={}; o[i.dataset.k]=i.value; save(o) } });
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
    var rp=$("#whReplace"); if(rp) rp.onclick=function(){ this.hidden=true; manual($("#whManual")) };
  });
}

/* ============ start ============ */
api("GET","me").then(function(me){ S.me=me; $("#rootDomain").textContent=me.root; $("#meEmail").textContent=me.dev?"local test copy":me.email; route(); refreshNav() })
  .catch(function(e){ $("#view").innerHTML='<div class="notice danger"><p>'+esc(e.message)+'</p></div>' });
})();
