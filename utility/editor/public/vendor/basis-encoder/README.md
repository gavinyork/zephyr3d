# Basis Universal encoder

Unmodified prebuilt WebAssembly encoder from
[BinomialLLC/basis_universal](https://github.com/BinomialLLC/basis_universal),
tag `v2_50`, files `webgl/encoder/build/basis_encoder.{js,wasm}` (the
single-threaded build, which needs no SharedArrayBuffer or cross-origin
isolation). Licensed under the Apache License 2.0, see `LICENSE`.

Editor only: it compresses project textures into the derived-data cache. The
runtime ships just the transcoder. Keep the tag in step with the transcoder in
`libs/scene/src/asset/loaders/ktx2/basis` and bump `ENCODER_ID` in
`src/core/services/derivedtextures.ts` when updating, so stale cache entries are
re-encoded.
