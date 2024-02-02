export interface SerializableInterface {
  serializeState(out: Float32Array, offset: number): void;
  deserializeState(from: Float32Array, offset: number): void;
  serializeStateDerivative(out: Float32Array, offset: number): void;
}
