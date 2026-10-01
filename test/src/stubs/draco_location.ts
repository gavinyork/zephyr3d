// Jest runs the engine sources as CommonJS, where `import.meta` does not exist.
// Stands in for libs/loaders/src/gltf/draco_location.ts.
export function defaultDracoDecoderPath() {
  return 'http://localhost/draco/';
}
