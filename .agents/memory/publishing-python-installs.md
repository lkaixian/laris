---
name: Publishing Python installs
description: Why automatic hosting package installation is disabled for this imported Python app.
---

Install Python dependencies into a writable prefix, not with user-install mode.
Keep the app runtime on the selected Replit Python module, but verify which pip
entry point that runtime actually provides.

**Why:** Publishing failed before reaching the custom build. The automatic
installer called the Nix standalone `pip` wrapper, which itself exported
`PYTHONNOUSERSITE=true`; pip's user-install configuration then caused
“Can not perform a '--user' install. User site-packages are disabled for this
Python.” Unsetting that variable outside the wrapper is insufficient because
the wrapper sets it again. The Python 3.13 module's `python` wrapper later had
no `pip` module, while the matching standalone `pip` successfully installed
packages into the workspace prefix. Its `sitecustomize` warning was noisy but
non-fatal.

**How to apply:** Use shared non-secret pip settings that disable user mode and
select the workspace package prefix. The custom build and Run script should
explicitly use that prefix too. Test the exact standalone `pip install` command
and the full custom build without the interactive shell's `PIP_CONFIG_FILE`,
then restart the app and verify imports. Check that standalone pip matches the
selected Python version. Until a publish succeeds, describe local checks as
local checks, not proof that publishing is fixed.
