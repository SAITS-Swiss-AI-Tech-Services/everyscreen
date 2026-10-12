// Cloudflare Access identity. Behind Access every request carries a signed JWT
// in Cf-Access-Jwt-Assertion; the plain Cf-Access-Authenticated-User-Email
// header can be sent by anyone who reaches the origin directly, so it is never
// trusted. The JWT is checked against the team's public keys (RS256, fetched
// from https://<team>/cdn-cgi/access/certs and cached), the application's AUD
// tag, the issuer and the expiry.
//
// Configured with CF_ACCESS_TEAM_DOMAIN (e.g. myteam.cloudflareaccess.com)
// and CF_ACCESS_AUD. Without both, there is no verified identity at all.

import crypto from 'node:crypto';

export interface AccessConfig {
  teamDomain: string;
  aud: string;
  /** Where the signing keys come from; overridable for tests. */
  fetchJwks?: (url: string) => Promise<{ keys: JsonWebKey[] }>;
  /** Clock in ms; overridable for tests. */
  now?: () => number;
}

const KEYS_TTL = 60 * 60_000; // refetch the key set hourly
const REFETCH_MIN = 60_000; // an unknown kid refetches at most once a minute
const LEEWAY = 30; // seconds of clock skew allowed on exp / nbf

export function accessConfigFromEnv(env = process.env): AccessConfig | null {
  const team = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.CF_ACCESS_AUD?.trim();
  return team && aud ? { teamDomain: team, aud } : null;
}

async function defaultFetchJwks(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as { keys: JsonWebKey[] };
}

const b64json = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/** Returns verify(token) → the email in a valid token, else null. */
export function createAccessVerifier(cfg: AccessConfig) {
  const team = cfg.teamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const issuer = `https://${team}`;
  const certsUrl = `${issuer}/cdn-cgi/access/certs`;
  const fetchJwks = cfg.fetchJwks ?? defaultFetchJwks;
  const clock = cfg.now ?? Date.now;

  let keys = new Map<string, crypto.KeyObject>();
  let fetchedAt = 0;
  let loading: Promise<void> | null = null;

  const load = () =>
    (loading ??= fetchJwks(certsUrl)
      .then((jwks) => {
        const next = new Map<string, crypto.KeyObject>();
        for (const k of jwks.keys ?? []) {
          const kid = (k as { kid?: string }).kid;
          if (k.kty !== 'RSA' || !kid) continue;
          next.set(kid, crypto.createPublicKey({ key: k, format: 'jwk' }));
        }
        keys = next;
      })
      .catch((e) => console.warn('[access] could not load signing keys:', e instanceof Error ? e.message : e))
      .finally(() => {
        // failures count too, so a dead endpoint isn't hammered
        fetchedAt = clock();
        loading = null;
      }));

  async function keyFor(kid: string) {
    const age = clock() - fetchedAt;
    if (!fetchedAt || age > KEYS_TTL || (!keys.has(kid) && age > REFETCH_MIN)) await load();
    return keys.get(kid) ?? null;
  }

  return async function verify(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let header: { alg?: string; kid?: string };
    let claims: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };
    try {
      header = b64json(parts[0]);
      claims = b64json(parts[1]);
    } catch {
      return null;
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    const key = await keyFor(header.kid);
    if (!key) return null;
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) return null;
    const t = clock() / 1000;
    if (typeof claims.exp !== 'number' || claims.exp + LEEWAY < t) return null;
    if (typeof claims.nbf === 'number' && claims.nbf - LEEWAY > t) return null;
    if (claims.iss !== issuer) return null;
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(cfg.aud)) return null;
    return typeof claims.email === 'string' && claims.email ? claims.email : null;
  };
}
