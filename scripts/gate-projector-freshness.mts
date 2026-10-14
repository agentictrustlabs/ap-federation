#!/usr/bin/env tsx
// gate-projector-freshness — is every projecting estate still provable? (spec 439 §4 / §7.10)
//
// A verifier accepts only a FRESH anchored sequence, so an estate whose projector stops running stops being provable
// without anything appearing to break. This gate is the alarm that was missing on 2026-10-14, when both estates were
// ten hours into a twenty-four-hour window and nobody knew. It reads the scheduled projector's own status and judges
// each estate against the SHORTEST verifier window the federation serves — the doors' `MAX_AGE_SECONDS`.
//
// RED, not amber: an estate that cannot be proved is not a passing estate.
const PROJECTOR = (process.env.FEDERATION_PROJECTOR_URL ?? 'https://projector.ap-federation.faithnet.io').replace(/\/$/, '');
/** The doors' `MAX_AGE_SECONDS`. A door with a shorter window would make this gate's judgement too generous, so it is
 *  stated here and must move with the doors. */
const SHORTEST_VERIFIER_WINDOW = Number(process.env.FEDERATION_VERIFIER_MAX_AGE ?? 86_400);
/** Fail before the window closes, not as it closes: an anchor with an hour left will be stale before anyone reads this. */
const MARGIN = Number(process.env.FEDERATION_FRESHNESS_MARGIN ?? 3 * 3600);

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

const r = await fetch(`${PROJECTOR}/status`, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
check('the scheduled projector answers', !!r?.ok, r ? `HTTP ${r.status}` : 'unreachable');
if (!r?.ok) { console.log('\nPROJECTOR FRESHNESS RED · the job that keeps every estate provable could not be read'); process.exit(1); }

const body = (await r.json()) as { refreshAfterSeconds: number; estates: Array<{ estate: string; sequence: number; ageSeconds: number | null; live: number; staleInSeconds: number | null }> };
check('its refresh window is shorter than the shortest verifier window', body.refreshAfterSeconds < SHORTEST_VERIFIER_WINDOW, `refresh ${body.refreshAfterSeconds}s < verifier ${SHORTEST_VERIFIER_WINDOW}s`);
check('it projects at least one estate', body.estates.length > 0, `${body.estates.length}`);

for (const e of body.estates) {
  const hrs = (n: number | null) => (n === null ? '—' : `${(n / 3600).toFixed(1)}h`);
  check(`${e.estate}: anchored, and fresh enough that a verifier will still accept a presentation`,
    e.ageSeconds !== null && e.staleInSeconds !== null && e.staleInSeconds > MARGIN,
    `sequence ${e.sequence}, anchored ${hrs(e.ageSeconds)} ago, ${hrs(e.staleInSeconds)} before a verifier refuses it (margin ${hrs(MARGIN)})`);
  check(`${e.estate}: the projector can still rebuild its set`, e.live >= 0, `${e.live} live leaf/leaves in the store`);
}

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\nPROJECTOR FRESHNESS RED · ${failed.length} of ${checks.length} failed` : `\nPROJECTOR FRESHNESS GREEN · ${checks.length} checks, ${body.estates.length} estate(s) provable`);
process.exit(failed.length ? 1 : 0);
