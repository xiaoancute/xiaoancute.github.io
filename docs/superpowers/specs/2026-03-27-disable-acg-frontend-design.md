# Disable ACG Frontend Design

**Goal**

Hide the template's visible ACG-related frontend surfaces for this blog while preserving the underlying theme features and source code for future reuse.

**Scope**

- Keep mascot-related frontend features disabled.
- Disable the Bangumi page and remove its visible navigation entry.
- Do not delete Bangumi, Pio, Live2D, Spine, or related source files.
- Do not change unrelated blog features such as posts, gallery, friends, guestbook, or sponsor pages.

**Current Context**

- [src/config/pioConfig.ts](/home/x/Documents/My_Blog/xiaoancute.github.io/src/config/pioConfig.ts) already has both `spineModelConfig.enable` and `live2dModelConfig.enable` set to `false`, so mascot models are already hidden on the frontend.
- [src/config/siteConfig.ts](/home/x/Documents/My_Blog/xiaoancute.github.io/src/config/siteConfig.ts) currently has `pages.bangumi` set to `true`.
- [src/config/navBarConfig.ts](/home/x/Documents/My_Blog/xiaoancute.github.io/src/config/navBarConfig.ts) already derives the Bangumi navbar item from `siteConfig.pages.bangumi`.
- [src/pages/bangumi.astro](/home/x/Documents/My_Blog/xiaoancute.github.io/src/pages/bangumi.astro) already returns `404` when `siteConfig.pages.bangumi` is `false`.

**Approach**

Use existing configuration switches instead of editing feature implementation code.

1. Leave `src/config/pioConfig.ts` unchanged because the visible mascot features are already disabled.
2. Change `siteConfig.pages.bangumi` in `src/config/siteConfig.ts` from `true` to `false`.
3. Rely on existing dynamic navbar logic to automatically hide the Bangumi entry.
4. Rely on existing page guard logic so `/bangumi/` is no longer publicly accessible.

**Why This Approach**

- Smallest safe change set.
- Preserves upstream compatibility.
- Avoids deleting code or creating drift from the template.
- Makes it easy to re-enable the features later by flipping config values back.

**Expected Frontend Outcome**

- No mascot model appears on the site.
- No Bangumi entry appears in the navigation.
- Visiting `/bangumi/` returns `404`.
- All unrelated pages and blog functions continue to work normally.

**Out of Scope**

- Removing ACG references from repository docs, comments, assets, or source code.
- Replacing logos, banners, keywords, or theme copy that may still stylistically lean toward the original template.
- Deleting Bangumi or Pio dependencies.

**Verification Plan**

- Run `pnpm run check`.
- Confirm the Bangumi page config is disabled in `src/config/siteConfig.ts`.
- Confirm no direct navbar config edits are required because the navbar is already config-driven.
