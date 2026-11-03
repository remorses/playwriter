---
'playwriter': patch
---

**Headless mode keeps the Chromium sandbox on**: `--browser headless` launched Chrome through `chromium.launch()` without `chromiumSandbox`, and Playwright then adds `--no-sandbox`. Headless sessions now run sandboxed, so a page that exploits a Chrome bug stays inside the renderer sandbox. Linux as root (Docker) keeps the old behaviour, since Chromium cannot start sandboxed there.
