---
'playwriter': patch
---

Keep recording and streaming frames at a fixed sample aspect ratio when the viewport changes, preventing NVIDIA NVENC encoder crashes.

Start the screencast before taking the seed screenshot, and accept the first live frame without waiting for a slow screenshot. Static pages still use the screenshot as a fallback.

Fixes #137
