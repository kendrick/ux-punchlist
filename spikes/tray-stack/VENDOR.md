# Vendored files

`preact-htm.js` is `preact/standalone.module.js` from the `htm` package, version 3.1.1, copied byte for byte. It bundles Preact with htm and exports `html`, `render` and the hooks, so the tray loads it straight from the dev server with no bundler.

The provenance lives here rather than in a header comment so the file stays identical to the published one. To check it:

```sh
cd "$(mktemp -d)" && npm pack htm@3.1.1 && tar xzf htm-3.1.1.tgz && shasum -a 256 package/preact/standalone.module.js
```

The hash should match `shasum -a 256 spikes/tray-stack/preact-htm.js`: `72284e8e9079c87817145df1110f74e8a2aa040b2fc384922e18dfcb46fc1fd7`.
