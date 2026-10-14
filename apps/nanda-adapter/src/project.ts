// PROJECT AN AP AGENT INTO THE NANDA INDEX — spec 439 F4, and nothing more than a projection.
//
// In: a released A2A card (spec 347), the publisher's verified domain, and a short name. Out: one index entry of
// media type `application/a2a-agent-card+json` pointing at the card's own URL, plus a LOSS REPORT naming everything
// the index cannot carry. Pure: no network, no key, no state, no clock.
//
// THE THREE REFUSALS, which are the point:
//   1. It never projects AUTHORITY. A delegation, a mandate, a standing presentation and a receipt have no field here
//      and never will: an index entry is a listing (ADR-0056), and §3.1's sentence does not bend for a directory.
//   2. It never INVENTS a vocabulary. The identifier is ARD's URN, which Ring 0 already pins; the media type is one
//      of the five the index publishes. A field we cannot source from the card is absent, never guessed.
//   3. It never claims MEMBERSHIP. The output is an entry someone may publish; publishing it makes an AP agent
//      listed, not a NANDA town's member (spec 439 §5).
import { NANDA_MEDIA_TYPE, type A2aCardLike, type NandaIndexEntryV1, type ProjectionLossV1 } from './types.js';

/** ARD's `urn:air:<publisher-FQDN>:<namespace>:<short-name>`, as the index requires it. */
export const AIR_URN = /^urn:air:[a-z0-9.-]+:[a-z0-9-]+:[a-z0-9._@-]+$/;
/** A publisher FQDN must be a domain — the index verifies ownership of it, so a host that is not one cannot be it. */
const FQDN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const SHORT_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface ProjectInput {
  /** The agent's RELEASED card, exactly as served at its well-known URL. */
  card: A2aCardLike;
  /** Where that card is served. The entry points at it; the index never holds a copy. */
  cardUrl: string;
  /** The domain the publisher verified at the index (the estate's zone, usually). */
  publisherDomain: string;
  /** The agent's short name within that domain — the URN's last segment. */
  shortName: string;
  /** For the publisher's display name; falls back to the domain. */
  publisherDisplayName?: string;
  /** Recorded under our own extension namespace so a reader can get back to the real record. Evidence, never authority. */
  canonical?: { agentId?: string; estate?: string; chainId?: number; cardDigest?: string };
}

export type ProjectResult =
  | { ok: true; entry: NandaIndexEntryV1; loss: ProjectionLossV1[] }
  | { ok: false; refusals: string[] };

/**
 * One entry, or a refusal saying which inputs were not fit to publish. A projection that guessed a field would be
 * publishing a claim nobody made.
 */
