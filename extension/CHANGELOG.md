# Changelog

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
