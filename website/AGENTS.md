# Website

## Tailwind dark mode

Dark mode uses `prefers-color-scheme` media query, configured in `globals.css`:

```css
@custom-variant dark (@media (prefers-color-scheme: dark));
```

### `@variant dark` rules

1. **Must be nested inside a selector**, never at the top level:

```css
/* WRONG - silently produces no output */
@variant dark {
  .my-class { color: white; }
}

/* CORRECT - nest inside the selector */
.my-class {
  @variant dark {
    color: white;
  }
}

/* CORRECT - define variables inside :root */
:root {
  @variant dark {
    --my-var: white;
  }
}
```

2. **Only works in CSS files that are part of the Tailwind compilation chain.** Files must be imported via CSS `@import` from `globals.css` (which has `@import "tailwindcss"`). JS/TS `import "file.css"` in route files does NOT go through Tailwind — `@variant dark` will silently fail.

```css
/* globals.css — this is the Tailwind entry point */
@import "tailwindcss";
@import "./editorial.css";       /* editorial page styles (class names, layout) */
@import "./editorial-prism.css"; /* prism syntax highlighting */
@custom-variant dark (@media (prefers-color-scheme: dark));
```

If you create a new CSS file that needs `@variant dark`, add it as a CSS `@import` in `globals.css`. Do NOT import it from a `.tsx` file.

### For many dark overrides, use CSS variables on `:root`

For files with many dark mode selectors (like prism syntax colors), define CSS variables in `:root { @variant dark { ... } }` and reference them in selectors. This avoids repeating `@variant dark` in every rule.

## Images must not cause layout shift

Every `<img>` must have explicit `width` and `height` attributes matching the intrinsic pixel dimensions of the source file. Add `style={{ height: "auto" }}` to keep it responsive. This lets the browser reserve the correct aspect ratio space before the image loads, preventing layout shift.

```tsx
<img src="/photo.png" width={1280} height={800} style={{ maxWidth: "100%", height: "auto" }} />
```

Use `sips -g pixelWidth -g pixelHeight <file>` to get dimensions on macOS.

## No localStorage dark mode toggle

There is no JS-based `.dark` class toggle. Do not add inline scripts to toggle `.dark` on `<html>`. The site follows the OS preference only via `prefers-color-scheme`.
