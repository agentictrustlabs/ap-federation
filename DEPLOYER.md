# DEPLOYER — who deploys what (spec 399 §5.5 / §10)

Two deployers must never both believe they own a live environment. This file names, per app and per
environment, which repository is the deployer of record.

## Nothing yet (F0, 2026-10-13)

`ap-federation` deploys **no environment today**. The repository shape exists; the jobs do not. When they
land, each gets a row here before its first deploy, never after:

| App | Environment | Worker / host | Deployer of record | Since |
| --- | --- | --- | --- | --- |
| `apps/projector` (F1) | per town | — | ap-federation | — |
| `apps/nanda-adapter` (F4) | per town | — | ap-federation | — |

## What this repository must never deploy

- **Any estate's Workers or Home.** Those are the estate's repository's (`ap-home` for faithnet and imbnet;
  its `DEPLOYER.md` is the record). A federation job reaches an estate over its PUBLIC surfaces — the A2A
  door, the registry, the public KB — and never by deploying into it.
- **Any town service.** The registry, naming, public graph, discovery and chain gateway deploy from `ap-town`.

The lesson that rule is written from: on 2026-10-13 three Ring-0-era copies of faithnet's Workers still
carried `[env.faithnet]` in a sibling repository, so a deploy from either tree landed on the same live
Worker — and a stale `EXECUTORS` var went back into production that way. **One deployer per environment. If a
Worker name appears in two repositories, one of them is wrong.**

## Neutral ground is not an estate

The `EstateProjectionRegistry` lives on a public chain shared by every participating town (Base Sepolia
today; the public L2 of spec 407 D-03 when it lands). It is not any town's deployment and must not be treated
as one: a town that could redeploy the registry it proves itself against has defeated the point of proving.
Its address, its governance and its upgrade path belong in a published record before the second town joins.
