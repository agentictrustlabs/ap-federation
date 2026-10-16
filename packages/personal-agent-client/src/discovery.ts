// DISCOVERY — `/.well-known/poppy.json` and the company's RFC 8414 metadata, each checked the way PAP 3.1–3.2 says
// (domain = the host that served the document; issuer matches; poppy_domains lists the domain; ES256 for DPoP).
// A document that fails a check is not used — never "nearest match" (spec 439 §3.1).
export interface PoppyDocument {
  protocol_version: string;
  organization: { name: string; domain: string };
  auth?: { issuer: string; direct?: { scopes: string[] }; device?: { scopes: string[] }; mediated?: { endpoint: string; fields: string[]; scopes: string[] }; custom_scopes?: Record<string, string> };
  agent?: { protocols: Array<{ type: string; endpoint: string; resource?: string }> };
  apis?: Array<{ type: string; url: string; description?: string; resource?: string }>;
  web?: { browser_session_endpoint?: string };
  extensions?: Record<string, { version: string; endpoint?: string; [k: string]: unknown }>;
}

export interface AuthServerMetadata {
  issuer: string;
  token_endpoint: string;
  revocation_endpoint: string;
  authorization_endpoint?: string;
  device_authorization_endpoint?: string;
  dpop_signing_alg_values_supported?: string[];
  poppy_domains?: string[];
}

export interface Company {
  domain: string;
  name: string;
  issuer: string;
  poppy: PoppyDocument;
  metadata: AuthServerMetadata;
  operationsEndpoint: string | null;
}

export type DiscoveryRefusal =
  | 'POPPY_UNREACHABLE' | 'POPPY_NOT_JSON' | 'POPPY_MAJOR_VERSION_UNSUPPORTED' | 'POPPY_DOMAIN_MISMATCH' | 'POPPY_NO_AUTH'
  | 'METADATA_UNREACHABLE' | 'METADATA_ISSUER_MISMATCH' | 'METADATA_DOMAIN_NOT_LISTED' | 'METADATA_NO_ES256' | 'METADATA_ENDPOINTS_MISSING';

export type DiscoveryResult = { ok: true; company: Company } | { ok: false; refusal: DiscoveryRefusal; detail?: string };

export const SUPPORTED_MAJOR = '0';

export async function discoverCompany(domain: string, f: typeof fetch): Promise<DiscoveryResult> {
  const host = domain.toLowerCase();
  let r: Response;
  try { r = await f(`https://${host}/.well-known/poppy.json`, { headers: { accept: 'application/json' }, redirect: 'follow' }); } catch (e) { return { ok: false, refusal: 'POPPY_UNREACHABLE', detail: (e as Error).message }; }
  if (!r.ok) return { ok: false, refusal: 'POPPY_UNREACHABLE', detail: `HTTP ${r.status}` };
  const servedHost = new URL(r.url || `https://${host}/.well-known/poppy.json`).host.toLowerCase();
  let doc: PoppyDocument;
  try { doc = (await r.json()) as PoppyDocument; } catch { return { ok: false, refusal: 'POPPY_NOT_JSON' }; }
  const major = String(doc.protocol_version ?? '').split('.')[0];
  if (major !== SUPPORTED_MAJOR) return { ok: false, refusal: 'POPPY_MAJOR_VERSION_UNSUPPORTED', detail: String(doc.protocol_version) };
  if (!doc.organization?.domain || doc.organization.domain.toLowerCase() !== servedHost) return { ok: false, refusal: 'POPPY_DOMAIN_MISMATCH', detail: `${doc.organization?.domain} ≠ ${servedHost}` };
  if (!doc.auth?.issuer || !/^https:\/\//.test(doc.auth.issuer)) return { ok: false, refusal: 'POPPY_NO_AUTH' };
  let m: Response;
  try { m = await f(`${doc.auth.issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`, { headers: { accept: 'application/json' } }); } catch (e) { return { ok: false, refusal: 'METADATA_UNREACHABLE', detail: (e as Error).message }; }
  if (!m.ok) return { ok: false, refusal: 'METADATA_UNREACHABLE', detail: `HTTP ${m.status}` };
  let md: AuthServerMetadata;
  try { md = (await m.json()) as AuthServerMetadata; } catch { return { ok: false, refusal: 'METADATA_UNREACHABLE', detail: 'not JSON' }; }
  if (md.issuer !== doc.auth.issuer) return { ok: false, refusal: 'METADATA_ISSUER_MISMATCH', detail: `${md.issuer} ≠ ${doc.auth.issuer}` };
  if (!Array.isArray(md.poppy_domains) || !md.poppy_domains.map((d) => d.toLowerCase()).includes(servedHost)) return { ok: false, refusal: 'METADATA_DOMAIN_NOT_LISTED', detail: servedHost };
  if (!Array.isArray(md.dpop_signing_alg_values_supported) || !md.dpop_signing_alg_values_supported.includes('ES256')) return { ok: false, refusal: 'METADATA_NO_ES256' };
  if (!/^https:\/\//.test(md.token_endpoint ?? '') || !/^https:\/\//.test(md.revocation_endpoint ?? '')) return { ok: false, refusal: 'METADATA_ENDPOINTS_MISSING' };
  const ops = doc.extensions?.operations;
  return { ok: true, company: { domain: servedHost, name: doc.organization.name, issuer: md.issuer, poppy: doc, metadata: md, operationsEndpoint: ops && ops.version === '1' && typeof ops.endpoint === 'string' ? ops.endpoint : null } };
}
