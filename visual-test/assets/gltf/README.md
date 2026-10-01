Duck model from the Khronos glTF Sample Assets
(commit f36bfdabd1031c3cf6689a50570b8cdf3678b49c, `Models/Duck`), licensed under
the SCEA Shared Source License 1.0:
https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Duck

- `duck-draco/`: the upstream `glTF-Draco` variant, unmodified (KHR_draco_mesh_compression)
- `duck-meshopt/`: `glTF-Binary/Duck.glb` run through `gltfpack 1.3.0 -cc`
  (EXT_meshopt_compression + KHR_mesh_quantization + KHR_texture_transform)
