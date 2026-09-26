import { Env, HttpError, esc, json, now, token } from "./util";
import { FileRow, fileUrl, finishBig, startBig, uploadPart, uploadSmall } from "./files";
import { page } from "./login";

/*
 * One-time upload links: https://studio.<domain>/up/<secret>. The secret is the permission (no sign-in),
 * lasts an hour by default and takes up to max_files files. Opened in a browser it's a drag-and-drop page
 * that sends big videos in 50 MB parts; a script can PUT a file (up to 95 MB) or use the parts API.
 * Claude creates links and checks on them through the connector.
 */

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

interface Link { hash: string; id: string; folder: string; note: string; max_files: number; expires_at: number; created_at: number }

export async function createUploadLink(env: Env, o: { folder?: string; note?: string; maxFiles?: number; minutes?: number }) {
  if (!env.FILES) throw new HttpError(409, "File storage isn’t switched on.");
  const secret = token(), lid = "ul_" + token().slice(0, 12).replace(/[^A-Za-z0-9]/g, "x");
  const minutes = Math.min(24 * 60, Math.max(10, Number(o.minutes) || 60));
  const t = now();
  await env.DB.prepare("INSERT INTO upload_links (hash, id, folder, note, max_files, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(await sha256(secret), lid, (o.folder || "").slice(0, 60), (o.note || "").slice(0, 300), Math.min(50, Math.max(1, Number(o.maxFiles) || 10)), t + minutes * 60_000, t).run();
  const base = `https://studio.${env.ROOT_DOMAIN}/up/${secret}`;
  return { id: lid, url: base, expires_at: t + minutes * 60_000 };
}

export async function uploadLinkStatus(env: Env, lid: string) {
  const l = await env.DB.prepare("SELECT * FROM upload_links WHERE id = ?").bind(lid).first<Link>();
  if (!l) throw new HttpError(404, "No upload link with that id.");
  const { results } = await env.DB.prepare("SELECT * FROM files WHERE upload_link = ? ORDER BY created_at").bind(lid).all<FileRow>();
  return {
    id: l.id, folder: l.folder, expired: l.expires_at < now(), expires_at: new Date(l.expires_at).toISOString(),
    files: results.map((f) => ({ id: f.id, name: f.name, status: f.status === "ready" ? "ready" : "still uploading", kind: f.kind, size_bytes: f.size, url: f.status === "ready" ? fileUrl(env, f.key) : null })),
  };
}

async function linkFor(env: Env, secret: string): Promise<Link | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(secret)) return null;
  const l = await env.DB.prepare("SELECT * FROM upload_links WHERE hash = ?").bind(await sha256(secret)).first<Link>();
  return l && l.expires_at > now() ? l : null;
}

async function room(env: Env, l: Link): Promise<boolean> {
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE upload_link = ?").bind(l.id).first<{ n: number }>();
  return (n?.n || 0) < l.max_files;
}

async function ownFile(env: Env, l: Link, fid: string): Promise<void> {
  const f = await env.DB.prepare("SELECT upload_link FROM files WHERE id = ?").bind(fid).first<{ upload_link: string | null }>();
  if (!f || f.upload_link !== l.id) throw new HttpError(404, "That upload doesn’t belong to this link.");
}

