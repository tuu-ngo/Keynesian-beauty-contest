---
name: neobrutalism-design
description: Use when building or restyling any UI, page, artifact, mockup or component in a neobrutalist style: thick black borders, hard offset shadows, flat loud colors, bold type.
---

# Neobrutalism Design

Neobrutalism is raw and loud, but it is intentional. It uses flat, saturated color, heavy black outlines, hard shadows with no blur, and chunky type. The look should feel playful and confident without becoming chaotic. Every element should look like a cut-out sticker pressed onto paper.

Apply this skill to HTML/CSS, React, Tailwind, SVG, slides or any visual output when the user asks for neobrutalism, neo-brutalist, "brutalist but colorful", or the Gumroad/Figma-community style.

## Core rules (never break these)

1. **Hard borders.** Every surface (cards, buttons, inputs, images, badges, nav) has a solid border, 2–4px, in near-black `#000` or `#111`. Use one weight consistently: 3px is the default.
2. **Hard offset shadows.** `box-shadow: Xpx Ypx 0 0 #000`. Zero blur, zero spread, always down-right. Default `4px 4px`; large hero elements `6px 6px` or `8px 8px`. Never use soft or blurred shadows.
3. **Flat color.** No gradients, no glassmorphism, no transparency effects, no glows. Fills are solid.
4. **Bold type.** Headings are heavy (700–900) and large. Body text is a clean sans in black.
5. **Small or no radius.** Use `0`, `4px` or `8px`. Pick one and stay consistent. Pills (`9999px`) only for tags/badges.
6. **Black text on bright colors.** Text is almost always `#000` on colored fills, which keeps contrast high.

## Design tokens

Define tokens on `:root` and reuse them everywhere.

```css
:root {
  /* Surfaces */
  --nb-bg: #FFFDF5;          /* warm off-white page */
  --nb-surface: #FFFFFF;
  --nb-ink: #000000;         /* borders, text, shadows */
  --nb-muted: #3D3D3D;

  /* Accent palette: pick 1 primary + 1–2 secondaries per screen */
  --nb-yellow: #FFDE59;
  --nb-pink: #FF90E8;
  --nb-cyan: #A6FAFF;
  --nb-green: #B8FF9F;
  --nb-orange: #FF9F5A;
  --nb-lavender: #C4A1FF;
  --nb-red: #FF6B6B;
  --nb-blue: #69A1FF;

  /* Structure */
  --nb-border: 3px solid var(--nb-ink);
  --nb-radius: 6px;
  --nb-shadow-sm: 2px 2px 0 0 var(--nb-ink);
  --nb-shadow: 4px 4px 0 0 var(--nb-ink);
  --nb-shadow-lg: 8px 8px 0 0 var(--nb-ink);

  /* Type */
  --nb-font-display: 'Archivo Black', 'Space Grotesk', system-ui, sans-serif;
  --nb-font-body: 'Space Grotesk', 'Public Sans', system-ui, sans-serif;
  --nb-font-mono: 'Space Mono', ui-monospace, monospace;
}
```

**Color usage:** limit each screen to one dominant accent plus one or two supporting accents. Large areas use the off-white background; color goes on cards, buttons, badges and section bands. Avoid putting every accent on one screen unless the brief explicitly wants a riot.

**Fonts:** load from Google Fonts. Good pairings:
- Archivo Black (display) + Space Grotesk (body)
- Lexend Mega (display) + Public Sans (body)
- Space Grotesk 700 for both, with Space Mono for labels

## Typography scale

- Hero: `clamp(2.5rem, 6vw, 5rem)`, weight 900, line-height 1.0, letter-spacing -0.02em. Uppercase is optional.
- H2: `2rem–2.75rem`, weight 800.
- H3: `1.25rem–1.5rem`, weight 700.
- Body: `1rem–1.125rem`, weight 500, line-height 1.5.
- Labels/eyebrows: mono or uppercase, `0.75rem–0.875rem`, letter-spacing 0.08em.
- Highlight words by putting them on a colored block: `background: var(--nb-yellow); padding: 0 .2em; border: var(--nb-border);` (optionally rotated -1deg).

## Interaction (the signature move)

Elements press *into* their shadow.

```css
.nb-interactive {
  border: var(--nb-border);
  box-shadow: var(--nb-shadow);
  transition: transform 100ms ease, box-shadow 100ms ease;
}
.nb-interactive:hover {
  transform: translate(2px, 2px);
  box-shadow: var(--nb-shadow-sm);
}
.nb-interactive:active {
  transform: translate(4px, 4px);
  box-shadow: none;
}
.nb-interactive:focus-visible {
  outline: 3px solid var(--nb-ink);
  outline-offset: 3px;
}
```

