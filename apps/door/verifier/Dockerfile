# THE DOOR'S VERIFIER (spec 443 W5 / Ring 0 zkID Z4) — a Cloudflare Container beside the door Worker.
# Why a container: the OpenAC 1k Prepare verifying key is 274 MB; a Worker cannot hold it, so `verifierPlacement` is
# `node` and the receipt says so. wrangler builds this image on `deploy --env impact-agent` ([[env.impact-agent.containers]]).
# Build context = this directory: server.mjs, package.json and keys/ (fetched by ../../../scripts/fetch-openac-keys.sh,
# gitignored, ≈280 MB — the verifying halves only; the proving keys never enter a verifier).
# The packages come FROM NPM at the versions package.json pins (this repository is a consumer, ADR-0063).
FROM node:22-slim
WORKDIR /verifier
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock 2>&1 | tail -2
COPY keys/1k_prepare_verifying.key keys/1k_show_verifying.key /keys/
COPY server.mjs ./
ENV NODE_ENV=production PORT=8080 OPENAC_KEYS_DIR=/keys NODE_OPTIONS=--max-old-space-size=3072
EXPOSE 8080
CMD ["node", "server.mjs"]
