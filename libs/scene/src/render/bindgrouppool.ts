import { BindGroup, ProgramBuilder } from "@zephyr3d/device";
import { DrawContext, Drawable } from "./drawable";
import { Material, ShaderHelper } from "../material";
import { Application } from "../app";

export class BindGroupPool {
  private static _drawableBindGroups: Map<Drawable, [BindGroup, BindGroup, number]> = new Map();
  private static _drawableBindGroupsSkin: Map<Drawable, [BindGroup, BindGroup, number]> = new Map();
  private static _drawableBindGroupsInstanced: Map<Drawable, [BindGroup, BindGroup, number]> = new Map();
  private static _materialBindGroups: Map<Material, Record<string, BindGroup>> = new Map();
  static updateDrawableBindGroup(drawable: Drawable, ctx: DrawContext) {
    const skinning = !!drawable.getBoneMatrices();
    const instancing = !!ctx.instanceData;
    const pool = skinning
      ? this._drawableBindGroupsSkin
      : instancing
        ? this._drawableBindGroupsInstanced
        : this._drawableBindGroups;
    let value = pool.get(drawable);
    if (!value) {
      const bindGroups = this.createDrawableBindGroup(instancing, skinning);
      value = [bindGroups[0], bindGroups[1], -1];
      pool.set(drawable, value);
    }
    if (value[2] !== drawable.getXForm().getTag()) {
      if (instancing) {
        
      }
    }
  }
  private static createDrawableBindGroup(instancing: boolean, skinning: boolean): [BindGroup, BindGroup] {
    const device = Application.instance.device;
    const buildInfo = new ProgramBuilder(device).buildRender({
      vertex(pb) {
        ShaderHelper.vertexShaderDrawableStuff(this, skinning, instancing);
        pb.main(function () {});
      },
      fragment(pb) {
        ShaderHelper.fragmentShaderDrawableStuff(this, instancing);
        pb.main(function () {});
      }
    });
    const bindGroup1 = buildInfo[2][1] ? device.createBindGroup(buildInfo[2][1]) : null;
    const bindGroup3 = buildInfo[2][3] ? device.createBindGroup(buildInfo[2][3]) : null;
    return [bindGroup1, bindGroup3];
  }
}