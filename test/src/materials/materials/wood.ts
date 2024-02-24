import type { PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { LambertMaterial } from '@zephyr3d/scene';

/**
 * Reference: https://www.shadertoy.com/view/ldscDM
 */
export class WoodMaterial extends LambertMaterial {
  constructor() {
    super();
  }
  calculateAlbedoColor(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    pb.func('noise3d', [pb.vec3('p')], function () {
      this.$l.wave0 = pb.float(0);
      this.$l.wave1 = pb.float(0);
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-1.316, 0.918, 1.398))), 0.0783275458)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(0.295, -0.176, 2.167))), 0.0739931495)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-0.926, 1.445, 1.429))), 0.0716716966)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-1.878, -0.174, 1.258))), 0.0697839187)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-1.995, 0.661, -0.908))), 0.0685409863)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-1.77, 1.35, -0.905))), 0.0630152419)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(2.116, -0.021, 1.161))), 0.0625361712)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(0.405, -1.712, -1.855))), 0.0567751048)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(1.346, 0.945, 1.999))), 0.0556465603)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-0.397, -0.573, 2.495))), 0.0555747667)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(0.103, -2.457, -1.144))), 0.0516322279)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-0.483, -1.323, 2.33))), 0.051309332)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-1.715, -1.81, -1.164))), 0.0504567036)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(2.529, 0.479, 1.011))), 0.0500811899)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-1.643, -1.814, -1.437))), 0.0480875812)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(1.495, -1.905, -1.648))), 0.0458268348)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-1.874, 1.559, 1.762))), 0.0440084357)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(1.068, -2.09, 2.081))), 0.0413624154)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-0.647, -2.197, -2.237))), 0.040159283)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-2.146, -2.171, -1.135))), 0.039168294)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(2.538, -1.854, -1.604))), 0.0349588163)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(1.687, 2.191, -2.27))), 0.0342888847)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(0.205, 2.617, -2.481))), 0.0338465332)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(3.297, -0.44, -2.317))), 0.0289423448)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(1.068, -1.944, 3.432))), 0.0286404261)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-3.681, 1.068, 1.789))), 0.0273625684)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(3.116, 2.631, -1.658))), 0.0259772492)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-1.992, -2.902, -2.954))), 0.0245830241)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-2.409, -2.374, 3.116))), 0.0245592756)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(0.79, 1.768, 4.196))), 0.0244078334)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-3.289, 1.007, 3.148))), 0.0241328015)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(3.421, -2.663, 3.262))), 0.0199736126)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(3.062, 2.621, 3.649))), 0.019923029)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(4.422, -2.206, 2.621))), 0.0192399437)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(2.714, 3.022, 4.2))), 0.0182510631)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-0.451, 4.143, -4.142))), 0.0181293526)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-5.838, -0.36, -1.536))), 0.0175114826)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-0.278, -4.565, 4.149))), 0.0170799341)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-5.893, -0.163, -2.141))), 0.0167655258)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(4.855, -4.153, 0.606))), 0.0163155335)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(4.498, 0.987, -4.488))), 0.0162770287)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-1.463, 5.321, -3.315))), 0.0162569125)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-1.862, 4.386, 4.749))), 0.0154338176)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(0.563, 3.616, -5.751))), 0.0151952226)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-0.126, 2.569, -6.349))), 0.0151089405)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-5.094, 4.759, 0.186))), 0.0147947096)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(1.319, 5.713, 3.845))), 0.0147035221)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(7.141, -0.327, 1.42))), 0.014057391)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(3.888, 6.543, 0.547))), 0.013330985)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-1.898, -3.563, -6.483))), 0.013317136)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(1.719, 7.769, 0.34))), 0.0126913718)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-2.21, -7.836, 0.102))), 0.0123746071)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(6.248, -5.451, 1.866))), 0.0117861898)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(1.627, -7.066, -4.732))), 0.0115417453)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(4.099, -7.704, 1.474))), 0.0112591564)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(7.357, 3.788, 3.204))), 0.0112252325)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-2.797, 6.208, 6.253))), 0.0107206906)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(6.13, -5.335, -4.65))), 0.0105693992)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(5.276, -5.576, -5.438))), 0.0105139072)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(9.148, 2.53, -0.383))), 0.0103996383)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(3.894, 2.559, 8.357))), 0.0103161113)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-6.604, 8.024, -0.289))), 0.0094066875)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-5.925, 6.505, -6.403))), 0.0089444733)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(9.085, 10.331, -0.451))), 0.0069245599)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-8.228, 6.323, -9.9))), 0.0066251015)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(10.029, -3.802, 12.151))), 0.0058122824)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-10.151, -6.513, -11.063))), 0.0057522358)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-1.773, -16.284, 2.828))), 0.0056578101)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(11.081, 8.687, -9.852))), 0.0054614334)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-3.941, -4.386, 16.191))), 0.0054454253)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-6.742, 2.133, -17.268))), 0.0050050132)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-10.743, 5.698, 14.975))), 0.0048323955)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-9.603, 12.472, 14.542))), 0.0043264378)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(13.515, 14.345, 8.481))), 0.0043208884)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-10.33, 16.209, -9.742))), 0.0043013736)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-8.58, -6.628, 19.191))), 0.0042005922)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-17.154, 10.62, 11.828))), 0.0039482427)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(16.33, 14.123, -10.42))), 0.0038474789)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-21.275, 10.768, -3.252))), 0.0038320501)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(1.744, 7.922, 23.152))), 0.0037560829)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-3.895, 21.321, 12.006))), 0.0037173885)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-22.705, 2.543, 10.695))), 0.0036484394)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-13.053, -16.634, -13.993))), 0.0036291121)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(22.697, -11.23, 1.417))), 0.0036280459)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(20.646, 14.602, 3.4))), 0.0036055008)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(5.824, -8.717, -23.68))), 0.0035501527)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(6.691, 15.499, 20.079))), 0.0035029508)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(9.926, -22.778, 9.144))), 0.0034694278)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-9.552, -27.491, 2.197))), 0.0031359281)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(21.071, -17.991, -11.566))), 0.003045328)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(9.78, 1.783, 28.536))), 0.0030251754)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(8.738, -18.373, 22.725))), 0.0029960272)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(14.105, 25.703, -8.834))), 0.0029840058)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-24.926, -17.766, -4.74))), 0.0029487709)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(1.06, -1.57, 32.535))), 0.0027980099)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-24.532, -19.629, -16.759))), 0.0025538949)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(28.772, -21.183, -9.935))), 0.0024494819)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-28.413, 22.959, 8.338))), 0.0024236674)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-27.664, 22.197, 13.301))), 0.0023965996)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-27.421, 20.643, 18.713))), 0.0023203498)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(18.961, -7.189, 35.907))), 0.0021967023)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-23.949, 4.885, 33.762))), 0.0021727461)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(35.305, 8.594, 20.564))), 0.0021689816)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(30.364, -11.608, -27.199))), 0.0021357139)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(34.268, 26.742, 0.958))), 0.0020807976)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-26.376, -17.313, -32.023))), 0.002010885)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(31.86, -32.181, -2.834))), 0.0019919601)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(25.59, 32.34, 21.381))), 0.0019446179)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-17.771, -23.941, 37.324))), 0.0018898258)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-38.699, 19.953, -22.675))), 0.0018379538)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-46.284, 11.672, -15.411))), 0.0017980056)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-32.023, -43.976, -7.378))), 0.0016399251)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-42.39, -21.165, -31.889))), 0.0015752176)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-18.949, -40.461, 39.107))), 0.0015141244)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-21.507, -5.939, -58.531))), 0.0014339601)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-51.745, -43.821, 9.651))), 0.0013096306)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(39.239, 25.971, -52.615))), 0.0012701774)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-49.669, -35.051, -36.306))), 0.0012661695)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-49.996, 35.309, 38.46))), 0.001239887)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(27.0, -65.904, -36.267))), 0.0011199347)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-52.523, -26.557, 57.693))), 0.0010856391)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-42.67, 0.269, -71.125))), 0.0010786551)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-9.377, 64.575, -68.151))), 0.0009468199)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(14.571, -29.16, 106.329))), 0.0008019719)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-21.549, 103.887, 36.882))), 0.0007939609)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-42.781, 110.966, -9.07))), 0.0007473261)
      );
      this.wave0 = pb.add(
        this.wave0,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(-112.686, 18.296, -37.92))), 0.0007409259)
      );
      this.wave1 = pb.add(
        this.wave1,
        pb.mul(pb.sin(pb.dot(this.p, pb.vec3(71.493, 33.838, -96.931))), 0.0007121903)
      );
      this.$return(pb.add(this.wave0, this.wave1));
    });
    pb.func('repramp', [pb.float('x')], function () {
      this.$return(
        pb.add(pb.pow(pb.add(pb.mul(pb.sin(this.x), 0.5), 0.5), 8), pb.mul(pb.cos(this.x), 0.7), 0.7)
      );
    });
    pb.func('wood', [pb.vec3('p')], function () {
      const a = this.noise3d(pb.mul(this.p, pb.vec3(8, 1.5, 8)));
      const b = this.noise3d(pb.add(pb.mul(this.p, pb.vec3(-8, -1.5, -8)), pb.vec3(4.5678)));
      this.$l.rings = pb.div(
        this.repramp(pb.mul(pb.length(pb.add(this.p.xz, pb.mul(pb.vec2(a, b), 0.05))), 64)),
        1.8
      );
      this.rings = pb.sub(this.rings, pb.mul(this.noise3d(this.p), 0.75));
      this.$l.color = pb.mul(
        pb.mix(pb.mul(pb.vec3(0.3, 0.19, 0.075), 0.95), pb.mul(pb.vec3(1, 0.73, 0.326), 0.4), this.rings),
        1.5
      );
      this.color = pb.max(pb.vec3(0), this.color);
      this.$l.rough = pb.add(pb.mul(this.noise3d(pb.mul(this.p, pb.vec3(1, 0.2, 1), 64)), 0.1), 0.9);
      this.color = pb.mul(this.color, this.rough);
      this.color = pb.clamp(this.color, pb.vec3(0), pb.vec3(1));
      this.$return(pb.vec4(this.color, 1));
    });
    return scope.wood(scope.$inputs.oPos);
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    scope.$outputs.oPos = scope.$getVertexAttrib('position');
    this.helper.transformVertexAndNormal(scope);
  }
}
