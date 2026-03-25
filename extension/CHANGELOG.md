# Changelog

## 0.0.78

### Changes

- **Skip welcome tab in packaged automation builds**: Added a build-time flag so the extension copy bundled into the Playwriter CLI does not auto-open `welcome.html` on install. Regular dev/test extension builds still keep the welcome page.

## 0.0.77

### Changes

- **Use `workspace:^` for local Playwriter dependency**: Switched `playwriter` from `workspace:*` to `workspace:^` in `extension/package.json` to avoid pinned workspace versions when package metadata is packed.

## 0.0.76

### Bug Fixes

- **Write Prism assets to the active extension output directory**: `scripts/download-prism.ts` now respects `PLAYWRITER_EXTENSION_DIST` instead of always writing to `dist/src`. This fixes release builds (`dist-release`) missing `prism.min.js` and `prism-bash.min.js` used by `welcome.html`.

## 0.0.75

### Changes

- **Remove `alarms` permission and keepalive**: Removed `chrome.alarms` keepalive added in 0.0.73. The `maintainLoop` while-loop and `setInterval(checkMemory)` already keep the service worker alive. The alarm was a no-op that required an unnecessary permission.

## 0.0.74

### Bug Fixes

- **Fix Target.detachFromTarget routing on root CDP session**: Commands sent without a top-level sessionId (e.g. from Playwright's root browser session) now resolve the target tab via `params.sessionId` fallback. Previously the extension threw "No tab found" which caused cascading disconnects and instability. (#40)
- **No-op stale Target.detachFromTarget**: Unknown or already-cleaned-up sessions return `{}` instead of throwing, preventing error cascading during rapid connect/disconnect cycles.
- **Always re-apply tab group color**: Tab group title and color are now re-applied on every sync to prevent Chrome from resetting them to white/unlabeled.

## 0.0.73

### Bug Fixes

- **Service worker keepalive via chrome.alarms**: Added `chrome.alarms` keepalive to prevent Chrome MV3 from terminating the service worker when idle. Without this, the `maintainLoop` stops, the WebSocket closes, and the extension silently disconnects from the relay server — causing `session new` to fail with "Extension did not connect within timeout."

## 0.0.72

### Bug Fixes

- **Use runtime-scoped root CDP tab session IDs**: Root tab sessions now use `pw-tab-<scope>-<n>` instead of `pw-tab-<n>`, where scope is a random value generated once per extension runtime. This prevents session ID collisions across multiple connected Chrome profiles.

## 0.0.71

### Bug Fixes

- **Route Runtime.enable to child CDP sessions**: Runtime enable/disable now uses the incoming `sessionId` when targeting OOPIF child sessions instead of always using the tab root session. This fixes missing `Runtime.executionContextCreated` events for child iframe targets, which could cause iframe locator operations to hang.

## 0.0.69

### Features

- **First extension keeps connection**: When multiple Playwriter extensions are installed, the actively-used one (with tabs) now keeps the connection. New extensions are rejected with code 4002 instead of taking over.
- **Smarter reconnection**: Extension now polls `/extension/status` for `activeTargets` count and only attempts reconnection when the other extension has no active tabs.

### Bug Fixes

- **Proper state handling for 4002 rejection**: Fixed issue where extension would keep retrying forever when rejected during WebSocket handshake. Now correctly enters `extension-replaced` polling state.

## 0.0.68

### Bug Fixes

- **Improved connection reliability**: Use `127.0.0.1` instead of `localhost` to avoid DNS/IPv6 resolution issues
- **Global connection timeout**: Added 15-second global timeout wrapper around `connect()` to prevent hanging forever when individual timeouts fail
- **Better WebSocket handling**: Added `settled` flag to properly handle timeout/open/error/close race conditions

### Changes

- **Faster retry loop**: Reduced retry attempts from 30 to 5 since `maintainLoop` retries every 3 seconds anyway
- **Allow own extension pages**: Added `OUR_EXTENSION_IDS` to allow attaching to our own extension pages while blocking other extensions

## 0.0.67

- Initial changelog
