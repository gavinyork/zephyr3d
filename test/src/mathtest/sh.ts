// import { Vector3, XMSHEvalDirectionalLight } from '@zephyr3d/base';
// import { randNonZero } from './common';
/* SH product shader

precision highp float;

varying vec2      vTexCoord;
uniform vec2      texelSize;
uniform sampler2D color;
uniform float     harmonics[9];

const float pi = 3.14159265;


vec2 paraboloid_project(vec3 v) {
	vec3 n = normalize(v + vec3(0.0, 0.0, 1.0));
	return n.xy / n.z;
}

vec3 paraboloid_unproject(vec2 xy) {
	float z = (1.0 - dot(xy, xy)) / 2.0;
	return normalize(vec3(xy, z));
}


vec4 toRGBE_signed(vec3 c) {
	vec3 c_abs = abs(c);
	float x = max(c_abs.r, max(c_abs.g, c_abs.b));
	float y = ceil(log2(x));
	return vec4(0.5 * c / exp2(y) + 0.5, (y + 128.0) / 255.0);
}

vec3 fromRGBE_signed(vec4 rgbe) {
	float v = exp2(255.0 * rgbe.a - 128.0);
	return v * (2.0 * rgbe.rgb - 1.0);
}


vec4 toRGBE(vec3 c) {
	vec3 c_abs = abs(c);
	float x = max(c_abs.r, max(c_abs.g, c_abs.b));
	float y = ceil(log2(x));
	return x <= 0.0 ? vec4(0) : vec4(c / exp2(y), (y + 128.0) / 255.0);
}

vec3 fromRGBE(vec4 rgbe) {
	float v = exp2(255.0 * rgbe.a - 128.0);
	return v * rgbe.rgb;
}


// real-valued spherical harmonics borrowed from Wikipedia

float sh_project_band0 = 1.0/2.0 * sqrt(1.0/pi);

void sh_project_band1(vec3 n, out float Y1[3]) {
	Y1[0] = sqrt(3.0/4.0/pi) * n.y;
	Y1[1] = sqrt(3.0/4.0/pi) * n.z;
	Y1[2] = sqrt(3.0/4.0/pi) * n.x;
}

void sh_project_band2(vec3 n, out float Y2[5]) {
	vec3 n2 = n * n;

	Y2[0] = 1.0/2.0 * sqrt(15.0/pi) * n.x * n.y;
	Y2[1] = 1.0/2.0 * sqrt(15.0/pi) * n.y * n.z;
	Y2[2] = 1.0/4.0 * sqrt( 5.0/pi) * (2.0*n2.z - n2.x - n2.y);
	Y2[3] = 1.0/2.0 * sqrt(15.0/pi) * n.z * n.x;
	Y2[4] = 1.0/4.0 * sqrt(15.0/pi) * (n2.x - n2.y);
}

float sh_lookup(float x[9], vec3 n) {
	float Y0 = sh_project_band0;
	float Y1[3];
	float Y2[5];
	sh_project_band1(n, Y1);
	sh_project_band2(n, Y2);

	float value = float(0.0);
	value += x[0] * Y0;
	value += x[1] * Y1[0];
	value += x[2] * Y1[1];
	value += x[3] * Y1[2];
	value += x[4] * Y2[0];
	value += x[5] * Y2[1];
	value += x[6] * Y2[2];
	value += x[7] * Y2[3];
	value += x[8] * Y2[4];

	return value;
}


void main(void) {
	vec4 rgbe = texture2D(color, vTexCoord);
	vec3 L = fromRGBE(rgbe);

	vec2 xy  = 2.0 * vTexCoord - 1.0;
	vec2 xy0 = 2.0 * (vTexCoord - 0.5 * texelSize) - 1.0;
	vec2 xy1 = 2.0 * (vTexCoord + 0.5 * texelSize) - 1.0;

	vec3 v   = paraboloid_unproject(xy);
	vec3 v_x = paraboloid_unproject(vec2(xy1.x, xy.y))
	         - paraboloid_unproject(vec2(xy0.x, xy.y));
	vec3 v_y = paraboloid_unproject(vec2(xy.x, xy1.y))
	         - paraboloid_unproject(vec2(xy.x, xy0.y));

	float Y = sh_lookup(harmonics, v);
	float solid_angle = length(cross(v_x, v_y));

	vec3 c = L * Y * solid_angle;

	gl_FragColor = toRGBE_signed(v.z < 0.0 ? vec3(0.0) : c);
}s
*/

