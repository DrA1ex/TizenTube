# GX1/VOT fork rules

- This fork contains the TizenTube JavaScript source used by `DrA1ex/TizenTubeCobalt_VOT`. Keep GX1/VOT feature changes here as normal source commits.
- Before editing, inspect `git status --short --branch` and preserve existing user work.
- Keep documentation and new prose in English. Existing localization resources remain multilingual.
- Run the relevant tests from the builder repository and build `mods/` before completing a change. Commit each completed user requirement with a descriptive message.
- After pushing a source commit, update the submodule pointer in the builder repository and commit that pointer with related native or build changes. Do not publish a builder commit that points to an unavailable fork commit.
