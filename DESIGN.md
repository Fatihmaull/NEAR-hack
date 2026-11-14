---
name: Paron
description: A calm, white-canvas exchange desk for GPU compute forwards on NEAR, with one blue accent and every number in tabular mono.
colors:
  primary: "#1652F0"
  primary-hover: "#0F41C7"
  primary-pressed: "#0B33A0"
  primary-soft: "#EEF3FF"
  canvas: "#FFFFFF"
  soft: "#F5F6F8"
  strong: "#EEF0F3"
  hairline: "#DEE1E6"
  hairline-strong: "#8C929C"
  ink: "#0A0B0D"
  body: "#5B616E"
  muted: "#6B7079"
  up: "#047A4A"
  up-soft: "#E8F5EE"
  down: "#C8202F"
  down-soft: "#FCECEE"
  warn: "#8A5A00"
  warn-soft: "#FFF5E0"
  night: "#0A0B0D"
  night-raised: "#16181C"
  night-line: "#2A2D33"
  night-text: "#FFFFFF"
  night-soft: "#A8ACB3"
  night-muted: "#8B919C"
  night-accent: "#7FA4FF"
  night-up: "#4ADE80"
  night-down: "#F87171"
  selection: "#D6E1FF"
  scrollbar: "#D4D8DE"
typography:
  display-xl:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "4rem"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "-0.025em"
  display-lg:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "3.25rem"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-0.024em"
  display-md:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.022em"
  display-sm:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 1.13
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  display-mobile:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 400
    lineHeight: 1.03
    letterSpacing: "-0.025em"
  title-xl:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title-md:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.41
  title-lg:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.27
    letterSpacing: "-0.01em"
  title:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  body-lg:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.75
  body:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.625
    fontFeature: "'cv11', 'ss01'"
  body-sm:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.48
  label:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
  badge:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.67
  button:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
  num-display:
    fontFamily: "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "36px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: "'tnum'"
  num-stat:
    fontFamily: "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-0.025em"
    fontFeature: "'tnum'"
  num:
    fontFamily: "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.025em"
    fontFeature: "'tnum'"
rounded:
  focus: "6px"
  field: "12px"
  panel: "16px"
  card: "24px"
  pill: "9999px"
spacing:
  tight: "8px"
  snug: "12px"
  gutter: "16px"
  panel: "20px"
  gutter-md: "24px"
  block: "32px"
  group: "48px"
  section: "80px"
  section-lg: "96px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.canvas}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary-active:
    backgroundColor: "{colors.primary-pressed}"
  button-secondary:
    backgroundColor: "{colors.strong}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-outline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.down}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-on-dark:
    backgroundColor: "{colors.night-text}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-outline-dark:
    backgroundColor: "{colors.night}"
    textColor: "{colors.night-text}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-sm:
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-hero:
    rounded: "{rounded.pill}"
    padding: "0 32px"
    height: "56px"
  field:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "0 14px"
    height: "44px"
  field-label:
    textColor: "{colors.body}"
    typography: "{typography.label}"
  panel:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel}"
  badge-neutral:
    backgroundColor: "{colors.strong}"
    textColor: "{colors.ink}"
    typography: "{typography.badge}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  badge-primary:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    typography: "{typography.badge}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  badge-up:
    backgroundColor: "{colors.up-soft}"
    textColor: "{colors.up}"
    typography: "{typography.badge}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  badge-down:
    backgroundColor: "{colors.down-soft}"
    textColor: "{colors.down}"
    typography: "{typography.badge}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  badge-warn:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    typography: "{typography.badge}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  segmented:
    backgroundColor: "{colors.strong}"
    textColor: "{colors.body}"
    rounded: "{rounded.pill}"
    padding: "4px"
  segmented-option-active:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "36px"
  sidebar:
    backgroundColor: "{colors.soft}"
    width: "256px"
  nav-item:
    textColor: "{colors.body}"
    rounded: "{rounded.field}"
    padding: "0 12px"
    height: "40px"
  nav-item-active:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
  dialog:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.card}"
    padding: "24px"
    width: "560px"
  toast:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "16px"
  hero-product-card:
    backgroundColor: "{colors.night-raised}"
    textColor: "{colors.night-text}"
    rounded: "{rounded.card}"
    padding: "28px"
---

# Design System: Paron

## Overview

