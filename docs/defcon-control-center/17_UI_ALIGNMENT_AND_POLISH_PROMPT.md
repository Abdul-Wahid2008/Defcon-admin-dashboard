# 17 — U1: DASHBOARD ALIGNMENT, VISUAL POLISH AND LOCKOUT FIX (28 Oct 2026)

Paste doc 13 first, then this. Base: branch `release/v1.2` at `1232f84` (403 tests, typecheck clean — verified 28 Oct). Work on a new branch `release/v1.2-ui` and tag `v1.2.0-rc.3` only after the gate.

## What is known (do not trust, verify)
Abdul reports the right side of the console looks broken/misaligned. I could not log in to look, so the cause is NOT confirmed. Code facts that make these suspects plausible:
- `(console)/layout.tsx`: shell is `h-screen overflow-hidden`; content column is `min-w-0 overflow-hidden`; content is `mx-auto w-full max-w-[1440px] px-6`. On screens ≥1700 px this leaves empty bands on both sides while the Topbar spans the full width (misaligned edges).
- Any wide child (overview matrix, teams table, audit table) that overflows is **silently clipped** by the `overflow-hidden` ancestors — this looks exactly like "the right side is cut off".
- Custom 6 px WebKit scrollbar on `main` changes the right gutter between pages that scroll and pages that don't.

```
SLICE U1 (plan first). Goal: a neat, professional, pixel-consistent console at every width from 1024 to 2560, with zero horizontal clipping.

STEP 1 — DIAGNOSE BEFORE EDITING. Write scripts/qa-layout.ts (+ `npm run qa:layout`) using the headless-Chrome/CDP recipe from docs/defcon-control-center/11_NEXT_SESSION_MASTERPROMPT.md against a temp DB seeded with explicit credentials (port 3100, explicit env overrides, never the shared 3000/.env). For widths 1024, 1280, 1366, 1440, 1536, 1920, 2560 and heights 768/900/1080, for routes /login, /overview, /overview?view=incidents, /teams, /teams/team-01 (every tab), /audit, /settings (admin) and as operator: record (a) document.documentElement.scrollWidth vs clientWidth, (b) every element whose getBoundingClientRect().right exceeds its nearest scroll/overflow ancestor's visible right edge or the viewport, with a CSS path, (c) left/right gutter widths of the content column vs the Topbar inner edges, (d) elements with text-overflow clipping and no title/tooltip, (e) screenshot. Output a table of defects with root cause BEFORE any change. The script must exit non-zero on any horizontal clip or edge misalignment so it stays as a regression gate.

STEP 2 — FIX THE FOUNDATION (not page by page).
1. One page container used by Topbar, banners and content: fluid with `--page-gutter: clamp(16px, 2vw, 32px)` and `--page-max: 1680px`; Topbar inner, banners and content share the same left/right edges at every width. Above max, centre both together.
2. Replace `h-screen` with `h-dvh`; keep a single scroll region for the page; `scrollbar-gutter: stable` so pages with and without scrollbars align; consistent thin scrollbar styling that never changes layout.
3. Never rely on parent `overflow-hidden` to hide overflow. Wide data views get an explicit scroll container (`overflow-x-auto`, `min-w-0`, sticky first column and header, a visible edge shadow/affordance) and are tested at 1024.
4. Grid discipline: 8 px spacing scale, one card padding, one radius, equal-height cards in a row, section headings aligned to the same baseline, page header actions right-aligned and wrapping gracefully, no orphan single-word wraps in headers/buttons.
5. Tables: right-align numeric columns with tabular-nums, fixed column widths where text truncates (with title/tooltip), consistent row height (compact 36 / comfortable 44), sticky header, zebra off (use hairlines), selected/hover states visible, no content jump on poll.
6. Typographic scale: define 5 sizes only (page title, section title, body, secondary, caption) and apply everywhere; remove ad-hoc sizes; mono only for ids/ports/times.
7. Reduce noise: remove redundant borders/shadows/backgrounds inside cards, keep one accent colour, status = colour + icon + text, 16 px icons everywhere, consistent button sizes (sm for table/toolbars, default elsewhere), consistent empty/error/forbidden states.
8. Banners (frozen/sim/stale) reserve space so nothing shifts when they appear.

STEP 3 — VISUAL REVIEW LOOP. After fixes, screenshot every route at 1024, 1280, 1440, 1920, 2560. Critique your own screenshots like a strict designer (alignment, spacing rhythm, hierarchy, density, truncation, contrast ≥4.5:1 by computed style, focus rings). Fix and re-shoot until `npm run qa:layout` is green at all widths. Do not change copy, behaviour, permissions, contracts or data flow. Do not add dependencies.

STEP 4 — LOGIN LOCKOUT FIX. Claude Code's hardening pass left a username lockout that anyone on the network can use to lock out the admin for minutes (it locked its own admin account while probing). During a live event that is an availability bug. Change the limiter to: block per (IP + username) and a per-IP ceiling; per-username-only failures add increasing delay but NEVER hard-block a username across IPs; add `npm run unlock` (clears the limiter state through a small authenticated local-only admin endpoint OR, if the limiter is in memory, a documented SIGUSR-free alternative — choose the simplest that works without restarting the server) and document it in docs/EVENT_RUNBOOK.md. Tests: attacker IP cannot lock another IP's admin login; limiter bounds still hold; existing limiter tests updated, not weakened.

STEP 5 — GATE AND SOAK. typecheck 0, lint 0 errors, all tests (≥403 + new), build 0, qa:layout green, authz matrix unchanged, then a 10-minute loadtest/soak on the NEW build (the previous 60-minute soak ran on a build before the last security fixes — say so in the report). Run the fresh reviewer subagent over the diff. Update CLAUDE.md/AGENTS.md STATUS and BUILD_STATUS.md; commit `feat(ui): layout foundation, alignment and polish; fix(auth): lockout no longer locks out other IPs`; tag v1.2.0-rc.3. Do not push or merge to main unless told.
Report format: defect table (before) · root causes · what changed · screenshot paths per width · gate outputs · reviewer findings applied/rejected.
```
