# Contributing to Unison

The shared development repository is `https://github.com/Nahur1/unison`.
The product's display name is **Unison Player**; project identifiers, commands,
filenames and release artifact names use **unison**. See `docs/PROJECT_IMPORT.md`.

Use your own real Git name and email. Preserve the authorship of other people's
work. Do not rewrite collaborator commits to another person's name or add AI
author/co-author identities. Contributor entries can reflect real merged work.

Create a feature/fix branch, commit your changes and open a pull request against
`main`. Pull requests run native Windows, Linux and both Mac architecture tests;
they never publish a release. Keep existing style, logo and offline subtitle
behavior intact unless the change intentionally updates them.

```sh
git clone https://github.com/Nahur1/unison.git
cd unison
git config --local core.hooksPath .githooks
git switch -c fix/describe-the-change
```

For local Windows development, place libmpv in `runtime/libmpv-2.dll`, install Rust
stable and MSVC/Windows SDK, then run `./scripts/build.ps1 -Test`. On Linux/macOS,
install native dependencies and run `cargo test --locked`. Full packaging and
native playback checks are described in `docs/CROSS_PLATFORM.md`.

For application updates, increment the Cargo.toml version and its Cargo.lock
package entry and add `docs/releases/X.Y.Z.md`. After merging to main, Actions
builds/tests all four platforms and publishes only a complete successful release.
Never overwrite already-published versions or mix artifacts from different commits.
Keep dependency license notices and the preserved legacy MIT grant intact.

## Restricted contributor policy

Only Nahur1 and reza-hashemian may author or co-author new project commits.
Use the GitHub-linked noreply address for your account (with numeric account ID
preferred). Enable `.githooks` locally. The shared validator checks full history,
authors, committers and every Co-Authored-By trailer. AI assistance must not add
AI authors or co-author trailers. Never fabricate a human contribution or rewrite
someone else's work to evade this policy. Preserve legacy license notices.
Main requires passing identity/native checks and an approving review from the
other maintainer. Do not bypass or weaken these controls. Outsider PRs must not
be merged with outsider authorship. GitHub's web merge committer is allowed only
as committer, never as author. Owners can change protection settings; Git author
metadata alone is not proof of a person's identity.

Reza: `git config user.email "63972210+reza-hashemian@users.noreply.github.com"`
Owner: `git config user.email "51950495+Nahur1@users.noreply.github.com"`
