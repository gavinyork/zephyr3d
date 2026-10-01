# Draco decoder

Unmodified prebuilt glTF decoder from [google/draco](https://github.com/google/draco),
tag `1.5.7`, files `javascript/draco_wasm_wrapper_gltf.js` and
`javascript/draco_decoder_gltf.wasm`. Licensed under the Apache License 2.0, see
`LICENSE`.

The glTF build only decodes what KHR_draco_mesh_compression can contain, which
makes it about a third smaller than the general decoder. The files are copied
next to the built glTF importer and fetched the first time a Draco compressed
model is loaded.
