<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- PICKVANTA is a vanilla HTML/JS multi-page site served as-is from /public; "/" redirects to /index.html. Why: owner requires the original architecture, PV_STORE/PV_AUTH and demo mode untouched.
- Non-browser repo parts (connectors, db, docs, tools) are kept for reference in /pickvanta-source. Why: preserve the repo without shipping them publicly.
- No Lovable Cloud/database; js/config.js stays in mode 'demo'. Why: UI preview only.
- Visual redesign lives in public/css/vanta.css (loaded after styles.css on every page); it only restyles, never renames ids/classes/data attributes used by JS. Why: keep behaviour intact.
