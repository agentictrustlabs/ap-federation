// THE VERIFIER CONTAINER (spec 443 W5 / Ring 0 zkID Z4) — the Node verifier beside the door Worker, never inside it:
// the OpenAC 1k Prepare verifying key is 274 MB. One instance per door, named by the boundary id; it sleeps when idle
// and the first credential knock after a quiet hour pays the cold start. The Worker reaches it only as `POST /verify`
// and `GET /health`, under a secret it hands the Container at start. The chain endpoints the verifier reads (the
// issuer's chain, neutral ground) are the door's own secrets, passed through by the env names the register uses.
import { Container } from '@cloudflare/containers';

export class VerifierContainer extends Container<Record<string, unknown>> {
  override defaultPort = 8080;
  override sleepAfter = '1h';
  override enableInternet = true;
  override async fetch(req: Request): Promise<Response> {
    const secrets = this.env as Record<string, string | undefined>;
    if (!secrets.VERIFIER_SECRET) return new Response(JSON.stringify({ error: 'VERIFIER_SECRET is not set on the door' }), { status: 503, headers: { 'content-type': 'application/json' } });
    this.envVars = {
      VERIFIER_SECRET: secrets.VERIFIER_SECRET,
      ...Object.fromEntries(Object.entries(secrets).filter(([k, v]) => /_RPC_URL$/.test(k) && typeof v === 'string') as [string, string][]),
    };
    return super.fetch(req);
  }
}
