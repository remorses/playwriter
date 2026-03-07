# Changelog

## 0.0.77

### Bug Fixes

- **Fix tab group flapping causing tab disconnects with multiple sessions**: When two sessions existed with different group names (e.g. "hackernews explorer" and "reddit explorer"), broadcast CDP commands like `Target.setAutoAttach` would overwrite unrelated tabs' group metadata with the sender's session group. This caused `syncTabGroup` to continuously shuffle tabs between groups, and the temporary `chrome.tabs.ungroup()` during the move fired `onUpdated` with `groupId=-1`, which the handler misinterpreted as a manual removal — disconnecting the tab. Fixed by:
  - Only applying group metadata on `Target.createTarget` (tab creation), not on every CDP command
  - Adding a `tabsBeingMoved` guard set so `syncTabGroup`'s programmatic ungroup/regroup doesn't trigger disconnects
  - Narrowing the store subscriber to only trigger `syncTabGroup` on group-relevant field changes (state, groupName, groupColor), not unrelated tab field updates

## 0.0.76

### Bug Fixes

- **Fix tab group color not applying (white group)**: `chrome.tabGroups.update()` can race with `chrome.tabs.group()` — Chrome hasn't fully initialized the group internally when the update runs, leaving it with the default grey/white color. Added retry logic with verification: after each update attempt, the actual group color is read back and compared; if it doesn't match, the update is retried with increasing delays (up to 2 retries).

## 0.0.75

### Features

- **Custom tab group names and colors**: Sessions can now specify a custom Chrome tab group name and color. Tabs from different sessions with different names are placed in separate Chrome tab groups. The relay forwards `groupName` and `groupColor` in every `forwardCDPCommand`, and the extension manages multiple groups accordingly. Default behavior (single "playwriter" green group) is unchanged when no custom name/color is set.

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
