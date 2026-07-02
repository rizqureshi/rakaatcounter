---
name: feedback-workflow
description: How Rizwan wants code changes to be handled — inspect first, focused edits, separate commits, summarize after
metadata:
  type: feedback
---

Always follow this workflow for every change:

1. **Inspect before editing** — read the relevant files and confirm which files will be changed before touching anything
2. **Focused changes only** — do not redesign, refactor, or clean up anything beyond what was explicitly asked
3. **Separate commits by category:**
   - copy/content corrections
   - Shopify cart/checkout/form fixes
   - new homepage sections
   - performance/image optimization
4. **Summarize after** — list every file changed and describe exactly what was changed in each

**Why:** User had bad experience with over-broad changes that touched unrelated files or restructured things unexpectedly.

**How to apply:** Before every edit session, state which files will be changed. After every edit session, summarize what changed. Never combine categories into a single commit.
