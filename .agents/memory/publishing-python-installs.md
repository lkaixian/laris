---
name: Publishing Python installs
description: Why automatic hosting package installation is disabled for this imported Python app.
---

Keep Python dependency installation in the explicit publishing build using
`python -m pip`, rather than re-enabling the automatic hosting package installer.

**Why:** Publishing failed before reaching the custom build. The automatic
installer called the Nix standalone `pip` wrapper, which itself exported
`PYTHONNOUSERSITE=true`; pip's user-install configuration then caused
“Can not perform a '--user' install. User site-packages are disabled for this
Python.” Unsetting that variable outside the wrapper is insufficient because
the wrapper sets it again. Removing a duplicate Python interpreter did not
resolve this wrapper behavior.

**How to apply:** Keep automatic hosting installation disabled while the explicit
build installs requirements and builds the frontend. Use the Python module as
the sole interpreter source. Reproduce publishing build commands without the
interactive shell's `PIP_CONFIG_FILE`, since workflows and publishing may not
inherit it. Recheck the platform wrapper if upgrading the Python module later;
do not assume the workaround is permanently necessary.
