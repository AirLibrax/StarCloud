# Reader Interaction Spec (final · frozen across all clients)

> This document is the **single behavioral contract** for the readers in `apps/reader` and `apps/mobile`.
> Change this document before changing any interaction. For technical details, defer to the epubjs source
> (`node_modules/epubjs/src/`; key files: `rendition.js` / `managers/default/index.js` /
> `layout.js` / `contents.js` / `utils/constants.js`).

## 1. Settings panel structure (same item order on every client)

1. Font size — 8-step slider (`FONT_STEPS`, default 100%), applies instantly
2. Line height — 4-step slider (`LINE_HEIGHTS`: 1.4 / 1.6 / 1.8 / 2.0)
3. Left/right margin — 4-step slider (narrow / medium / wide / extra-wide = `MARGINS`)
4. Page-turn mode — binary choice: **tap | swipe** (`PageMode`)
5. Conditional sub-items (per-client rules below): swipe shows "swipe axis"; vertical axis
   additionally shows "scroll style" (continuous / paged); tap or horizontal swipe shows "direction preference"

Toolbar layout: `[← shelf] ……chapter progress…… [single|two-col] [⚙]`
The single/two-column toggle lives **only in the toolbar** — no duplicate entry inside the settings panel.

## 2. Page-turn behavior

### Tap (default)

- Book iframes get `pointer-events: none` (CSS `.no-pointer`); all clicks land on the outer reader
  container and are judged by the shared `tapZoneAction()`.
- Screen split into left/right halves: left half = previous page, right half = next page.
- **Sub-option "direction preference"** (`SwipeDirection`, default `right-next`):
  - `right-next` (default): next page to the right → tapping the right half goes forward;
  - `left-next`: next page to the left → tapping the left half goes forward (mirrored).
- The engine receives no pointer events at all, so double-tap zoom is impossible.

### Swipe

Dispatched by device capability:

| Device | Behavior |
|--------|----------|
| Touch (`pointer: coarse`) | Sub-option "swipe axis": horizontal / vertical |
| Desktop (no touch) | No sub-option; fixed to vertical continuous scroll |

- **Horizontal swipe**:
  - paginated flow; book iframes are `pointer-events: none` too; gestures are judged by the
    outer container's `touchstart`/`touchend`;
  - direction formula (identical on web & app):
    `isNext = (dx > 0) === (swipeDirection === 'left-next')`, triggered only when `dx > 50px`;
  - carries the same "direction preference" sub-option, semantics as tap;
  - **vertical gesture (constant regardless of direction preference)**: within the same gesture
    judgment, take the dominant axis — if `|dy| > |dx|` and `dy < -50px` (push up) = next page;
    `dy > 50px` (pull down) = previous page.
- **Vertical swipe**:
  - Sub-option "scroll style" (`VerticalStyle`), binary:
    - **continuous**: `flow=scrolled`, seamless endless scroll — whole chapter as one strip,
      auto-advances to the next chapter at the bottom; iframes stay interactive with native scrolling;
    - **paged**: `flow=paginated` + `axis='vertical'` (native runtime capability of epubjs's
      default manager); push up = next page, pull down = previous page, one page at a time;
      page numbering matches horizontal swipe / tap (all paginated rendering);
      iframes `pointer-events: none`, gestures judged by vertical displacement on the outer container.
- **Desktop fallback rule**: on non-touch devices, choosing swipe switches to vertical continuous
  scroll + **forced single column** + the toolbar single/two-column button becomes a disabled
  "∅" (hover tooltip explains why).

## 3. Keyboard (PC)

- `↓` = next page, `↑` = previous page (constant, ignores direction preference);
- `←` `→` follow the "direction preference" (`left-next` makes `←` go forward);
- Fires on `keydown` (not keyup), with a 400ms anti-repeat cooldown;
- Dual-channel listening: `window` keydown (focus on the outer layer) + capture-phase keydown
  on the book iframe's document (focus inside the book); both channels coexist without double-firing
  (one keypress travels exactly one path).

## 4. Single / two-column spread