**Creative North Star: "The Daylight Desk"**

Paron looks like a trading desk you work at in daylight: a white canvas, ink type, hairline rules and one blue accent that only ever means "act here" or "this is the attested price". The system was built in the spirit of an institutional exchange reference the owner chose, then made Paron's own: its signature is the forward curve, its numbers are all set in a tabular mono, and its proof (tx links, receipt hashes, contract messages) sits in the same quiet type as everything else. Calm is the point. A market for a new asset class earns trust by looking settled, not by looking loud.

Density follows the mode. The marketing page (Persuade) is spacious: large display headlines at weight 400 with tight negative tracking, full-bleed bands that alternate white, soft grey and near-black, and row lists instead of card grids. The dashboard (Operate) is denser and stays light: a soft grey sidebar, white work panels with 16px corners and hairline headers, and every figure aligned in mono columns. There is one theme, light, by decision: it matches the owner's reference and the daytime-desk use scene. Dark appears only as full-bleed bands on the marketing page and the demo's receipt card, never as an app theme.

The system rejects the crypto-landing default outright: no gradients, no glass, no glow, no eyebrow labels above headings, no invented stats. Depth is tonal (white on soft grey on near-black); shadows exist only to say "this sits above the page".

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1

**Key Characteristics:**
- White canvas, ink text, one blue accent for actions and the attested-index line.
- Display type at weight 400 with negative tracking; every number in JetBrains Mono, tabular.
- Pills for actions, 12px fields, 16px panels, 24px cards and dialogs.
- Light/soft/dark band rhythm on marketing; a persistent soft-grey sidebar in the app.
- Up/down/warn are text colours that always travel with a word.
- Flat by default; shadows only for real elevation.

## Colors

A near-monochrome, cool-neutral palette with a single saturated blue and three semantic text colours, every text pair at WCAG AA or better.

