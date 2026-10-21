# Standalone web hosting

`npm run build:standalone` produces `dist-standalone/`, a dedicated multi-server
web client with a versioned application cache. A fresh profile opens server and
sync sign-in. Saved accounts are restored before that screen is shown.

The ordinary `npm run build` output remains the community-hosted client. It
restricts accounts to its hosting server. The standalone build uses browser
storage and networking; Electron integrations remain native-only.

## Cloudflare deployment

The **Deploy standalone web** GitHub Actions workflow builds and tests the client,
then publishes static assets to the `haunt-web` Worker on `workers.dev`. It runs
after **Client version** succeeds, using that push's generated version commit.
It can also be started manually. The workflow summary contains the public URL.

Configure these repository secrets:

- `CLOUDFLARE_API_TOKEN`: a Workers deployment token scoped to the destination account.
- `CLOUDFLARE_ACCOUNT_ID`: that account's ID.

Cloudflare serves application files and update metadata. Authentication, messages,
uploads, and calls connect directly to the chosen community servers. Each server
must include the standalone client's exact HTTPS origin in `HAUNT_CLIENT_ORIGINS`.
For full-account sync sign-in, set `HAUNT_SYNC_TRUSTED_CLIENT_ORIGINS` on the sync
service to that exact origin. Credentials remain scoped to the selected service;
no traffic proxy is included.

## Application caching and updates

The service worker caches the complete build, including its HTML, scripts,
styles, fonts, workers, WebAssembly and icons. API requests and authenticated
responses are excluded. Cached startup works without contacting the host.

Each build has an ID, release version and increasing numeric revision. Updates
are checked on startup, when returning to the application or reconnecting, and
every five minutes while visible. A newer build is downloaded and checked against
its asset hashes before activation. Activation reloads the client and removes
obsolete application caches. It does not clear accounts, message databases,
keys, preferences, or other caches. Reloading interrupts active calls.

An unavailable or incomplete update leaves the previous build usable. Older
revisions are not activated. Browser storage retention remains subject to the
browser's storage policy and the user's clearing of site data.

## Verification

`npm run test:standalone` serves the built artifact in headless Chrome and checks
first-run sync sign-in, offline reload, update activation, failed-update recovery,
API exclusion, downgrade rejection and local-data preservation using two compiled
builds. The deployment workflow repeats the startup and offline checks against
the public URL. Reports and screenshots are retained as workflow artifacts.
