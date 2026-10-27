# Standalone web hosting

`npm run build:standalone` produces `dist-standalone/`, a dedicated multi-server
web client with a versioned application cache. A fresh profile opens server and
sync sign-in. Saved accounts are restored before that screen is shown.

The ordinary `npm run build` output remains the community-hosted client. It
restricts accounts to its hosting server. The standalone build uses browser
storage and networking; Electron integrations remain native-only.

## Cloudflare deployment

The hub's **Hub stable release** workflow builds and tests standalone web with the
other release targets. Deployment loads that verified artifact instead of
rebuilding a moving branch. Development web builds are downloadable archives and
do not deploy to the production Worker.

Configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the hub repository.
The component's manual deployment workflow remains available for maintenance.

Cloudflare serves application files and update metadata. Authentication, messages,
uploads, and calls connect directly to the chosen community servers. The configured public origin lives in `web-deployment.json`. Server and sync
builds compile that origin into their trusted-client configuration.
Local builds and additional hosts can use `HAUNT_CLIENT_ORIGINS` on community
servers and `HAUNT_SYNC_TRUSTED_CLIENT_ORIGINS` on sync services. Credentials
remain scoped to the selected service; no traffic proxy is included.

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