### Primary
- **Desk Blue** (#1652F0): the only accent. Fills primary action pills, colours text links, the focus ring, checkbox and range controls, the progress fill, the active sidebar icon and the attested-index line of the forward curve. White on it reads 6.0:1, and it reads 6.0:1 as text on white. Hover deepens to **Desk Blue Deep** (#0F41C7); pressed goes to **Desk Blue Pressed** (#0B33A0).
- **Blue Wash** (#EEF3FF): the accent's tint, for the primary badge, the boot banner and the current demo step. Desk Blue on it reads 5.4:1.

### Semantic
- **Settled Green** (#047A4A, 5.4:1 on white): gains, filled orders, delivered jobs, bid prices. Tint **Green Wash** (#E8F5EE) for badges and bid depth.
- **Refusal Red** (#C8202F, 5.7:1): losses, rejected orders, slashes, ask prices, destructive actions. Tint **Red Wash** (#FCECEE) for badges, ask depth and error panels.
- **Caution Amber** (#8A5A00, 5.9:1): warnings and near-limit states. Tint **Amber Wash** (#FFF5E0).

### Neutral
- **Paper** (#FFFFFF): the canvas of every page, panel, field and dialog.
- **Desk Grey** (#F5F6F8): the sidebar ground, the soft marketing band, inset result blocks and code chips.
- **Control Grey** (#EEF0F3): secondary buttons, neutral badges, segmented tracks, progress tracks and hover fills.
- **Hairline** (#DEE1E6): every divider, panel border and table rule.
- **Hairline Strong** (#8C929C): field borders and the dashed strike line (3.1:1 on white, enough for a non-text boundary).
- **Ink** (#0A0B0D): headings, primary text and all figures.
- **Slate** (#5B616E, 6.2:1): body copy, descriptions, labels and table headers.
- **Fog** (#6B7079, 5.0:1 on white, 4.6:1 on Desk Grey): timestamps, placeholders, tertiary sub-lines and sidebar group labels.

### Night (marketing bands only)
- **Night** (#0A0B0D): the hero, safety and closing bands, and the demo receipt card.
- **Night Raised** (#16181C): product cards sitting on a Night band.
- **Night Line** (#2A2D33): dividers and the chart grid on Night.
- **Night Soft** (#A8ACB3, 8.6:1 on Night): body copy on Night.
- **Night Muted** (#8B919C, 6.2:1 on Night, 5.6:1 on Night Raised): small labels on Night.
- **Night Accent** (#7FA4FF, 8.1:1 on Night): links, the curve line and the focus ring on Night, where Desk Blue would be too dark.

Text selection is a pale blue (#D6E1FF) with Ink text.

### Named Rules
**The One Accent Rule.** Desk Blue is the only hue that is not a status. It marks what you can do (primary actions, links, focus) and the one line that matters on a chart (the attested index). Nothing decorative is ever blue.

**The Word-With-Colour Rule.** Green, red and amber are text colours and soft tints, never the only signal. Every coloured state carries a word ("Filled", "Rejected", "+4.6% vs strike", "Slashed: SLA missed").

## Typography

**Display Font:** Inter Variable (with ui-sans-serif, system-ui fallbacks)
**Body Font:** Inter Variable, with the cv11 and ss01 alternates on
**Label/Mono Font:** JetBrains Mono Variable (with ui-monospace, SFMono-Regular, Menlo)

**Character:** A neutral grotesque used quietly, large and light for headlines and plain for reading, paired with a monospace that turns every price, size, hash and timestamp into an aligned column. The contrast between the two is the whole typographic voice.

### Hierarchy
- **Display** (400, 4rem / 3.25rem / 2.5rem / 2rem, line-height 1.02 to 1.13, tracking -0.025em to -0.015em): marketing headlines. The hero runs 2.75rem on phones, the large step at 640px and the extra-large step at 1024px; section headings run the small step on phones and the medium step from 640px.
- **Headline** (400, 2rem, 1.25, -0.02em): the one h1 on each dashboard page.
- **Title Large** (400, 22px, -0.01em): dialog titles and the two-column band headings on marketing.
- **Title** (600, 16px, 1.5): panel titles, in sentence case.
- **Body** (400, 15px, 1.625): the default reading size. Large body (16px, 1.75) for marketing paragraphs, capped near 52 to 70 characters per line; small body (13.5px) for panel descriptions and helper text.
- **Label** (500, 13px): field labels and stat labels, in Slate, sentence case. Caption (12.5px) for table headers and sub-lines; Badge (600, 12px) for status pills.
- **Numbers** (JetBrains Mono, tabular, tracking -0.025em): 36px for a headline balance (32px for the hero price), 20px at weight 500 for stats, 14 to 16px in tables and rows.

### Named Rules
**The Light Display Rule.** Headlines are weight 400 with negative tracking, never bold. Weight 600 is reserved for small titles, labels inside rows and buttons, where it aids scanning.

**The Mono Number Rule.** Every number a user might compare (prices, sizes, CU, margins, percentages, hashes, clock times) is set in JetBrains Mono with tabular figures. Prose never carries a bare proportional figure where a column would.

**The No Kicker Rule.** No eyebrow or kicker label sits above a heading. A heading stands on its own; context goes in the line below it.

## Layout

Marketing pages use a centred container capped at 1200px with 16px side gutters on phones, 24px from 640px and 32px from 1024px. Sections are full-bleed bands with 80px vertical padding (96px from 640px) that alternate Paper, Desk Grey and Night; the order on the landing is dark hero, white, soft, white, dark, white, dark close. Inside a band, the common grammar is a narrow heading column (380 to 420px) beside a wide content column, collapsing to one column below 1024px. Lists of things (series, safety rules, proof items) are ruled rows with three columns on desktop, not grids of cards. The one two-column card is a single 24px container split by a 1px hairline seam.

The hero band sets copy left and a layered product card right: a Night Raised card holding the live forward curve, with a smaller white card overlapping its lower-right edge.

The dashboard is a two-column grid from 1024px: a 256px sticky sidebar on Desk Grey with a hairline right edge, and a main column capped at 1280px with 32px top padding (40px from 1024px) and 16/32px side gutters. Each page opens with a headline, a one-line purpose and optional actions or the simulated desk clock on the right, then 32px of space, then its work area. Panels stack with 20px gaps and pair into asymmetric two-column grids (1.3 : 1) only from 1280px. Below 1024px the sidebar becomes a 64px sticky top bar (near-opaque white with a light blur) whose Menu button opens the same sidebar as a left drawer.

Spacing steps are 8, 12, 16, 20, 24, 32, 48, 80 and 96px; panels pad 20px, marketing cards 32 to 40px. Breakpoints are 640, 768, 1024 and 1280px.

### Named Rules
**The Rows Not Cards Rule.** Collections are ruled rows with hairline dividers. A card is earned only by a distinct work area (a panel) or a live product sample (the hero cards).

## Elevation & Depth

The system is flat at rest and layered by tone: Paper sits on Desk Grey, Night Raised sits on Night. Borders do most of the separating (1px Hairline). Shadows appear in exactly two strengths and only when something truly sits above the page.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 4px 12px rgba(10, 11, 13, 0.06)`): the active sidebar item and the selected segment of a segmented control, so the current choice reads as a raised tab.
- **Sheet** (`box-shadow: 0 24px 48px -12px rgba(10, 11, 13, 0.28)`): dialogs, toasts, the mobile navigation drawer, the focused skip link, and the white card that overlaps the hero's product card.

Modals sit on an Ink scrim at 50% (40% for the mobile drawer).

### Named Rules
**The Earned Shadow Rule.** A shadow means "above the page": a dialog, a toast, a drawer, the overlapping hero card or the current navigation choice. Panels, cards and buttons at rest carry none.

**The No Glow Rule.** No gradients, glass panels, glows or coloured shadows. The order book's depth bars are flat, hard-edged tint fills sized by volume, not gradients.

## Shapes

Four corner sizes, each tied to a role: 12px for fields, nav items, small chips and inset blocks; 16px for panels, toasts and list frames; 24px for marketing cards, the hero product card and dialogs (top corners only when a dialog docks as a bottom sheet on phones); fully round for every button, badge, segmented control and status label. Borders are always 1px. Empty states use a dashed Hairline Strong border at 60%; the forward curve's strike line is the only other dashed stroke. Icons are Lucide line icons at 16 to 20px with a 1.75 stroke in the sidebar.

### Named Rules
**The Pill Means Action Rule.** Round-ended shapes are for things you press or read as a status. Containers are never pills; buttons are never square.

## Components

### Buttons
Confident, round and plain: weight-600 labels on solid fills, no icons unless the action needs one.
- **Shape:** fully round pill, minimum 44px tall with 20px side padding; the small size is 36px tall with 16px padding; hero calls to action are 56px tall with 32px padding and a 16px label.
- **Primary:** Desk Blue fill, white label. One primary per view or decision.
- **Hover / Focus:** colour shifts only, over 150ms (Desk Blue Deep on hover, Desk Blue Pressed on press). Focus shows a 2px Desk Blue outline offset 2px (Night Accent inside dark bands). Disabled drops to 45% opacity with a not-allowed cursor.
- **Secondary:** Control Grey fill, Ink label.
- **Outline:** Paper fill, 1px Hairline border that darkens to Hairline Strong on hover. Used for the second action beside a primary ("Pre-sell capacity").
- **Danger:** Paper fill, Refusal Red label and a 40% red border; hover fills Red Wash.
- **On dark:** a white pill with Ink label for the main action, and a white-outlined pill (40% white border) for the second; a ghost pill with a 10% white hover for header links.

### Chips and badges
- **Style:** fully round, 12px weight-600 label, 2px by 10px padding, a Wash tint with its matching text colour (neutral, blue, green, red, amber).
- **State:** badges are read-only status ("Filled", "Rejected", "Holds in all series", "Testnet beta") and always carry the word.

### Segmented control
- **Style:** a Control Grey pill track with 4px padding holding 36px pill options in Slate; the selected option is Paper with Ink text and the Lift shadow. It has radio semantics and picks a series or a side.

### Cards / Containers
- **Corner Style:** 16px for app panels, 24px for marketing cards and the hero product card.
- **Background:** Paper on Paper with a Hairline border in the app; Night Raised on Night in the hero.
- **Shadow Strategy:** none at rest (see Elevation & Depth).
- **Border:** 1px Hairline; the panel header is divided from its body by a Hairline rule.
- **Internal Padding:** 20px for the panel header (16px vertical) and body; 24 to 28px for the hero card; 32 to 40px for marketing cards. List bodies drop to 0 horizontal padding so their rows run edge to edge.

### Inputs / Fields
- **Style:** Paper fill, 1px Hairline Strong border, 12px corners, 44px tall, 15px Ink text, Fog placeholder. The label sits above in 13px weight-500 Slate.
- **Focus:** the border turns Desk Blue with a 2px Desk Blue ring at 20% opacity; hover darkens the border to Ink at 60%.
- **Error / Disabled:** errors are a sentence in Refusal Red under the field that names the limit ("Above the $2.8420 guardrail ceiling. The contract will reject it."); disabled fields take the not-allowed cursor.

### Navigation
- **Marketing header:** a 72px bar on Night with the wordmark, a bordered "Testnet beta" pill, section links in Night Soft that turn white on hover, a ghost "Watch demo" and a white "Open the desk" pill. Below 1024px a 44px Menu button opens a stacked list of 48px links and two full-width pills.
- **Dashboard sidebar:** the wordmark and a "Testnet beta" chip, an account card (12px corners, mono account id, free margin), then nav groups headed by 12px Fog labels in sentence case. Items are 40px rows with an 18px line icon and 14.5px label in Slate; hover fills Control Grey. The current page becomes a raised white tab: Paper fill, Hairline ring, Lift shadow, weight 600 Ink label and a Desk Blue icon. The foot holds the demo link, docs link and the wallet control.
- **Wordmark:** the name set in 22px weight 600 with -0.03em tracking. No drawn logo exists, and none is invented.

### Dialogs and toasts
- **Dialog:** Paper, 24px corners, Sheet shadow, 560px wide (760px large), docking as a bottom sheet on phones. It enters with a 320ms rise-and-settle on the out-expo curve over a fading scrim; Escape closes it and focus returns to the trigger.
- **Toast:** a 16px-corner Paper card with Hairline border and Sheet shadow at bottom right, a status icon (green check, red cross or blue info), a title (red for errors), the contract's own message, and the signed tx hash with copy.

### Feedback states
Loading is always a sentence beside a small spinner whose arc is Desk Blue; empty states are a dashed 16px frame with a title, one line and an optional action; errors are a Red Wash panel with a red title and a "Try again" outline button. Progress bars are 6px Control Grey tracks with a rounded fill that eases over 500ms.

### Hash
Ids and hashes are mono 12.5px in Slate, truncated in the middle with the full value on hover, followed by a 28px copy button that confirms with a green check.

### Forward Curve (signature)
The identity motif, always drawn from data. Three faint horizontal grid lines; the series strike as a dashed 1.5px Hairline Strong line; the attested index as a 2.25px Desk Blue line with round joins and a 4px dot at each of the three maturities, each dot labelled with its price in 12px mono Ink and its maturity in 11.5px mono Slate below the axis. On Night it inverts to a Night Accent line over Night Line grid. It has a text title for assistive tech and never appears as decoration.

### Order book ladder
Asks above, bids below a Desk Grey index row with the spread. Prices are red (asks) or green (bids) mono text; size depth is a flat tint (Red Wash or Green Wash) filling each row from the right edge in proportion to resting CU.

## Do's and Don'ts

### Do:
- **Do** keep Desk Blue (#1652F0) for primary actions, links, focus and the attested-index line only; use Night Accent (#7FA4FF) for the same roles on Night bands.
- **Do** set every comparable number in JetBrains Mono with tabular figures.
- **Do** pair every green, red or amber state with a word, and keep semantic colours as text or soft tints.
- **Do** set headlines at weight 400 with negative tracking (-0.015em to -0.025em).
- **Do** give primary actions a 44px minimum height (56px for hero calls to action), a pointer cursor when enabled and a visible 2px focus outline.
- **Do** lay collections out as ruled rows with Hairline dividers.
- **Do** keep motion to colour transitions (150ms), dialog and toast entrances (320ms, out-expo), drawer slides (280ms) and fades (200ms), all collapsing under reduced motion.
- **Do** show live or clearly labelled simulated data in product cards, with a real tx link where a claim is made.

### Don't:
- **Don't** add a second accent hue or use blue decoratively.
- **Don't** put an eyebrow or kicker label above a heading.
- **Don't** use gradients, glass panels, glows or coloured shadows.
- **Don't** put shadows on panels, cards or buttons at rest; shadows are for dialogs, toasts, drawers, the overlapping hero card and the active navigation choice.
- **Don't** build a dark app theme; dark is a marketing band, not a mode.
- **Don't** set headlines bold or numbers in a proportional face.
- **Don't** turn collections into grids of identical cards.
- **Don't** rely on colour alone for up/down, ok/rejected or any status.
