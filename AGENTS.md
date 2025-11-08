# Repository Guidelines

## Project Structure & Module Organization
The Astro app lives under `src/`, which contains `src/pages/` (routes), `src/layouts/`, reusable Svelte components, and all tunable configs in `src/config/`. Post utilities sit in `scripts/`, while immutable assets such as icons, `CNAME`, and `.nojekyll` belong in `public/` so they are copied verbatim to `dist/`. Generated screenshots referenced by the README stay under `docs/images/`. Never edit `dist/`; it is rebuilt by CI and ignored by git.

## Build, Test, and Development Commands
- `pnpm dev` — run the Astro dev server at `http://localhost:4321` with hot reload.
- `pnpm build` — produce the static site in `dist/` and run the Pagefind indexer; execute before every release.
- `pnpm preview` — serve the last build locally to mirror the GitHub Pages environment.
- `pnpm check` / `pnpm type-check` — run `astro check` plus TypeScript declaration validation for early integration issues.
- `pnpm format` and `pnpm lint` — invoke Biome to auto-format and lint the `src/` tree; required before commits.

## Coding Style & Naming Conventions
Use the existing mix of tabs (config files) and two-space indents (components, markdown). Favor PascalCase for Astro/Svelte components (`RecentPosts.astro`), kebab-case for route filenames (`about/index.astro`), and camelCase for utilities. Tailwind class lists should stay ordered logically (layout → spacing → color). Always run Biome instead of manual formatting and keep TypeScript strict with explicit return types where practical.

## Testing Guidelines
There is no dedicated automated test suite yet; rely on `pnpm check`, `pnpm type-check`, and manual regression through `pnpm dev`. If you add automated tests, place them under `tests/` mirroring the feature path (`tests/posts.spec.ts`) and document the command (e.g., `pnpm test`). Any critical bug fix should include at least a reproduction scenario described in the PR.

## Commit & Pull Request Guidelines
Write concise, imperative commit subjects (“Improve swup preload timing”) and avoid generic “update”. Each PR should summarize the change, list key commands run (build/check), link relevant issues, and include screenshots or recordings for UI changes. Keep scope tight: configuration tweaks, theming adjustments, and new content should land in separate PRs to simplify review.

## Deployment & Configuration Tips
`astro.config.mjs` must declare the correct `site` and `base` so sitemap/RSS URLs match the deployed domain. Maintain `public/CNAME` for the custom domain and keep `.nojekyll` so GitHub Pages serves `/_astro` assets. The GitHub Actions workflow in `.github/workflows/deploy.yml` builds on pushes to `master`; verify it succeeds after each merge.

## Speak Chinese
Reply only in Chinese