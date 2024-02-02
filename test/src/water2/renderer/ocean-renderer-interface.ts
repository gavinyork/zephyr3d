import { Camera } from '../graphics';
import { OceanField } from '../ocean';

export interface OceanRendererInterface<S> {
  render(camera: Camera, oceanField: OceanField): void;
  getSettings(): Readonly<S>;
  setSettings(settings: Partial<S>): void;
}
