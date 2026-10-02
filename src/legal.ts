import { Env } from "./util";

/*
 * Public Terms of Service and Privacy Policy for Studio, at studio.<domain>/terms and /privacy.
 * Platforms (TikTok, Meta, Pinterest) ask for these when Studio's developer apps are set up and reviewed.
 */

const UPDATED = "2 October 2026";

function page(env: Env, title: string, body: string): Response {
  const contact = `hello@${env.ROOT_DOMAIN}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Studio</title><meta name="robots" content="index,follow">
<style>
:root{--ink:#16181f;--soft:#5b6070;--line:#e3e1db;--bg:#f7f6f2;--accent:#e2714f}
@media (prefers-color-scheme:dark){:root{--ink:#ecebe6;--soft:#a3a6b2;--line:#2c2f3a;--bg:#13151c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:720px;margin:0 auto;padding:48px 20px 80px}
.brand{font:600 13px/1 system-ui;letter-spacing:.14em;text-transform:uppercase;color:var(--soft)}
h1{font-size:34px;line-height:1.2;margin:10px 0 4px}h2{font-size:19px;margin:34px 0 8px}
p,li{color:var(--ink)}ul{padding-left:20px}.meta{color:var(--soft);font-size:14px;margin:0 0 28px}
a{color:var(--accent)}nav{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);font-size:14px;color:var(--soft)}
</style></head><body><main><div class="brand">Studio</div><h1>${title}</h1><p class="meta">Last updated ${UPDATED}</p>
${body.replace(/\{contact\}/g, `<a href="mailto:${contact}">${contact}</a>`).replace(/\{domain\}/g, env.ROOT_DOMAIN)}
<nav><a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a> · <a href="mailto:${contact}">${contact}</a></nav></main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

const TERMS = `
<p>Studio is a marketing workspace at studio.{domain}. It lets you build simple websites and sign-up forms, send email, and plan, schedule and publish posts to your own social media accounts, including TikTok, Instagram, Threads, Pinterest and Bluesky. Studio is run by Aisling, based in Spain (“we”, “us”). By using Studio you agree to these terms.</p>

<h2>Your account</h2>
<p>You sign in to Studio with an email link. Keep access to that email address secure, because anyone who can read it can sign in as you. You’re responsible for what happens in your workspace.</p>

<h2>Connecting social accounts</h2>
<ul>
<li>You can connect social media accounts that you own or are authorised to manage. You connect them through each platform’s own sign-in screen, and you can disconnect them at any time in Studio or in the platform’s settings.</li>
<li>Studio only publishes what you write, schedule or approve. It doesn’t post on its own.</li>
<li>When you use Studio to post to a platform, you must also follow that platform’s rules. For TikTok, that means the <a href="https://www.tiktok.com/legal/terms-of-service">TikTok Terms of Service</a>, <a href="https://www.tiktok.com/community-guidelines">Community Guidelines</a> and <a href="https://www.tiktok.com/legal/music-usage-confirmation">Music Usage Confirmation</a>.</li>
</ul>

<h2>Your content</h2>
<p>You keep all rights to the text, pictures, videos and other content you add to Studio. You give us permission to store, process and send that content only so that Studio can do what you ask, such as publishing a post to the accounts you choose. You confirm that you have the rights to everything you publish, and that it is lawful.</p>

<h2>Acceptable use</h2>
<p>Don’t use Studio to send spam, to post content that is illegal, misleading, hateful or infringes someone else’s rights, to get around a platform’s limits or rules, or to access accounts you aren’t authorised to manage. We may suspend a workspace that does.</p>

<h2>Availability</h2>
<p>We work to keep Studio running and your posts going out on time, but we can’t promise it will always be available or error-free. Social platforms can reject, delay or remove posts for their own reasons, and can change or withdraw their APIs.</p>

<h2>Liability</h2>
<p>Studio is provided “as is”. To the extent the law allows, we aren’t liable for indirect losses, lost profits or lost data, or for the actions of the social platforms. Nothing in these terms limits rights you have under consumer law that can’t be excluded.</p>

<h2>Ending use</h2>
<p>You can stop using Studio and ask us to delete your workspace at any time by emailing {contact}. We may end access if these terms are broken.</p>

<h2>Changes</h2>
<p>We may update these terms. If a change is significant, we’ll let you know before it takes effect. The date at the top shows the latest version.</p>

<h2>Law</h2>
<p>These terms are governed by the laws of Spain.</p>

<h2>Contact</h2>
<p>Questions about these terms: {contact}.</p>
`;

const PRIVACY = `
<p>This policy explains what information Studio (studio.{domain}) collects, how it’s used, and the choices you have. Studio is run by Aisling, based in Spain, who is the data controller. Contact: {contact}.</p>

<h2>What we collect</h2>
<ul>
<li><b>Your sign-in email address.</b> Used to send you sign-in links.</li>
<li><b>Connected social accounts.</b> When you connect TikTok, Instagram, Threads, Pinterest or Bluesky, we receive and store your account ID, username, display name and profile picture, and access tokens that let Studio post for you. For Bluesky we store the app password you create for Studio. Tokens and passwords are stored encrypted.</li>
<li><b>Your posts and files.</b> The captions, pictures and videos you add, your schedule, and the links to your published posts.</li>
<li><b>Post performance.</b> Numbers the platforms report for posts published through Studio, such as views, likes, comments and shares.</li>
<li><b>Email contacts.</b> If you use Studio’s sign-up forms and email features, the names and email addresses of people who sign up to your lists, with the time and wording of their consent.</li>
<li><b>Link clicks.</b> Studio counts clicks on links in your posts. It doesn’t use cookies for this.</li>
</ul>

<h2>How we use it</h2>
<ul>
<li>To publish and schedule posts to the accounts you choose, and show you their results.</li>
<li>To send the emails you create.</li>
<li>To keep Studio working and secure.</li>
</ul>
<p>We don’t sell your information, use it for advertising, or use data from TikTok or other platforms for anything other than the features you use in Studio.</p>

<h2>TikTok data</h2>
<p>When you connect TikTok, Studio uses the permissions you grant to read your basic profile (to show which account is connected and the creator settings TikTok requires before posting), to publish the videos and photos you choose, and to read the view, like, comment and share counts of those posts. Studio doesn’t access your TikTok messages, followers or other content.</p>

<h2>Who we share it with</h2>
<ul>
<li><b>The social platforms you post to</b>, which receive the content you publish.</li>
<li><b>Cloudflare</b>, which hosts Studio and stores its database and files.</li>
<li><b>Resend</b>, which delivers Studio’s emails.</li>
<li><b>Zernio</b>, only for accounts you connect through Zernio.</li>
</ul>
<p>These providers process data on our behalf and only as needed to run the service.</p>

<h2>How long we keep it</h2>
<p>Access tokens are deleted as soon as you disconnect an account. Your posts, files and contacts are kept while your workspace exists, and deleted within 30 days of you asking us to delete it.</p>

<h2>Your rights</h2>
<p>Under the GDPR you can ask to see, correct, export or delete your personal data, or object to how it’s used. Email {contact}. You can also complain to the Spanish data protection authority, the <a href="https://www.aepd.es">AEPD</a>. You can revoke Studio’s access to a social account at any time in that platform’s settings, as well as in Studio.</p>

<h2>Cookies</h2>
<p>Studio uses one cookie to keep you signed in. It doesn’t use tracking or advertising cookies.</p>

<h2>Security</h2>
<p>Connections are encrypted, and access tokens and passwords are encrypted before they’re stored.</p>

<h2>Changes</h2>
<p>We’ll update the date at the top when this policy changes, and let you know about significant changes.</p>
`;

export function legalPage(env: Env, path: string): Response | null {
  if (path === "/terms" || path === "/terms/") return page(env, "Terms of Service", TERMS);
  if (path === "/privacy" || path === "/privacy/") return page(env, "Privacy Policy", PRIVACY);
  return null;
}
