// Jest runs the engine sources as CommonJS, where `import.meta` does not exist.
// Stands in for libs/scene/src/asset/loaders/ktx2/basis_location.ts.
export function defaultBasisTranscoderPath() {
  return 'http://localhost/basis/';
}
