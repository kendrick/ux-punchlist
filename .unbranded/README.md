# The unbranded Sidecar

[unbranded](https://github.com/kendrick/unbranded-starter) scaffolded some of this project's tooling config, and this directory is its working data. `baseline/` keeps a byte-exact copy of each managed file as unbranded last wrote it, named with a `.base` suffix so formatters, linters, and other tools that walk the tree don't read the copies as live config.

## Why It Should Be Committed

The baselines are what let `unbranded update` pull newer template versions into your repo without losing local edits: with the original bytes on hand, it can merge your changes and the template's changes instead of asking you to pick one wholesale. Baselines only work if they travel with the repo, so commit this directory like any other file.

Deleting it breaks nothing today, but `unbranded update` would lose its merge base and fall back to asking before overwriting each changed file.

`unbranded diff` shows how your files have drifted from what was scaffolded; `unbranded doctor` audits the repo.