The translate distance must equal the shadow shrink so the element looks physically pushed. Keep transitions fast (80–150ms). Respect `prefers-reduced-motion` by removing the transform.

## Components

**Button**
```css
.nb-btn {
  font: 700 1rem/1 var(--nb-font-body);
  padding: 0.875rem 1.5rem;
  background: var(--nb-yellow);
  color: var(--nb-ink);
  border: var(--nb-border);
  border-radius: var(--nb-radius);
  box-shadow: var(--nb-shadow);
  cursor: pointer;
}
```
Secondary button: white fill. Destructive: `--nb-red`. Disabled: `#E5E5E5` fill, no shadow, no hover movement.

**Card**
```css
.nb-card {
  background: var(--nb-surface);
  border: var(--nb-border);
  border-radius: var(--nb-radius);
  box-shadow: var(--nb-shadow);
  padding: 1.5rem;
}
```
Vary card fills across a grid using the accent palette. A card header can be a colored band separated by a bottom border.

**Input / textarea / select**
White fill, full border, `--nb-shadow-sm`. On focus, switch shadow to `--nb-shadow` and fill to a pale accent (e.g. `#FFF6C7`). Labels sit above in bold.

**Badge / tag**
Pill or square, 2px border, accent fill, uppercase mono text, no shadow or `--nb-shadow-sm`.

**Navigation**
Top bar with a bottom border (3px), off-white or accent fill. Nav links are bold; active link gets an accent background block with a border.

**Images & media**
Always bordered, with `--nb-shadow`. Use flat illustrations, cut-out photos, or bold icons (Lucide/Phosphor at stroke 2–2.5). Avoid soft photographic vignettes.

**Tables**
3px outer border, 2px inner rules, header row on an accent fill with bold uppercase text. Zebra striping with a pale accent if needed.

**Modals / toasts**
Same card treatment with `--nb-shadow-lg`. Overlay is a solid color at moderate opacity (e.g. `rgba(0,0,0,.5)`) — no blur.

## Layout & decoration

- Generous spacing on an 8px grid. Chunky elements need room to breathe.
- Asymmetry is welcome: offset a card, rotate a sticker `-2deg` to `3deg`, overlap a badge onto a corner.
- Section bands: full-width colored strips with top and bottom borders.
- Optional textures: a dot or square grid background (`background-image` with 1px lines at low opacity), a scrolling marquee strip, star/burst SVG stickers.
- Use rotation and overlap sparingly — one or two moments per screen, not every element.

## Dark mode

- Background `#121212` or `#1A1A1A`; surfaces `#222`.
- Borders and shadows switch to off-white `#F5F5F5` *or* keep black borders while accent-filled surfaces carry the contrast. Pick one approach.
- Accent colors stay bright; text on accents stays black.

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --nb-bg: #1A1A1A;
    --nb-surface: #262626;
    --nb-ink: #F5F5F5;
    --nb-muted: #BDBDBD;
  }
}
```
When `--nb-ink` flips to light, set text on accent fills explicitly to `#000`.

## Tailwind mapping

- Border: `border-[3px] border-black`
- Shadow: `shadow-[4px_4px_0_0_#000]`
- Hover: `hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_#000]`
- Active: `active:translate-x-[4px] active:translate-y-[4px] active:shadow-none`
- Radius: `rounded-md` or `rounded-none`
- Extend the theme with the palette above (`nb-yellow`, `nb-pink`, etc.).

## Accessibility

- Black text on the listed accents passes WCAG AA. Do not put white text on yellow, cyan, green or pink.
- Never rely on color alone; pair status colors with icons or labels.
- Keep visible focus states (thick outline with offset).
- Honor `prefers-reduced-motion`: disable transforms and marquees.
- Rotated text should stay short and decorative, not essential content.

## Anti-patterns

- Blurred, soft or colored shadows
- Gradients, glassmorphism, neumorphism, translucent blur
- Thin 1px hairline borders, or borders on some elements but not others
- Mixing radius values randomly
- Every accent color on every element
- Light gray text on bright fills
- Thin or light-weight fonts for headings
- Shadows pointing in different directions

## Final checklist

Before delivering, confirm:
- [ ] Every surface has the same border weight in ink color
- [ ] All shadows are hard, unblurred, and point the same direction
- [ ] Interactive elements press into their shadow on hover/active
- [ ] One dominant accent per screen, plus 1–2 supporting
- [ ] Headings are heavy and large; body is readable
- [ ] Radius is consistent
- [ ] Contrast passes, focus states are visible, reduced motion is respected
- [ ] Layout works at phone width with no horizontal scroll
