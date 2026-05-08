# Design System Specification: The Neon Noir Dashboard

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Digital Luminary."**

This system moves beyond the sterile, utility-first nature of traditional admin dashboards to create a high-contrast, editorial experience. It draws inspiration from cinematic "cyber-noir" aesthetics—combining the heavy, atmospheric depth of deep charcoal foundations with the precision of neon light.

To break the "template" look, we employ **intentional asymmetry** and **tonal layering**. Elements are not merely placed on a grid; they are submerged in a dark environment where light (color) serves as the primary navigator. By utilizing glassmorphism and atmospheric glows, we transform a data-heavy interface into a premium, immersive workspace that feels alive and reactive.

---

## 2. Colors
Our palette is anchored in deep, ink-like foundations to allow neon accents to achieve maximum perceptual "pop."

### Foundation & Surfaces
- **Background:** `#0a0e14` (Deep Navy-Charcoal)
- **Surface (Base):** `#0a0e14`
- **Surface Container Low:** `#0f141a`
- **Surface Container High:** `#1b2028`
- **Surface Bright:** `#262c36` (Used for active, elevated states)

### The Neon Accents
- **Primary (Electric Cyan):** `#81ecff` — Domande / Quiz. Usato per: question snapshots, contenuti quiz, pulsanti primari.
- **Secondary (Neon Magenta):** `#e966ff` — Punteggi / Score. Usato per: score entries, archivi punteggi, stati draft.
- **Tertiary (Lime Green):** `#c2ff99` — Studenti / Classi. Usato per: classi, studenti, stati attivi, azioni di conferma.
- **Error (Vibrant Orange/Red):** `#ff716c` — Critical alerts and destructive actions.

### Mappatura colori → tipi dato (vincolante)
| Colore | Token | Dominio | Esempi |
|--------|-------|---------|--------|
| Cyan | `primary` | Domande | Snapshot card, quiz editor, pulsante "Nuova sessione" |
| Magenta | `secondary` | Punteggi | Score card, archivio punteggi, bozze |
| Verde | `tertiary` | Studenti | Classi card, lista studenti, stato "attivo" |

Questa mappatura era presente nel sistema v2.6.0 originale (AdminDashboardPage: text-primary per questions, text-secondary per scores, text-tertiary per students) e DEVE essere mantenuta in ogni pagina della nuova piattaforma.

### Creative Color Rules
* **The "No-Line" Rule:** 1px solid borders are strictly prohibited for structural sectioning. Separation must be achieved through background shifts (e.g., placing a `surface_container_low` card against the `background`).
* **Surface Hierarchy & Nesting:** Treat the UI as layers of frosted glass. An inner metric card should use `surface_container_highest` to sit "above" a `surface_container_low` dashboard section.
* **The "Glass & Gradient" Rule:** Use `backdrop-blur: 12px` and 40% opacity on surface colors for floating panels. Main CTAs should utilize a subtle linear gradient from `primary` to `primary_dim` to add dimensional "soul."

---

## 3. Typography
We utilize a dual-font strategy to balance technical precision with modern editorial flair.

* **Display & Headlines (Space Grotesk):** A geometric sans-serif with idiosyncratic "tech" details.
* *Role:* High-level metrics, page titles. It signals authority and a modern edge.
* *Scale:* `display-lg` (3.5rem) for hero numbers; `headline-md` (1.75rem) for section titles.
* **Body & Labels (Manrope):** A clean, highly legible modern sans-serif.
* *Role:* Data labels, secondary descriptions, and button text.
* *Scale:* `body-md` (0.875rem) for standard text; `label-sm` (0.6875rem) for uppercase meta-data.

**Hierarchy Strategy:** Use `primary` or `secondary` neon colors for specific headline accents to draw the eye, while keeping `on_surface_variant` (#a8abb3) for secondary labels to maintain a high-end, balanced contrast.

---

## 4. Elevation & Depth
Depth is created through light and transparency, not heavy shadows.

* **Tonal Layering:** Instead of structural lines, stack containers. A `surface_container_lowest` (#000000) header creates a "recessed" look, while `surface_container_high` (#1b2028) elements appear to float toward the user.
* **Ambient Glows:** For critical "Active" states or floating cards, use a tinted shadow. For a Primary card, use a shadow with the `primary` token color at 8% opacity and a 24px blur. This mimics the light spill of a neon sign.
* **The "Ghost Border" Fallback:** Where containment is vital (e.g., input fields), use the `outline_variant` (#44484f) at 20% opacity. It should be felt, not seen.
* **Glassmorphism:** Navigation sidebars and floating action bars must use semi-transparent `surface_container` fills with a heavy `backdrop-filter: blur(20px)`.

---

## 5. Components

### Action Buttons
* **Primary (Create New):** Solid `primary` background with `on_primary` text. Use `roundedness.md` (0.375rem).
* **Secondary (Sync to Cloud):** A "Neon Ghost" style. Transparent background, `secondary` text, and a `secondary` glow-border.
* **Icon Buttons (GitHub):** `surface_container_high` background with `on_surface` content. No border.

### Metric Cards
* **Structure:** No borders. Background: `surface_container`.
* **Accents:** A top-edge 2px glow-strip using the `primary`, `secondary`, or `tertiary` tokens to categorize the data (e.g., Cyan for Quiz data, Green for Student data).
* **Typography:** Numbers in `display-sm` (Space Grotesk), Labels in `label-md` (Manrope).

### Status Bars & Indicators
* **Active States:** Utilize the `tertiary` (Lime Green) token. Surround the status text with a subtle `tertiary_container` glow to suggest a powered-on LED.
* **Switches:** High contrast. Track: `surface_container_highest`. Thumb: `tertiary` when active.

### Lists & Navigation
* **Rule:** Forbid divider lines. Use 16px - 24px vertical white space to separate items.
* **Hover State:** Apply a `surface_bright` background shift and a 2px left-accent border in `primary`.

---

## 6. Do's and Don'ts

### Do:
* **Do** use overlapping elements. Let a glassmorphic card slightly overlap a background gradient to show off the blur effect.
* **Do** use neon colors sparingly. They are the "light sources" of your UI; too many sources create visual noise.
* **Do** maintain high contrast for accessibility. Ensure neon text on dark backgrounds meets WCAG AA standards.

### Don't:
* **Don't** use 100% white (#ffffff). Use `on_surface` (#f1f3fc) to prevent eye strain against the dark background.
* **Don't** use standard drop shadows. Shadows must be large, soft, and tinted by the component's accent color.
* **Don't** use rigid 1px borders to separate content blocks. Rely on the Spacing Scale and subtle tonal shifts between `surface_container` tiers.