/** Everything under /up/ on the studio host. */
export async function handleUploadLink(req: Request, env: Env, path: string): Promise<Response> {
  const [, , secret, part, n] = path.split("/");
  const l = await linkFor(env, secret || "");
  if (!l) {
    if (req.method === "GET") return page("Link expired", `<span class="eyebrow">Upload</span><h1>This upload link has expired</h1><p>Ask Claude for a new one, or upload in Studio’s Files page.</p>`, 404, { "referrer-policy": "no-referrer" });
    return json({ error: "This upload link has expired or doesn’t exist." }, 404);
  }
  try {
    if (!part && req.method === "GET") return uploadPage(l);
    if (!part && (req.method === "PUT" || req.method === "POST")) {
      if (!(await room(env, l))) throw new HttpError(409, "This link has taken as many files as it allows.");
      const f = await uploadSmall(env, req, { folder: l.folder, link: l.id });
      return json({ id: f.id, name: f.name, url: fileUrl(env, f.key), size_bytes: f.size }, 201);
    }
    if (part === "start" && req.method === "POST") {
      if (!(await room(env, l))) throw new HttpError(409, "This link has taken as many files as it allows.");
      const r = await startBig(env, req, { folder: l.folder, link: l.id });
      return json({ id: r.file.id, partSize: r.partSize }, 201);
    }
    if (part === "parts" && n && req.method === "PUT") {
      const fid = new URL(req.url).searchParams.get("file") || "";
      await ownFile(env, l, fid);
      return json(await uploadPart(env, req, fid, Number(n)));
    }
    if (part === "finish" && req.method === "POST") {
      const d = await req.json<any>().catch(() => ({}));
      await ownFile(env, l, String(d.file || ""));
      const f = await finishBig(env, String(d.file), Array.isArray(d.parts) ? d.parts : []);
      return json({ id: f.id, name: f.name, url: fileUrl(env, f.key), size_bytes: f.size });
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    throw e;
  }
}

function uploadPage(l: Link): Response {
  const mins = Math.max(1, Math.round((l.expires_at - now()) / 60000));
  return page("Upload", `<span class="eyebrow">Upload to Studio</span><h1>Drop your files here</h1>
${l.note ? `<p>${esc(l.note)}</p>` : ""}
<p>They go into your Studio files${l.folder ? ` in <b>${esc(l.folder)}</b>` : ""}. Videos up to 4 GB. This link works for another ${mins} minute${mins === 1 ? "" : "s"}.</p>
<label id="drop" style="border:1px dashed var(--line);padding:26px 14px;text-align:center;cursor:pointer;display:block;text-transform:none;letter-spacing:0;font-size:14px;font-weight:400;color:var(--t2)">
<input type="file" id="f" multiple accept="video/*,image/*,application/pdf,audio/*" style="position:absolute;opacity:0;width:1px;height:1px">
<b style="color:var(--t1)">Choose files</b><br><span class="fine">or drag them in</span></label>
<div id="list" style="display:flex;flex-direction:column;gap:8px"></div>
<p class="fine" id="done" hidden>All done. You can close this page and tell Claude they’re uploaded.</p>
<script>
(function(){
var base=location.pathname.replace(/\\/$/,""), list=document.getElementById("list"), drop=document.getElementById("drop"), busy=0;
function row(name){ var d=document.createElement("div"); d.style.cssText="display:grid;grid-template-columns:minmax(0,1fr) 38%;gap:10px;align-items:center;font-size:13px";
  d.innerHTML='<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><i style="height:6px;background:var(--line);display:block"><b style="display:block;height:100%;width:0;background:var(--coral)"></b></i>';
  d.firstChild.textContent=name; list.appendChild(d); return d }
function j(r){ return r.json().then(function(d){ if(!r.ok) throw new Error(d.error||"Upload failed"); return d }) }
function send(file){
  var d=row(file.name), bar=d.querySelector("b"), type=file.type||"application/octet-stream";
  var h={"content-type":type,"x-filename":encodeURIComponent(file.name),"x-size":String(file.size)};
  var set=function(x){ bar.style.width=Math.round(x*100)+"%" };
  set(0.03);
  var p = file.size<=90*1024*1024
    ? fetch(base,{method:"PUT",headers:h,body:file}).then(j)
    : fetch(base+"/start",{method:"POST",headers:h}).then(j).then(function(s){
        var size=s.partSize, count=Math.ceil(file.size/size), parts=[], i=0;
        function next(){
          if(i>=count) return fetch(base+"/finish",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({file:s.id,parts:parts})}).then(j);
          var num=i+1, chunk=file.slice(i*size,Math.min(file.size,(i+1)*size));
          function go(t){ return fetch(base+"/parts/"+num+"?file="+s.id,{method:"PUT",body:chunk}).then(j).catch(function(e){ if(t<2) return go(t+1); throw e }) }
          return go(0).then(function(pt){ parts.push(pt); i++; set(i/count*0.98); return next() });
        }
        return next();
      });
  return p.then(function(){ set(1); bar.style.background="var(--sage)"; d.firstChild.textContent="✓ "+file.name })
    .catch(function(e){ d.firstChild.textContent=file.name+": "+e.message; d.firstChild.style.color="#A63E2A" })
    .then(function(){ busy--; if(!busy) document.getElementById("done").hidden=false });
}
function many(files){ var l=Array.prototype.slice.call(files); if(!l.length) return; busy+=l.length; document.getElementById("done").hidden=true; l.reduce(function(c,f){ return c.then(function(){ return send(f) }) }, Promise.resolve()) }
document.getElementById("f").onchange=function(){ many(this.files); this.value="" };
["dragenter","dragover"].forEach(function(e){ drop.addEventListener(e,function(ev){ ev.preventDefault(); drop.style.borderColor="var(--coral)" }) });
["dragleave","drop"].forEach(function(e){ drop.addEventListener(e,function(ev){ ev.preventDefault(); drop.style.borderColor="" }) });
drop.addEventListener("drop",function(ev){ many(ev.dataTransfer.files) });
window.addEventListener("beforeunload",function(e){ if(busy){ e.preventDefault(); e.returnValue="" } });
})();
</script>`, 200, { "referrer-policy": "no-referrer" });
}
