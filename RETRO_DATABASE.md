# OC Retro Database integration

[OC Retro Database](https://github.com/jshsakura/oc-retro-database) stores separate Korean,
English/Latin lookup and Japanese names, source-backed original titles, aliases, release
observations, content fingerprints and provider ID links. Its resolver performs read-only
offline matching. It does not rename library files or establish achievement compatibility
from a title match.

The database repository's `tools/export-cookingfoil.mjs` produces `retro-ko-names.json` in
CookingFoil's existing Korean-name dictionary format. To use an export, place it under the
server's configured data directory. CookingFoil reads this optional local file over the bundled
dictionary. Changes, replacements and removal are detected without a restart. Invalid or
partially written JSON retains the last complete local dictionary until the file changes again.
Removing the file returns to the bundled dictionary. No file is downloaded or installed by
this integration.

Hash matches keep their existing semantics. Title aliases remain suggestions under the existing
admin approval flow. The export omits conflicting labels and known hacks/homebrew/bootlegs from
base-title guesses. Arcade short filenames and `arcade-names.json` retain their existing role.
Full identity/provider-link integration and the external resolver are separate from this small
dictionary adapter; this adapter does not claim that a fuzzy title proves a ROM's language,
exact patch version, core choice or achievements support.

No deployment or operational data change is needed to review this code. Test with a synthetic
export in an isolated data directory.
