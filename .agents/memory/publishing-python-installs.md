---
name: Publishing Python installs
description: Why automatic hosting package installation is disabled for this imported Python app.
---

Install Python dependencies into a writable prefix, not with user-install mode.
Both automatic publishing installation and the explicit custom build must work;
testing only the custom build is insufficient.

**Why:** Publishing failed before reaching the custom build. The automatic
installer called the Nix standalone `pip` wrapper, which itself exported
`PYTHONNOUSERSITE=true`; pip's user-install configuration then caused
“Can not perform a '--user' install. User site-packages are disabled for this
Python.” Unsetting that variable outside the wrapper is insufficient because
the wrapper sets it again. Removing a duplicate Python interpreter did not
resolve this wrapper behavior. A subsequent publishing attempt still ran
automatic installation despite `packager.features.enabledForHosting=false`.

**How to apply:** Use shared non-secret pip settings that disable user mode and
select the workspace package prefix. The custom build and Run script should
explicitly use that prefix too. Reproduce the exact standalone `pip install`
command as well as the custom build without the interactive shell's
`PIP_CONFIG_FILE`. Use the Python module as the sole interpreter source.
Recheck the platform wrapper if upgrading the Python module later; do not assume
the workaround is permanently necessary. Until a publish succeeds, describe
local checks as local checks, not proof that publishing is fixed.
