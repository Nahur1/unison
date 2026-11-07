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
