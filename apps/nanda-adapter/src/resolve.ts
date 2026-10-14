// READING THE INDEX THE WAY A STRANGER WOULD — spec 439 §5's discovery row, and ADR-0040's posture applied to
// someone else's directory: a listing is a claim, and checking it is the reader's own act.
//
// An entry says a publisher who verified a domain listed an artifact at a URL. That is all it says. So a reader that
// wants more fetches the artifact and judges it, and this module does exactly that and reports what it found —
// including the two things the live index (read 2026-10-14, 80 entries) shows are usual rather than exceptional:
//
//   · ALMOST NOTHING IS SIGNED. Of the 29 A2A-card entries, 21 answered and 2 carried a signature. So for most of
//     them "is this the card its agent published?" is a question nothing on the wire answers, and a reader that
//     treats a fetched card as authentic has substituted reachability for authenticity. (A first six-card sample
//     said "none", which was a sample talking; the number above is the whole set, and the check is per entry
//     regardless — this module never generalises from a count.)
//   · THE CARD IS OFTEN NOT SERVED FROM THE PUBLISHER'S DOMAIN (17 of 29 were; the rest were not). An entry whose
//     identifier names `sunrisetours.com` is served from `agentcards.host39.org`. That is allowed there — the index
//     verifies that a publisher owns the domain in its URN, not that the domain serves the artifact — but it means
//     the host is not the publisher, and a reader that conflates them has trusted a party the index never vouched for.
//
// None of this is a complaint: it is what a verifier must know before it decides anything. We report it per entry and
// never let it decide for us — nothing here produces authority, and an AP agent asked to act still answers from its
// own estate, under its own mandate (§3.1).
import { NANDA_MEDIA_TYPE, type A2aCardLike, type NandaIndexEntryV1 } from './types.js';

/** What a reader checked, and what each check answers. Never a score (spec 346 §8.3: separate signals). */
export interface ResolutionAssessmentV1 {
  identifier: string;
  /** The domain the index says the publisher verified — the URN's publisher FQDN. */
  publisherDomain: string;
  /** The host actually serving the artifact. */
  servedBy: string | null;
  /** Did the artifact answer at all? */
  reachable: boolean;
  /** Is the artifact the media type the entry claims? For an A2A card: does it parse and name itself? */
  shapeMatches: boolean | null;
  /** Does the serving host sit under the publisher's domain? `false` is COMMON there and is not a fault — it is a
   *  different party, and a reader should know which one it fetched from. */
  servedByPublisher: boolean | null;
  /** Does the artifact carry a signature a reader could verify? In that index on 2026-10-14: 2 of the 21 that answered. */
  signed: boolean | null;
  /** Plain sentences, in the order a reader should weigh them. */
  notes: string[];
  /** What this assessment is NOT evidence of. Said every time, because the omission is what gets forgotten. */
  saysNothingAbout: string[];
}

const hostOf = (url: string): string | null => { try { return new URL(url).host.toLowerCase(); } catch { return null; } };
const underDomain = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);
/** `urn:air:<publisher-FQDN>:<namespace>:<short-name>` — the publisher is the third segment. */
export function publisherOfUrn(identifier: string): string | null {
  const m = /^urn:air:([a-z0-9.-]+):[a-z0-9-]+:.+$/.exec((identifier ?? '').toLowerCase());
  return m ? m[1]! : null;
}

export interface FetchedArtifact { ok: boolean; status: number | null; body: unknown; error?: string }

/** Pure: the entry, and what fetching its URL produced. No network here, so a test is a table. */
export function assessResolution(entry: NandaIndexEntryV1, fetched: FetchedArtifact | null): ResolutionAssessmentV1 {
  const publisherDomain = publisherOfUrn(entry.identifier) ?? (entry.publisher?.identifier ?? '').toLowerCase();
  const servedBy = entry.url ? hostOf(entry.url) : null;
  const notes: string[] = [];
  const isCard = entry.type === NANDA_MEDIA_TYPE.a2aAgentCard;

  if (!entry.url) notes.push('the entry carries no URL, so there is nothing to fetch and nothing to check');
  const reachable = !!fetched?.ok;
  if (entry.url && !reachable) notes.push(`the artifact did not answer (${fetched?.error ?? `HTTP ${fetched?.status ?? '?'}`}) — a listing outlives what it lists`);

  const card = reachable && fetched && typeof fetched.body === 'object' && fetched.body ? (fetched.body as A2aCardLike) : null;
  const shapeMatches = !reachable ? null : isCard ? !!(card && typeof card.name === 'string' && card.name.trim()) : null;
  if (shapeMatches === false) notes.push('the artifact answered but is not the shape the entry claims — the type in an entry is the publisher\'s word, not a check');

  const servedByPublisher = servedBy && publisherDomain ? underDomain(servedBy, publisherDomain) : null;
  if (servedByPublisher === false) notes.push(`the entry names ${publisherDomain} as its publisher, but the artifact is served by ${servedBy} — the index verifies that a publisher owns its domain, never that the domain serves the artifact. You fetched from a party the index did not vouch for`);

  const signed = card ? Array.isArray(card.signatures) && card.signatures.length > 0 : null;
  if (signed === false) notes.push('the card carries no signature, so nothing here establishes that this card is the one its agent published — reachability is not authenticity');
  if (signed === true) notes.push('the card carries a signature — verify it against the agent\'s own key before relying on any field in it');

  return {
    identifier: entry.identifier,
    publisherDomain,
    servedBy,
    reachable,
    shapeMatches,
    servedByPublisher,
    signed,
    notes,
    saysNothingAbout: [
      'whether this agent may do anything — that is its own estate\'s decision, per step, under a mandate its principal signed (ADR-0056)',
      'whether the party behind it is who the display name suggests',
      'whether the capabilities the artifact advertises will be honoured when asked',
    ],
  };
}

/** The one impure step, injected so the assessment stays testable. */
export async function fetchArtifact(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): Promise<FetchedArtifact> {
  try {
    const r = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { ok: r.ok && body !== null, status: r.status, body, ...(r.ok && body === null ? { error: 'the artifact is not JSON' } : {}) };
  } catch (e) {
    return { ok: false, status: null, body: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A survey over many assessments — counts, never a verdict about any one publisher. */
export function surveyResolutions(rows: readonly ResolutionAssessmentV1[]): { total: number; reachable: number; signed: number; servedByPublisher: number; shapeMismatch: number; says: string } {
  const n = (f: (r: ResolutionAssessmentV1) => boolean) => rows.filter(f).length;
  return {
    total: rows.length,
    reachable: n((r) => r.reachable),
    signed: n((r) => r.signed === true),
    servedByPublisher: n((r) => r.servedByPublisher === true),
    shapeMismatch: n((r) => r.shapeMatches === false),
    says: 'counts of what was checked, over the entries fetched. Nothing here ranks a publisher, and nothing here authorizes anything.',
  };
}