- Two-column is allowed only when the viewport is ≥768px and landscape-dominant
  (`min-width:768px and (orientation: landscape)`, `SPREAD_MIN_WIDTH=768` — tablet landscape /
  desktop), and only if the user chose it (`twoUp` state). The original 900px threshold was too
  high for real tablets (1280x800@DPR1.6 landscape CSS viewport is ~800px), so it was lowered.
- Below the threshold (phone portrait, etc.) it is forced single-column and the toggle is hidden.
- Desktop swipe mode forces single column + disabled "∅" button (see above).
- Listens to `window` resize and `matchMedia(WIDE_SPREAD_MQ)` change events; calls
  `rendition.resize()` to reflow on container size changes. The engine's internal
  `minSpreadWidth` equals the UI threshold (prevents a 768-799px landscape showing
  "two-column" while actually rendering single).

## 5. App-side (apps/mobile) mapping

- Settings stored in AsyncStorage; keys and value domains mirror web localStorage (see §6).
- Settings panel structure matches web: three sliders + tap/swipe choice + conditional
  sub-items (swipe shows axis; vertical axis then shows scroll style; tap or horizontal swipe
  shows direction preference). Note: the reading-preference panel lives inside `ReaderScreen`,
  not `SettingsScreen`.
- The app is always a touch device; there is no desktop fallback branch.
- TXT rendering (`TxtPane`):
  - tap = left/right half zones via `Pressable`/`tapZoneAction`;
  - swipe/horizontal = `PanGestureHandler`, same direction formula as §2, including the
    constant vertical gesture (push up = next, pull down = prev, never mirrored);
  - swipe/vertical+continuous = native seamless `ScrollView`;
  - swipe/vertical+paged = vertical `PanGestureHandler`, one page at a time.
- EPUB rendering (inline WebView via `offline-epub.ts`): `renderOptions` inject
  `flow`/`manager`/`axis` from `pageMode`/`swipeLayout`/`verticalStyle` (same mapping table as the
  web `EpubViewer`); gestures are judged by injected JS and `postMessage`'d back to RN to page.

## 6. Persistence

Web localStorage keys (app AsyncStorage 1:1):

| Key | Value |
|-----|-------|
| `starcloud.fontStep` | font step index |
| `starcloud.lineHeight` | line-height step index |
| `starcloud.margin` | margin step index |
| `starcloud.pageMode` | `'tap'` (default) \| `'swipe'` |
| `starcloud.swipeLayout` | `'horizontal'` \| `'vertical'` |
| `starcloud.verticalStyle` | `'continuous'` \| `'paged'` (meaningful only for vertical axis) |
| `starcloud.swipeDirection` | `'right-next'` (default) \| `'left-next'` |
| `starcloud.spreadTwoUp` | `'single'` \| `'two-up'` |

Progress reporting: report only on chapter change, 3s debounce;
restore priority = last position in this session > cloud percentage.

## 7. Event & rendering architecture (implementation red lines)

1. Book content lives in iframes; events inside an iframe **never bubble to the outer page**.
   The only two legitimate ways to listen: `rendition.on(eventName)` proxying (mapping table in
   `utils/constants.js` `DOM_EVENTS`), or `applyDocHandlers` seeding directly into the iframe document.
2. epubjs has **no built-in touch-swipe paging** (touchstart is only used for internal link
   handling). `axis:'vertical'` paged flipping is a native runtime capability of the default
   manager (official typings lack it — requires an `as` assertion when passing `renderTo` options).
3. Under paginated flow with iframes `pe: none`, the engine receives no clicks/touches — this is
   the intended architecture for tap and swipe/horizontal modes, not a bug.
4. Structural changes (`pageMode`/`swipeLayout`/`spread` switches) rebuild the renderer wholesale
   via `rebuildTick` and resume position by chapter index; refs must stay strictly in sync with state.
5. React StrictMode is not used (epubjs destroys incompletely under double effects, causing a blank screen).

## 8. Removed items (must not be resurrected)

- Triangle / inverted-Y three-zone tap regions (now left/right halves)
- Single/two-column entry inside the settings panel (toolbar only)
- Note: `VerticalStyle.paged` (one-page-at-a-time flip) was removed in an early version, then
  restored on 2026-08-25 as a sub-option of vertical swipe — see §2; it is not a removed item.
