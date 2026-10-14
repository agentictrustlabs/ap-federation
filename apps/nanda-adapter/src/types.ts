// THE NANDA INDEX'S OWN SHAPES — spec 439 F4; pinned in Ring 0's `docs/standards-lock.json` as `nanda-index`
// (digest of the record and routes as published 2026-10-14). Hand-authored against that source, never imported from
// it (ADR-0037: we do not take someone else's SDK into our tree).
//
// What the source says, and what it means for us:
//   · an identifier is an ARD URN — `urn:air:<publisher-FQDN>:<namespace>:<short-name>`; the retired `urn:ai:*` is
//     rejected there. Ring 0 already pins `ard`, so this adapter adds NO vocabulary of its own;
//   · `application/a2a-agent-card+json` is a first-class media type, so an AP agent is indexed AS ITSELF — the
//     released, JWS-signed card of spec 347 at its own well-known URL;
//   · publisher identity is a verified DOMAIN (and e-mail), never a key. An entry says who published a record. It
//     never says who may act (ADR-0056), and nothing in this file carries authority.

/** The media types the index accepts. We publish exactly one of them. */
export const NANDA_MEDIA_TYPE = {
  aiCatalog: 'application/ai-catalog+json',
  aiRegistry: 'application/ai-registry+json',
  a2aAgentCard: 'application/a2a-agent-card+json',
  mcpServerCard: 'application/mcp-server-card+json',
  agentSkillBundle: 'application/agentskill+zip',
} as const;
export type NandaMediaType = (typeof NANDA_MEDIA_TYPE)[keyof typeof NANDA_MEDIA_TYPE];

/** One public entry as `GET /api/v1/index` serves it (the AI Catalog entry shape). */
export interface NandaIndexEntryV1 {
  identifier: string;
  displayName: string;
  type: NandaMediaType;
  /** Where the artifact is. The index takes `url` XOR inline `data`; we always publish a URL — the card is served
   *  from the agent's own origin, so the index points AT the record and never holds a copy of it. */
  url: string;
  description?: string;
  tags?: string[];
  publisher: { identifier: string; displayName: string; identityType: 'domain' | 'email' };
  /** Namespaced extras. Ours go under `dev.agenticprimitives` — never under `org.projectnanda`, which is theirs. */
  extensions?: Record<string, Record<string, unknown>>;
}

/** What an A2A card says, in the fields this projection reads (spec 347's released card; A2A 1.0). */
export interface A2aCardLike {
  name?: string;
  description?: string;
  version?: string;
  documentationUrl?: string;
  provider?: { organization?: string; url?: string };
  supportedInterfaces?: Array<{ url?: string; protocolBinding?: string; protocolVersion?: string }>;
  skills?: Array<{ id?: string; name?: string; description?: string; tags?: string[] }>;
  capabilities?: Record<string, unknown>;
  /** Present on a RELEASED card (spec 347): the JWS the agent's custodian signed. The index has nowhere to put it. */
  signatures?: unknown[];
  [k: string]: unknown;
}

/** What the index cannot carry. Named, never dropped (spec 439 §5: mark what cannot be translated). */
export interface ProjectionLossV1 {
  /** A short, stable code a reader can count. */
  code:
    | 'signature-not-carried'
    | 'canonical-identity-not-carried'
    | 'authority-not-carried'
    | 'estate-not-carried'
    | 'skill-detail-not-carried'
    | 'capabilities-not-carried';
  what: string;
  /** Where a reader finds the thing the index could not hold. */
  insteadRead: string;
}