/* sum frag shader
precision highp float;

varying vec2      vTexCoord;
uniform vec2      texelSize;
uniform sampler2D color;


vec4 toRGBE_signed(vec3 c) {
	vec3 c_abs = abs(c);
	float x = max(c_abs.r, max(c_abs.g, c_abs.b));
	float y = ceil(log2(x));
	return vec4(0.5 * c / exp2(y) + 0.5, (y + 128.0) / 255.0);
}

vec3 fromRGBE_signed(vec4 rgbe) {
	float v = exp2(255.0 * rgbe.a - 128.0);
	return v * (2.0 * rgbe.rgb - 1.0);
}


void main (void) {
	vec2 d_uv = texelSize / 4.0;
	vec2 uv0  = vTexCoord;

	vec3 c = vec3(0);

	c += fromRGBE_signed(texture2D(color, uv0 + vec2(-1.5, -1.5) * d_uv));
	c += fromRGBE_signed(texture2D(color, uv0 + vec2(-0.5, -1.5) * d_uv));
	c += fromRGBE_signed(texture2D(color, uv0 + vec2( 0.5, -1.5) * d_uv));
	c += fromRGBE_signed(texture2D(color, uv0 + vec2( 1.5, -1.5) * d_uv));

	c += fromRGBE_signed(texture2D(color, uv0 + vec2(-1.5, -0.5) * d_uv));
	c += fromRGBE_signed(texture2D(color, uv0 + vec2(-0.5, -0.5) * d_uv));
	c += fromRGBE_signed(texture2D(color, uv0 + vec2( 0.5, -0.5) * d_uv));
	c += fromRGBE_signed(texture2D(color, uv0 + vec2( 1.5, -0.5) * d_uv));

	c += fromRGBE_signed(texture2D(color, uv0 + vec2(-1.5,  0.5) * d_uv));
	c += fromRGBE_signed(texture2D(color, uv0 + vec2(-0.5,  0.5) * d_uv));
	c += fromRGBE_signed(texture2D(color, uv0 + vec2( 0.5,  0.5) * d_uv));
	c += fromRGBE_signed(texture2D(color, uv0 + vec2( 1.5,  0.5) * d_uv));

	c += fromRGBE_signed(texture2D(color, uv0 + vec2(-1.5,  1.5) * d_uv));
	c += fromRGBE_signed(texture2D(color, uv0 + vec2(-0.5,  1.5) * d_uv));
	c += fromRGBE_signed(texture2D(color, uv0 + vec2( 0.5,  1.5) * d_uv));
	c += fromRGBE_signed(texture2D(color, uv0 + vec2( 1.5,  1.5) * d_uv));

	gl_FragColor = toRGBE_signed(c);
}
*/

export function testSH() {
  /*
  function randVec(): Vector3 {
    return new Vector3(randNonZero(), randNonZero(), randNonZero());
  }
  function shLookup(R: Float32Array, G: Float32Array, B: Float32Array, normal: Vector3): Vector3 {
    const result = new Vector3(R[0], G[0], B[0]);
    result.addBy(new Vector3(R[1], G[1], B[1]).scaleBy(normal.x));
    result.addBy(new Vector3(R[2], G[2], B[2]).scaleBy(normal.y));
    result.addBy(new Vector3(R[3], G[3], B[3]).scaleBy(normal.z));
    result.addBy(new Vector3(R[4], G[4], B[4]).scaleBy(normal.z * normal.x));
    result.addBy(new Vector3(R[5], G[5], B[5]).scaleBy(normal.y * normal.z));
    result.addBy(new Vector3(R[6], G[6], B[6]).scaleBy(normal.x * normal.y));
    result.addBy(new Vector3(R[7], G[7], B[7]).scaleBy(3 * normal.z * normal.z - 1));
    result.addBy(new Vector3(R[8], G[8], B[8]).scaleBy(normal.x * normal.x - normal.y * normal.y));
    return result;
  }
  (function testEvalDirectionalLight() {
    const dir = randVec().inplaceNormalize();
    console.log(dir.toString());
    const color = Vector3.one();
    const order = 3;
    const R = new Float32Array(9);
    const G = new Float32Array(9);
    const B = new Float32Array(9);
    XMSHEvalDirectionalLight(3, dir, color, R, G, B);
    const c1 = shLookup(R, G, B, Vector3.axisPX());
    console.log(c1.toString());
    const c2 = shLookup(R, G, B, Vector3.axisPY());
    console.log(c2.toString());
    const c3 = shLookup(R, G, B, Vector3.axisPZ());
    console.log(c3.toString());
    const c4 = shLookup(R, G, B, dir);
    console.log(c4.toString());
    const c5 = shLookup(R, G, B, Vector3.scale(dir, -1));
    console.log(c5.toString());
  })();
*/
}
