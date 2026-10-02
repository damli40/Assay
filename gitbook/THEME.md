---
description: The one-time GitBook settings for the Assay docs site. Not in the sidebar.
icon: palette
---

# Theme and Git Sync setup

**Where:** GitBook, in the space for these docs: Customize (look and feel) and Configure (Git Sync). This file is not listed in `SUMMARY.md`, so it never appears on the site.

An assay tests whether metal is what it claims to be, and a passing piece gets a hallmark stamp. Assay receipts are hallmarks for AI output, so the site uses graphite and one assay gold.

## Connect Git Sync

1. In GitBook, create a space (the free plan is enough) and open it.
2. Click Configure, then pick GitHub Sync.
3. Install or authorize the GitBook GitHub app for the `trudransh` account, with access to the `Assay` repo.
4. Repository: `trudransh/Assay`. Branch: `main`.
5. Project directory: `gitbook/`. The root `.gitbook.yaml` already says `root: ./gitbook/`, so either setting finds the same files.
6. Initial sync direction: GitHub to GitBook. Picking the other direction would overwrite the Markdown in the repo with an empty space.
7. Click Sync. The sidebar should match `gitbook/SUMMARY.md`: Welcome, Getting started, How it works, For developers, Integrations, Security, Resources.

After this, every push to `main` that touches `gitbook/` updates the site. Edits made in the GitBook editor come back as commits to `main`, so pull before you edit locally.

## Customize

| Setting | Value |
|---|---|
| Theme | Clean |
| Default mode | Dark |
| Allow mode toggle | On (light mode uses the same accent) |
| Primary color | `#C9A227` (assay gold), same value in light and dark |
| Tint color | `#2B2D31` (graphite) |
| Background | Match the tint, so dark mode is graphite and not pure black |
| Corner style | Straight |
| Font | Inter for the body. If GitBook's font list has a serif (for example Source Serif, IBM Plex Serif or Merriweather) and your plan allows a separate heading font, use it for headings. If only one font is allowed, keep Inter |
| Monospace | GitBook's default code font, used for hashes and addresses |
| Icons | Font Awesome, Regular style. Every page sets its own `icon:` in its front matter. Don't mix in emoji |
| Links | Use the primary color |

## Logo

| Mode | File | Notes |
|---|---|---|
| Light | `gitbook/.gitbook/assets/logo.svg` | Hallmark mark plus "Assay" wordmark. The wordmark uses `currentColor`, which renders black |
| Dark | `gitbook/.gitbook/assets/logo-dark.svg` | Same logo with the wordmark in `#EDE6D6`, so it reads on graphite |
| Favicon | `gitbook/.gitbook/assets/logo-mark-transparent.png` | The mark alone, transparent background |

Upload each file in Customize, under Logo (light and dark) and Favicon. The PNG for the submission form is `docs/brand/logo.png`, which is under 3 MB.

## Checklist after the first sync

1. Every sidebar group shows as an uppercase header with its pages under it.
2. Each page shows its icon and the one-line description under the title.
3. Hint blocks render as colored boxes, not as raw hint tags.
4. Dark mode is the default on a fresh private window.
5. The welcome page is the landing page.

{% hint style="warning" %}
Don't add pages in the GitBook editor without adding them to `gitbook/SUMMARY.md` in the same change. Git Sync treats `SUMMARY.md` as the sidebar, and a page missing from it will disappear on the next sync from GitHub.
{% endhint %}
