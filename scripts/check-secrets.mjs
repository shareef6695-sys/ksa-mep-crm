#!/usr/bin/env node
// Fails (exit 1) if a secret-looking value is committed, or if the browser build contains a privileged key.
//   npm run check:secrets            scan every tracked file
//   npm run check:secrets -- dist    also scan the built bundle (run after `npm run build`)
// Runs in CI. To allow a deliberate placeholder, keep it in <ANGLE_BRACKETS> or use an obviously fake value.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RULES = [
  ['JWT (Supabase anon / service-role key)', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Supabase secret / publishable key', /\bsb_(secret|publishable)_[A-Za-z0-9_-]{10,}/],
  ['Stripe key', /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google / Firebase API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['GitHub token', /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['SendGrid key', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/],
  ['Resend key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ['OpenAI / Anthropic key', /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}/],
  ['Twilio auth token', /\bTWILIO_AUTH_TOKEN\s*[=:]\s*['"]?[a-f0-9]{32}/],
  ['Private key block', /-----BEGIN (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['Connection string with password', /\b(postgres(ql)?|mongodb(\+srv)?|mysql|redis):\/\/[^\s:@/'"<>]+:[^\s@'"<>]+@/i],
];
// Files that must never be committed at all.
const FORBIDDEN_FILE = /(^|\/)(\.env(\.(?!example$)[^/]+)?|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519)|credentials\.json|service-account.*\.json)$/i;
const SKIP = /(^|\/)(package-lock\.json|scripts\/check-secrets\.mjs)$|\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip)$/i;

const problems = [];
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of tracked) {
  if (FORBIDDEN_FILE.test(file)) problems.push(`${file}: this kind of file must not be committed`);
  if (SKIP.test(file)) continue;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of RULES) if (re.test(line)) problems.push(`${file}:${i + 1}: ${name}`);
  });
}

// Built bundle: the anon key is expected there; a service-role key or any other secret is not.
const dist = process.argv[2];
if (dist) {
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const file of walk(dist).filter((f) => /\.(js|html|css|map|json)$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    for (const jwt of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || []) {
      let role = 'unknown';
      try { role = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role; } catch { /* not a JWT */ }
      if (role !== 'anon') problems.push(`${file}: JWT with role "${role}" in the browser bundle`);
    }
    // the publishable key belongs in the bundle; a secret key (sb_secret_ + key material) never does
    if (/\bsb_secret_[A-Za-z0-9_-]{10,}/.test(text)) problems.push(`${file}: Supabase secret key in the browser bundle`);
    for (const [name, re] of RULES.slice(2)) {
      if (re.test(text)) problems.push(`${file}: ${name} in the browser bundle`);
    }
  }
}

if (problems.length) {
  console.error(`Secret check FAILED (${problems.length}):\n  ${problems.join('\n  ')}`);
  console.error('Move the value to an environment variable / Edge Function secret, and rotate it if it was ever pushed.');
  process.exit(1);
}
console.log(`Secret check OK: ${tracked.length} tracked files${dist ? ` + ${dist}/` : ''}, nothing found.`);
