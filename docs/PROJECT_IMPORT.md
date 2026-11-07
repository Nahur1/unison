# Unison project import

Unison starts from the complete working source tree of
`https://github.com/Nahur1/kaghaz-player` at commit
`2ee7aa36e06fae8f6d409b686a7ce906e3bcd57a` (version 0.3.6), including the
owner's current notices and the newly selected U/play brand artwork.

The original project and its Git history remain intact. This repository has a
fresh import history for the new shared project. Historical release notes and
previous design drafts remain in `docs/history` and `design/legacy`; their old
names are historical provenance, not active Unison identifiers.

## Naming contract

| Context | Name |
| --- | --- |
| Application/window/launcher display | Unison Player |
| Repository and project | unison |
| Local project directory | D:\Unison |
| Cargo package and binary | unison |
| Terminal command | unison |
| Windows executable | unison.exe |
| Windows portable folder | dist/unison-VERSION |
| Release artifacts | unison-setup-VERSION.exe / unison-VERSION-PLATFORM |
| Settings/cache directory | unison |
| Diagnostic environment prefix | UNISON_ |
| Repository and update owner | Nahur1/unison |

The native macOS application bundle is `Unison Player.app`, because Finder uses
that filename as the visible application name. Source, package and executable
names remain `unison`.

Unison uses its own Windows installer AppId and TCP port 47826 (47827 for the
default isolated profile). Unix sockets and MPRIS identities also use unison.
Existing settings in the previous application's profile are left intact; no
personal library database, downloaded update, uninstaller or installed executable
is committed to this repository.

The independent local workspace contains the source, selected designs, offline
model, libmpv, optional FFmpeg and a relocatable local MSVC toolchain. Generated
build caches and runtime downloads stay ignored by Git.

`packaging/dependencies.json` identifies an immutable external Windows playback
bootstrap, verified by SHA-256. It is used only to extract the existing libmpv
DLL on clean CI runners. Application releases and automatic updates exclusively
use `Nahur1/unison`. Mozilla's pinned model files and native package manager
dependencies retain their original upstream locations and licenses.
