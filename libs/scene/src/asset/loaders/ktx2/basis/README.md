# Basis Universal transcoder

Unmodified prebuilt WebAssembly transcoder from
[BinomialLLC/basis_universal](https://github.com/BinomialLLC/basis_universal),
tag `v2_50`, files `webgl/transcoder/build/basis_transcoder.{js,wasm}`.
Licensed under the Apache License 2.0, see `LICENSE`.

The files are copied next to the built KTX2 loader and fetched on first use, so
pages that never load a `.ktx2` texture never download them. To update, replace
both files from a newer tag and re-check the `transcoder_texture_format` values in
`../ktx2_targets.ts` against `transcoder/basisu_transcoder.h` of that tag.
