# meshoptimizer

The engine bundles the decoder (`meshoptimizer/decoder`, binary `.zmsh` and glTF meshopt
compression) and the simplifier (`meshoptimizer/simplifier`, levels of detail) of
[zeux/meshoptimizer](https://github.com/zeux/meshoptimizer), npm package `meshoptimizer`.
Rollup copies them unmodified to `dist/node_modules/meshoptimizer/`; this `LICENSE`, the MIT
license of meshoptimizer, is copied beside them. Keep it in sync when updating the package.