export function projectToIndexEntry(input: ProjectInput): ProjectResult {
  const refusals: string[] = [];
  const domain = (input.publisherDomain ?? '').trim().toLowerCase();
  const shortName = (input.shortName ?? '').trim().toLowerCase();
  const url = (input.cardUrl ?? '').trim();
  const name = (input.card?.name ?? '').trim();

  if (!FQDN.test(domain)) refusals.push(`publisherDomain "${input.publisherDomain}" is not a domain — the index verifies ownership of one, and a host that is not a domain cannot publish`);
  if (!SHORT_NAME.test(shortName)) refusals.push(`shortName "${input.shortName}" is not a URN segment (lower-case letters, digits and hyphens)`);
  if (!/^https:\/\//.test(url)) refusals.push('cardUrl must be an https URL — the entry points at the card, and a card nobody can fetch lists nothing');
  if (!name) refusals.push('the card has no name');
  if (refusals.length) return { ok: false, refusals };

  const identifier = `urn:air:${domain}:agent:${shortName}`;
  if (!AIR_URN.test(identifier)) return { ok: false, refusals: [`the identifier "${identifier}" is not an ARD URN`] };

  // THE LOSS REPORT. Each line is a thing the index has no field for, and where a reader finds it instead.
  const loss: ProjectionLossV1[] = [];
  if (Array.isArray(input.card.signatures) && input.card.signatures.length) {
    loss.push({ code: 'signature-not-carried', what: `the card's ${input.card.signatures.length} JWS signature(s)`, insteadRead: `the card itself at ${url} — the index entry is a pointer, and verifying the card is the reader's own act` });
  }
  if (input.canonical?.agentId) {
    loss.push({ code: 'canonical-identity-not-carried', what: `the canonical Smart Agent ${input.canonical.agentId}`, insteadRead: 'the card, and the chain it names — an index identifier is a name, never the identity (ADR-0010)' });
  }
  loss.push({ code: 'authority-not-carried', what: 'every grant, mandate, standing presentation and receipt this agent holds or has issued', insteadRead: "the estate's own door — being listed authorizes nothing (ADR-0056), and nothing here was translated into a permission" });
  if (input.canonical?.estate || input.canonical?.chainId) {
    loss.push({ code: 'estate-not-carried', what: `the estate (${input.canonical.estate ?? '?'}) and chain (${input.canonical.chainId ?? '?'}) this agent belongs to`, insteadRead: "the card's provider and the estate's register — the index has one publisher field, and it is a domain" });
  }
  const skills = input.card.skills ?? [];
  if (skills.length) {
    loss.push({ code: 'skill-detail-not-carried', what: `what each of the ${skills.length} skill(s) requires to run, and what it refuses`, insteadRead: `the card's skills at ${url}, and the agent's own refusal when asked — an index entry has no place for an authorisation requirement` });
  }
  if (input.card.capabilities && Object.keys(input.card.capabilities).length) {
    loss.push({ code: 'capabilities-not-carried', what: "the card's protocol capabilities (streaming, push, transports)", insteadRead: `the card at ${url}` });
  }

  // Tags come from the skills' own tags, deduplicated and bounded. A tag is a word the agent already published.
  const tags = [...new Set(skills.flatMap((s) => (s.tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)))].sort().slice(0, 12);

  const entry: NandaIndexEntryV1 = {
    identifier,
    displayName: name,
    type: NANDA_MEDIA_TYPE.a2aAgentCard,
    url,
    ...(input.card.description ? { description: String(input.card.description).trim() } : {}),
    ...(tags.length ? { tags } : {}),
    publisher: { identifier: domain, displayName: (input.publisherDisplayName ?? input.card.provider?.organization ?? domain).trim(), identityType: 'domain' },
    extensions: {
      // OUR namespace, never theirs: `org.projectnanda` is the index's own and we do not write into it.
      'dev.agenticprimitives': {
        cardUrl: url,
        ...(input.card.version ? { cardVersion: input.card.version } : {}),
        ...(input.canonical?.agentId ? { canonicalAgentId: input.canonical.agentId } : {}),
        ...(input.canonical?.estate ? { estate: input.canonical.estate } : {}),
        ...(input.canonical?.chainId ? { chainId: input.canonical.chainId } : {}),
        ...(input.canonical?.cardDigest ? { cardDigest: input.canonical.cardDigest } : {}),
        // Said in the record itself, so a reader of the index does not have to take our word for it elsewhere.
        authority: 'none — this entry is a listing; whether this agent may act is decided at its estate, per step, under a mandate its principal signed',
        lossReportCodes: loss.map((l) => l.code),
      },
    },
  };
  return { ok: true, entry, loss };
}

/** The reverse read: what an index entry tells us, and loudly what it does not. Never used to decide anything. */
export function readIndexEntry(entry: NandaIndexEntryV1): { identifier: string; publisherDomain: string; url: string; isApCard: boolean; says: string } {
  return {
    identifier: entry.identifier,
    publisherDomain: entry.publisher?.identifier ?? '',
    url: entry.url,
    isApCard: entry.type === NANDA_MEDIA_TYPE.a2aAgentCard,
    says: 'that a publisher who verified this domain listed this artifact. It is not evidence that the artifact is genuine (fetch and verify the card), nor that its agent may do anything (that is its estate\'s decision).',
  };
}
