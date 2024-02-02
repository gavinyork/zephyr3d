//-----------------------------------------------------------------------------------
// DirectXSH.cpp -- C++ Spherical Harmonics Math Library
//
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// http://go.microsoft.com/fwlink/p/?LinkId=262885
//-------------------------------------------------------------------------------------

import { Vector3, Vector4, Matrix4x4 } from './vector';

const SH_MINORDER = 2;
const SH_MAXORDER = 6;
const sqrtf = Math.sqrt;
const cosf = Math.cos;
const sinf = Math.sin;
const asinf = Math.asin;
const atan = Math.atan;
const XM_PI = Math.PI;
const XM_PIDIV2 = 1.570796327;
const tmpArray = new Float32Array(19);
const fExtraNormFac = [
  2.0 * sqrtf(XM_PI),
  (2.0 / 3.0) * sqrtf(3.0 * XM_PI),
  (2.0 / 5.0) * sqrtf(5.0 * XM_PI),
  (2.0 / 7.0) * sqrtf(7.0 * XM_PI),
  (2.0 / 3.0) * sqrtf(XM_PI),
  (2.0 / 11.0) * sqrtf(11.0 * XM_PI)
];

function CONSTANT(val: number): number {
  return val;
}

// computes the integral of a constant function over a solid angular
// extent.  No error checking - only used internaly.  This function
// only returns the Yl0 coefficients, since the rest are zero for
// circularly symmetric functions.
const ComputeCapInt_t1 = sqrtf(0.3141593e1);
const ComputeCapInt_t5 = sqrtf(3.0);
const ComputeCapInt_t11 = sqrtf(5.0);
const ComputeCapInt_t18 = sqrtf(7.0);
const ComputeCapInt_t32 = sqrtf(11.0);

function ComputeCapInt(order: number, angle: number, pR: Float32Array) {
  const t2 = cosf(angle);
  const t3 = ComputeCapInt_t1 * t2;
  const t7 = sinf(angle);
  const t8 = t7 * t7;

  pR[0] = -t3 + ComputeCapInt_t1;
  pR[1] = (ComputeCapInt_t5 * ComputeCapInt_t1 * t8) / 2.0;

  if (order > 2) {
    const t13 = t2 * t2;

    pR[2] = (-ComputeCapInt_t11 * ComputeCapInt_t1 * t2 * (t13 - 1.0)) / 2.0;
    if (order > 3) {
      const t19 = ComputeCapInt_t18 * ComputeCapInt_t1;
      const t20 = t13 * t13;

      pR[3] = (-5.0 / 8.0) * t19 * t20 + (3.0 / 4.0) * t19 * t13 - t19 / 8.0;
      if (order > 4) {
        pR[4] = (-3.0 / 8.0) * t3 * (7.0 * t20 - 10.0 * t13 + 3.0);
        if (order > 5) {
          const t33 = ComputeCapInt_t32 * ComputeCapInt_t1;
          pR[5] =
            (-21.0 / 16.0) * t33 * t20 * t13 +
            (35.0 / 16.0) * t33 * t20 -
            (15.0 / 16.0) * t33 * t13 +
            t33 / 16.0;
        }
      }
    }
  }
}

// input pF only consists of Yl0 values, normalizes coefficients for directional
// lights.
function CosWtInt(order: number): number {
  const fCW0 = 0.25;
  const fCW1 = 0.5;
  const fCW2 = 5.0 / 16.0;
  //const float fCW3 = 0.0;
  const fCW4 = -3.0 / 32.0;
  //const float fCW5 = 0.0;

  // order has to be at least linear...

  let fRet = fCW0 + fCW1;

  if (order > 2) fRet += fCW2;
  if (order > 4) fRet += fCW4;

  // odd degrees >= 3 evaluate to zero integrated against cosine...

  return fRet;
}

const SHEvalHemisphereLight_fSqrtPi = sqrtf(XM_PI);
const SHEvalHemisphereLight_fSqrtPi3 = sqrtf(XM_PI / 3.0);

// routine generated programmatically for evaluating SH basis for degree 1
// inputs (x,y,z) are a point on the sphere (i.e., must be unit length)
// output is vector b with SH basis evaluated at (x,y,z).
//
function sh_eval_basis_1(x: number, y: number, z: number, b: Float32Array) {
  /* m=0 */

  // l=0
  const p_0_0 = 0.28209479177387814;
  b[0] = p_0_0; // l=0,m=0
  // l=1
  const p_1_0 = 0.48860251190291992 * z;
  b[2] = p_1_0; // l=1,m=0

  /* m=1 */

  const s1 = y;
  const c1 = x;

  // l=1
  const p_1_1 = -0.48860251190291992;
  b[1] = p_1_1 * s1; // l=1,m=-1
  b[3] = p_1_1 * c1; // l=1,m=+1
}

// routine generated programmatically for evaluating SH basis for degree 2
// inputs (x,y,z) are a point on the sphere (i.e., must be unit length)
// output is vector b with SH basis evaluated at (x,y,z).
//
function sh_eval_basis_2(x: number, y: number, z: number, b: Float32Array) {
  const z2 = z * z;

  /* m=0 */

  // l=0
  const p_0_0 = 0.28209479177387814;
  b[0] = p_0_0; // l=0,m=0
  // l=1
  const p_1_0 = 0.48860251190291992 * z;
  b[2] = p_1_0; // l=1,m=0
  // l=2
  const p_2_0 = 0.94617469575756008 * z2 + -0.31539156525252005;
  b[6] = p_2_0; // l=2,m=0

  /* m=1 */

  const s1 = y;
  const c1 = x;

  // l=1
  const p_1_1 = -0.48860251190291992;
  b[1] = p_1_1 * s1; // l=1,m=-1
  b[3] = p_1_1 * c1; // l=1,m=+1
  // l=2
  const p_2_1 = -1.0925484305920792 * z;
  b[5] = p_2_1 * s1; // l=2,m=-1
  b[7] = p_2_1 * c1; // l=2,m=+1

  /* m=2 */

  const s2 = x * s1 + y * c1;
  const c2 = x * c1 - y * s1;

  // l=2
  const p_2_2 = 0.54627421529603959;
  b[4] = p_2_2 * s2; // l=2,m=-2
  b[8] = p_2_2 * c2; // l=2,m=+2
}

// routine generated programmatically for evaluating SH basis for degree 3
// inputs (x,y,z) are a point on the sphere (i.e., must be unit length)
// output is vector b with SH basis evaluated at (x,y,z).
//
function sh_eval_basis_3(x: number, y: number, z: number, b: Float32Array) {
  const z2 = z * z;

  /* m=0 */

  // l=0
  const p_0_0 = 0.28209479177387814;
  b[0] = p_0_0; // l=0,m=0
  // l=1
  const p_1_0 = 0.48860251190291992 * z;
  b[2] = p_1_0; // l=1,m=0
  // l=2
  const p_2_0 = 0.94617469575756008 * z2 + -0.31539156525252005;
  b[6] = p_2_0; // l=2,m=0
  // l=3
  const p_3_0 = z * (1.865881662950577 * z2 + -1.1195289977703462);
  b[12] = p_3_0; // l=3,m=0

  /* m=1 */

  const s1 = y;
  const c1 = x;

  // l=1
  const p_1_1 = -0.48860251190291992;
  b[1] = p_1_1 * s1; // l=1,m=-1
  b[3] = p_1_1 * c1; // l=1,m=+1
  // l=2
  const p_2_1 = -1.0925484305920792 * z;
  b[5] = p_2_1 * s1; // l=2,m=-1
  b[7] = p_2_1 * c1; // l=2,m=+1
  // l=3
  const p_3_1 = -2.2852289973223288 * z2 + 0.45704579946446577;
  b[11] = p_3_1 * s1; // l=3,m=-1
  b[13] = p_3_1 * c1; // l=3,m=+1

  /* m=2 */

  const s2 = x * s1 + y * c1;
  const c2 = x * c1 - y * s1;

  // l=2
  const p_2_2 = 0.54627421529603959;
  b[4] = p_2_2 * s2; // l=2,m=-2
  b[8] = p_2_2 * c2; // l=2,m=+2
  // l=3
  const p_3_2 = 1.4453057213202771 * z;
  b[10] = p_3_2 * s2; // l=3,m=-2
  b[14] = p_3_2 * c2; // l=3,m=+2

  /* m=3 */

  const s3 = x * s2 + y * c2;
  const c3 = x * c2 - y * s2;

  // l=3
  const p_3_3 = -0.59004358992664352;
  b[9] = p_3_3 * s3; // l=3,m=-3
  b[15] = p_3_3 * c3; // l=3,m=+3
}

// routine generated programmatically for evaluating SH basis for degree 4
// inputs (x,y,z) are a point on the sphere (i.e., must be unit length)
// output is vector b with SH basis evaluated at (x,y,z).
//
function sh_eval_basis_4(x: number, y: number, z: number, b: Float32Array) {
  const z2 = z * z;

  /* m=0 */

  // l=0
  const p_0_0 = 0.28209479177387814;
  b[0] = p_0_0; // l=0,m=0
  // l=1
  const p_1_0 = 0.48860251190291992 * z;
  b[2] = p_1_0; // l=1,m=0
  // l=2
  const p_2_0 = 0.94617469575756008 * z2 + -0.31539156525252005;
  b[6] = p_2_0; // l=2,m=0
  // l=3
  const p_3_0 = z * (1.865881662950577 * z2 + -1.1195289977703462);
  b[12] = p_3_0; // l=3,m=0
  // l=4
  const p_4_0 = 1.984313483298443 * z * p_3_0 + -1.0062305898749053 * p_2_0;
  b[20] = p_4_0; // l=4,m=0

  /* m=1 */

  const s1 = y;
  const c1 = x;

  // l=1
  const p_1_1 = -0.48860251190291992;
  b[1] = p_1_1 * s1; // l=1,m=-1
  b[3] = p_1_1 * c1; // l=1,m=+1
  // l=2
  const p_2_1 = -1.0925484305920792 * z;
  b[5] = p_2_1 * s1; // l=2,m=-1
  b[7] = p_2_1 * c1; // l=2,m=+1
  // l=3
  const p_3_1 = -2.2852289973223288 * z2 + 0.45704579946446577;
  b[11] = p_3_1 * s1; // l=3,m=-1
  b[13] = p_3_1 * c1; // l=3,m=+1
  // l=4
  const p_4_1 = z * (-4.683325804901024 * z2 + 2.0071396306718672);
  b[19] = p_4_1 * s1; // l=4,m=-1
  b[21] = p_4_1 * c1; // l=4,m=+1

  /* m=2 */

  const s2 = x * s1 + y * c1;
  const c2 = x * c1 - y * s1;

  // l=2
  const p_2_2 = 0.54627421529603959;
  b[4] = p_2_2 * s2; // l=2,m=-2
  b[8] = p_2_2 * c2; // l=2,m=+2
  // l=3
  const p_3_2 = 1.4453057213202771 * z;
  b[10] = p_3_2 * s2; // l=3,m=-2
  b[14] = p_3_2 * c2; // l=3,m=+2
  // l=4
  const p_4_2 = 3.3116114351514598 * z2 + -0.47308734787877998;
  b[18] = p_4_2 * s2; // l=4,m=-2
  b[22] = p_4_2 * c2; // l=4,m=+2

  /* m=3 */

  const s3 = x * s2 + y * c2;
  const c3 = x * c2 - y * s2;

  // l=3
  const p_3_3 = -0.59004358992664352;
  b[9] = p_3_3 * s3; // l=3,m=-3
  b[15] = p_3_3 * c3; // l=3,m=+3
  // l=4
  const p_4_3 = -1.7701307697799302 * z;
  b[17] = p_4_3 * s3; // l=4,m=-3
  b[23] = p_4_3 * c3; // l=4,m=+3

  /* m=4 */

  const s4 = x * s3 + y * c3;
  const c4 = x * c3 - y * s3;

  // l=4
  const p_4_4 = 0.62583573544917603;
  b[16] = p_4_4 * s4; // l=4,m=-4
  b[24] = p_4_4 * c4; // l=4,m=+4
}

// routine generated programmatically for evaluating SH basis for degree 5
// inputs (x,y,z) are a point on the sphere (i.e., must be unit length)
// output is vector b with SH basis evaluated at (x,y,z).
//
function sh_eval_basis_5(x: number, y: number, z: number, b: Float32Array) {
  const z2 = z * z;

  /* m=0 */

  // l=0
  const p_0_0 = CONSTANT(0.28209479177387814);
  b[0] = p_0_0; // l=0,m=0
  // l=1
  const p_1_0 = CONSTANT(0.48860251190291992) * z;
  b[2] = p_1_0; // l=1,m=0
  // l=2
  const p_2_0 = CONSTANT(0.94617469575756008) * z2 + CONSTANT(-0.31539156525252005);
  b[6] = p_2_0; // l=2,m=0
  // l=3
  const p_3_0 = z * (CONSTANT(1.865881662950577) * z2 + CONSTANT(-1.1195289977703462));
  b[12] = p_3_0; // l=3,m=0
  // l=4
  const p_4_0 = CONSTANT(1.984313483298443) * z * p_3_0 + CONSTANT(-1.0062305898749053) * p_2_0;
  b[20] = p_4_0; // l=4,m=0
  // l=5
  const p_5_0 = CONSTANT(1.9899748742132397) * z * p_4_0 + CONSTANT(-1.002853072844814) * p_3_0;
  b[30] = p_5_0; // l=5,m=0

  /* m=1 */

  const s1 = y;
  const c1 = x;

  // l=1
  const p_1_1 = CONSTANT(-0.48860251190291992);
  b[1] = p_1_1 * s1; // l=1,m=-1
  b[3] = p_1_1 * c1; // l=1,m=+1
  // l=2
  const p_2_1 = CONSTANT(-1.0925484305920792) * z;
  b[5] = p_2_1 * s1; // l=2,m=-1
  b[7] = p_2_1 * c1; // l=2,m=+1
  // l=3
  const p_3_1 = CONSTANT(-2.2852289973223288) * z2 + CONSTANT(0.45704579946446577);
  b[11] = p_3_1 * s1; // l=3,m=-1
  b[13] = p_3_1 * c1; // l=3,m=+1
  // l=4
  const p_4_1 = z * (CONSTANT(-4.683325804901024) * z2 + CONSTANT(2.0071396306718672));
  b[19] = p_4_1 * s1; // l=4,m=-1
  b[21] = p_4_1 * c1; // l=4,m=+1
  // l=5
  const p_5_1 = CONSTANT(2.0310096011589902) * z * p_4_1 + CONSTANT(-0.99103120896511465) * p_3_1;
  b[29] = p_5_1 * s1; // l=5,m=-1
  b[31] = p_5_1 * c1; // l=5,m=+1

  /* m=2 */

  const s2 = x * s1 + y * c1;
  const c2 = x * c1 - y * s1;

  // l=2
  const p_2_2 = CONSTANT(0.54627421529603959);
  b[4] = p_2_2 * s2; // l=2,m=-2
  b[8] = p_2_2 * c2; // l=2,m=+2
  // l=3
  const p_3_2 = CONSTANT(1.4453057213202771) * z;
  b[10] = p_3_2 * s2; // l=3,m=-2
  b[14] = p_3_2 * c2; // l=3,m=+2
  // l=4
  const p_4_2 = CONSTANT(3.3116114351514598) * z2 + CONSTANT(-0.47308734787877998);
  b[18] = p_4_2 * s2; // l=4,m=-2
  b[22] = p_4_2 * c2; // l=4,m=+2
  // l=5
  const p_5_2 = z * (CONSTANT(7.1903051774599875) * z2 + CONSTANT(-2.3967683924866621));
  b[28] = p_5_2 * s2; // l=5,m=-2
  b[32] = p_5_2 * c2; // l=5,m=+2

  /* m=3 */

  const s3 = x * s2 + y * c2;
  const c3 = x * c2 - y * s2;

  // l=3
  const p_3_3 = CONSTANT(-0.59004358992664352);
  b[9] = p_3_3 * s3; // l=3,m=-3
  b[15] = p_3_3 * c3; // l=3,m=+3
  // l=4
  const p_4_3 = CONSTANT(-1.7701307697799302) * z;
  b[17] = p_4_3 * s3; // l=4,m=-3
  b[23] = p_4_3 * c3; // l=4,m=+3
  // l=5
  const p_5_3 = CONSTANT(-4.4031446949172537) * z2 + CONSTANT(0.48923829943525043);
  b[27] = p_5_3 * s3; // l=5,m=-3
  b[33] = p_5_3 * c3; // l=5,m=+3

  /* m=4 */

  const s4 = x * s3 + y * c3;
  const c4 = x * c3 - y * s3;

  // l=4
  const p_4_4 = CONSTANT(0.62583573544917603);
  b[16] = p_4_4 * s4; // l=4,m=-4
  b[24] = p_4_4 * c4; // l=4,m=+4
  // l=5
  const p_5_4 = CONSTANT(2.0756623148810411) * z;
  b[26] = p_5_4 * s4; // l=5,m=-4
  b[34] = p_5_4 * c4; // l=5,m=+4

  /* m=5 */

  const s5 = x * s4 + y * c4;
  const c5 = x * c4 - y * s4;

  // l=5
  const p_5_5 = CONSTANT(-0.65638205684017015);
  b[25] = p_5_5 * s5; // l=5,m=-5
  b[35] = p_5_5 * c5; // l=5,m=+5
}

const M_PIjs = 4.0 * atan(1.0);
const maxang = M_PIjs / 2;
const NSH0 = 1;
const NSH1 = 4;
const NSH2 = 9;
const NSH3 = 16;
const NSH4 = 25;
const NSH5 = 36;
const NSH6 = 49;
const NSH7 = 64;
const NSH8 = 81;
const NSH9 = 100;
const NL0 = 1;
const NL1 = 3;
const NL2 = 5;
const NL3 = 7;
const NL4 = 9;
const NL5 = 11;
const NL6 = 13;
const NL7 = 15;
const NL8 = 17;
const NL9 = 19;

function rot(ct: number, st: number, x: number, y: number): [number, number] {
  return [x * ct - y * st, y * ct + x * st];
}

function rot_inv(ct: number, st: number, x: number, y: number): [number, number] {
  return [x * ct + y * st, y * ct - x * st];
}

function rot_1(ct: number, st: number, ctm: number[], stm: number[]) {
  ctm[0] = ct;
  stm[0] = st;
}

function rot_2(ct: number, st: number, ctm: number[], stm: number[]) {
  const ct2 = CONSTANT(2.0) * ct;
  ctm[0] = ct;
  stm[0] = st;
  ctm[1] = ct2 * ct - CONSTANT(1.0);
  stm[1] = ct2 * st;
}

function rot_3(ct: number, st: number, ctm: number[], stm: number[]) {
  const ct2 = CONSTANT(2.0) * ct;
  ctm[0] = ct;
  stm[0] = st;
  ctm[1] = ct2 * ct - CONSTANT(1.0);
  stm[1] = ct2 * st;
  ctm[2] = ct2 * ctm[1] - ct;
  stm[2] = ct2 * stm[1] - st;
}

function rot_4(ct: number, st: number, ctm: number[], stm: number[]) {
  const ct2 = CONSTANT(2.0) * ct;
  ctm[0] = ct;
  stm[0] = st;
  ctm[1] = ct2 * ct - CONSTANT(1.0);
  stm[1] = ct2 * st;
  ctm[2] = ct2 * ctm[1] - ct;
  stm[2] = ct2 * stm[1] - st;
  ctm[3] = ct2 * ctm[2] - ctm[1];
  stm[3] = ct2 * stm[2] - stm[1];
}

function rot_5(ct: number, st: number, ctm: number[], stm: number[]) {
  const ct2 = CONSTANT(2.0) * ct;
  ctm[0] = ct;
  stm[0] = st;
  ctm[1] = ct2 * ct - CONSTANT(1.0);
  stm[1] = ct2 * st;
  ctm[2] = ct2 * ctm[1] - ct;
  stm[2] = ct2 * stm[1] - st;
  ctm[3] = ct2 * ctm[2] - ctm[1];
  stm[3] = ct2 * stm[2] - stm[1];
  ctm[4] = ct2 * ctm[3] - ctm[2];
  stm[4] = ct2 * stm[3] - stm[2];
}

function sh_rotz_1(ctm: number[], stm: number[], y: number[], yr: number[]) {
  yr[1] = y[1];
  const [yr0, yr2] = rot_inv(ctm[0], stm[0], y[0], y[2]);
  yr[0] = yr0;
  yr[2] = yr2;
}

function sh_rotz_2(ctm: number[], stm: number[], y: Float32Array, yr: Float32Array) {
  yr[2] = y[2];
  const [yr1, yr3] = rot_inv(ctm[0], stm[0], y[1], y[3]);
  const [yr0, yr4] = rot_inv(ctm[1], stm[1], y[0], y[4]);
  yr[0] = yr0;
  yr[1] = yr1;
  yr[3] = yr3;
  yr[4] = yr4;
}

function sh_rotz_3(ctm: number[], stm: number[], y: Float32Array, yr: Float32Array) {
  yr[3] = y[3];
  const [yr2, yr4] = rot_inv(ctm[0], stm[0], y[2], y[4]);
  const [yr1, yr5] = rot_inv(ctm[1], stm[1], y[1], y[5]);
  const [yr0, yr6] = rot_inv(ctm[2], stm[2], y[0], y[6]);
  yr[0] = yr0;
  yr[1] = yr1;
  yr[2] = yr2;
  yr[4] = yr4;
  yr[5] = yr5;
  yr[6] = yr6;
}

function sh_rotz_4(ctm: number[], stm: number[], y: Float32Array, yr: Float32Array) {
  yr[4] = y[4];
  const [yr3, yr5] = rot_inv(ctm[0], stm[0], y[3], y[5]);
  const [yr2, yr6] = rot_inv(ctm[1], stm[1], y[2], y[6]);
  const [yr1, yr7] = rot_inv(ctm[2], stm[2], y[1], y[7]);
  const [yr0, yr8] = rot_inv(ctm[3], stm[3], y[0], y[8]);
  yr[0] = yr0;
  yr[1] = yr1;
  yr[2] = yr2;
  yr[3] = yr3;
  yr[5] = yr5;
  yr[6] = yr6;
  yr[7] = yr7;
  yr[8] = yr8;
}

function sh_rotz_5(ctm: number[], stm: number[], y: Float32Array, yr: Float32Array) {
  yr[5] = y[5];
  const [yr4, yr6] = rot_inv(ctm[0], stm[0], y[4], y[6]);
  const [yr3, yr7] = rot_inv(ctm[1], stm[1], y[3], y[7]);
  const [yr2, yr8] = rot_inv(ctm[2], stm[2], y[2], y[8]);
  const [yr1, yr9] = rot_inv(ctm[3], stm[3], y[1], y[9]);
  const [yr0, yr10] = rot_inv(ctm[4], stm[4], y[0], y[10]);
  yr[0] = yr0;
  yr[1] = yr1;
  yr[2] = yr2;
  yr[3] = yr3;
  yr[4] = yr4;
  yr[6] = yr6;
  yr[7] = yr7;
  yr[8] = yr8;
  yr[9] = yr9;
  yr[10] = yr10;
}

// rotation code generated programmatically by rotatex (2000x4000 samples, eps=1e-008)

const fx_1_001 = sqrtf(1.0) / 1.0; // 1
const fx_1_002 = -sqrtf(1.0) / 1.0; // -1.00000030843

function sh_rotx90_1(y: number[], yr: number[]) {
  yr[0] = fx_1_001 * y[1];
  yr[1] = fx_1_002 * y[0];
  yr[2] = fx_1_001 * y[2];
}

function sh_rotx90_inv_1(y: number[], yr: number[]) {
  yr[0] = fx_1_002 * y[1];
  yr[1] = fx_1_001 * y[0];
  yr[2] = fx_1_001 * y[2];
}

const fx_2_001 = sqrtf(4.0) / 2.0; // 1
const fx_2_002 = -sqrtf(4.0) / 2.0; // -1
const fx_2_003 = -sqrtf(1.0) / 2.0; // -0.500000257021
const fx_2_004 = -sqrtf(3.0) / 2.0; // -0.866025848959
const fx_2_005 = sqrtf(1.0) / 2.0; // 0.5

function sh_rotx90_2(y: Float32Array, yr: Float32Array) {
  yr[0] = fx_2_001 * y[3];
  yr[1] = fx_2_002 * y[1];
  yr[2] = fx_2_003 * y[2] + fx_2_004 * y[4];
  yr[3] = fx_2_002 * y[0];
  yr[4] = fx_2_004 * y[2] + fx_2_005 * y[4];
}

function sh_rotx90_inv_2(y: Float32Array, yr: Float32Array) {
  yr[0] = fx_2_002 * y[3];
  yr[1] = fx_2_002 * y[1];
  yr[2] = fx_2_003 * y[2] + fx_2_004 * y[4];
  yr[3] = fx_2_001 * y[0];
  yr[4] = fx_2_004 * y[2] + fx_2_005 * y[4];
}

const fx_3_001 = -sqrtf(10.0) / 4.0; // -0.790569415042
const fx_3_002 = sqrtf(6.0) / 4.0; // 0.612372435696
const fx_3_003 = -sqrtf(16.0) / 4.0; // -1
const fx_3_004 = -sqrtf(6.0) / 4.0; // -0.612372435695
const fx_3_005 = -sqrtf(1.0) / 4.0; // -0.25
const fx_3_006 = -sqrtf(15.0) / 4.0; // -0.968245836551
const fx_3_007 = sqrtf(1.0) / 4.0; // 0.25
const fx_3_008 = sqrtf(10.0) / 4.0; // 0.790569983984

function sh_rotx90_3(y: Float32Array, yr: Float32Array) {
  yr[0] = fx_3_001 * y[3] + fx_3_002 * y[5];
  yr[1] = fx_3_003 * y[1];
  yr[2] = fx_3_004 * y[3] + fx_3_001 * y[5];
  yr[3] = fx_3_008 * y[0] + fx_3_002 * y[2];
  yr[4] = fx_3_005 * y[4] + fx_3_006 * y[6];
  yr[5] = fx_3_004 * y[0] - fx_3_001 * y[2];
  yr[6] = fx_3_006 * y[4] + fx_3_007 * y[6];
}

function sh_rotx90_inv_3(y: Float32Array, yr: Float32Array) {
  yr[0] = fx_3_008 * y[3] + fx_3_004 * y[5];
  yr[1] = fx_3_003 * y[1];
  yr[2] = fx_3_002 * y[3] - fx_3_001 * y[5];
  yr[3] = fx_3_001 * y[0] + fx_3_004 * y[2];
  yr[4] = fx_3_005 * y[4] + fx_3_006 * y[6];
  yr[5] = fx_3_002 * y[0] + fx_3_001 * y[2];
  yr[6] = fx_3_006 * y[4] + fx_3_007 * y[6];
}

const fx_4_001 = -sqrtf(56.0) / 8.0; // -0.935414346694
const fx_4_002 = sqrtf(8.0) / 8.0; // 0.353553390593
const fx_4_003 = -sqrtf(36.0) / 8.0; // -0.75
const fx_4_004 = sqrtf(28.0) / 8.0; // 0.661437827766
const fx_4_005 = -sqrtf(8.0) / 8.0; // -0.353553390593
const fx_4_006 = sqrtf(36.0) / 8.0; // 0.749999999999
const fx_4_007 = sqrtf(9.0) / 8.0; // 0.37500034698
const fx_4_008 = sqrtf(20.0) / 8.0; // 0.559017511622
const fx_4_009 = sqrtf(35.0) / 8.0; // 0.739510657141
const fx_4_010 = sqrtf(16.0) / 8.0; // 0.5
const fx_4_011 = -sqrtf(28.0) / 8.0; // -0.661437827766
const fx_4_012 = sqrtf(1.0) / 8.0; // 0.125
const fx_4_013 = sqrtf(56.0) / 8.0; // 0.935414346692

function sh_rotx90_4(y: Float32Array, yr: Float32Array) {
  yr[0] = fx_4_001 * y[5] + fx_4_002 * y[7];
  yr[1] = fx_4_003 * y[1] + fx_4_004 * y[3];
  yr[2] = fx_4_005 * y[5] + fx_4_001 * y[7];
  yr[3] = fx_4_004 * y[1] + fx_4_006 * y[3];
  yr[4] = fx_4_007 * y[4] + fx_4_008 * y[6] + fx_4_009 * y[8];
  yr[5] = fx_4_013 * y[0] + fx_4_002 * y[2];
  yr[6] = fx_4_008 * y[4] + fx_4_010 * y[6] + fx_4_011 * y[8];
  yr[7] = fx_4_005 * y[0] - fx_4_001 * y[2];
  yr[8] = fx_4_009 * y[4] + fx_4_011 * y[6] + fx_4_012 * y[8];
}

function sh_rotx90_inv_4(y: Float32Array, yr: Float32Array) {
  yr[0] = fx_4_013 * y[5] + fx_4_005 * y[7];
  yr[1] = fx_4_003 * y[1] + fx_4_004 * y[3];
  yr[2] = fx_4_002 * y[5] - fx_4_001 * y[7];
  yr[3] = fx_4_004 * y[1] + fx_4_006 * y[3];
  yr[4] = fx_4_007 * y[4] + fx_4_008 * y[6] + fx_4_009 * y[8];
  yr[5] = fx_4_001 * y[0] + fx_4_005 * y[2];
  yr[6] = fx_4_008 * y[4] + fx_4_010 * y[6] + fx_4_011 * y[8];
  yr[7] = fx_4_002 * y[0] + fx_4_001 * y[2];
  yr[8] = fx_4_009 * y[4] + fx_4_011 * y[6] + fx_4_012 * y[8];
}

const fx_5_001 = sqrtf(126.0) / 16.0; // 0.70156076002
const fx_5_002 = -sqrtf(120.0) / 16.0; // -0.684653196882
const fx_5_003 = sqrtf(10.0) / 16.0; // 0.197642353761
const fx_5_004 = -sqrtf(64.0) / 16.0; // -0.5
const fx_5_005 = sqrtf(192.0) / 16.0; // 0.866025403784
const fx_5_006 = sqrtf(70.0) / 16.0; // 0.522912516584
const fx_5_007 = sqrtf(24.0) / 16.0; // 0.306186217848
const fx_5_008 = -sqrtf(162.0) / 16.0; // -0.795495128835
const fx_5_009 = sqrtf(64.0) / 16.0; // 0.5
const fx_5_010 = sqrtf(60.0) / 16.0; // 0.484122918274
const fx_5_011 = sqrtf(112.0) / 16.0; // 0.661437827763
const fx_5_012 = sqrtf(84.0) / 16.0; // 0.572821961867
const fx_5_013 = sqrtf(4.0) / 16.0; // 0.125
const fx_5_014 = sqrtf(42.0) / 16.0; // 0.405046293649
const fx_5_015 = sqrtf(210.0) / 16.0; // 0.905711046633
const fx_5_016 = sqrtf(169.0) / 16.0; // 0.8125
const fx_5_017 = -sqrtf(45.0) / 16.0; // -0.419262745781
const fx_5_018 = sqrtf(1.0) / 16.0; // 0.0625
const fx_5_019 = -sqrtf(126.0) / 16.0; // -0.701561553415
const fx_5_020 = sqrtf(120.0) / 16.0; // 0.684653196881
const fx_5_021 = -sqrtf(10.0) / 16.0; // -0.197642353761
const fx_5_022 = -sqrtf(70.0) / 16.0; // -0.522913107945
const fx_5_023 = -sqrtf(60.0) / 16.0; // -0.48412346577

function sh_rotx90_5(y: Float32Array, yr: Float32Array) {
  yr[0] = fx_5_001 * y[5] + fx_5_002 * y[7] + fx_5_003 * y[9];
  yr[1] = fx_5_004 * y[1] + fx_5_005 * y[3];
  yr[2] = fx_5_006 * y[5] + fx_5_007 * y[7] + fx_5_008 * y[9];
  yr[3] = fx_5_005 * y[1] + fx_5_009 * y[3];
  yr[4] = fx_5_010 * y[5] + fx_5_011 * y[7] + fx_5_012 * y[9];
  yr[5] = fx_5_019 * y[0] + fx_5_022 * y[2] + fx_5_023 * y[4];
  yr[6] = fx_5_013 * y[6] + fx_5_014 * y[8] + fx_5_015 * y[10];
  yr[7] = fx_5_020 * y[0] - fx_5_007 * y[2] - fx_5_011 * y[4];
  yr[8] = fx_5_014 * y[6] + fx_5_016 * y[8] + fx_5_017 * y[10];
  yr[9] = fx_5_021 * y[0] - fx_5_008 * y[2] - fx_5_012 * y[4];
  yr[10] = fx_5_015 * y[6] + fx_5_017 * y[8] + fx_5_018 * y[10];
}

function sh_rotx90_inv_5(y: Float32Array, yr: Float32Array) {
  yr[0] = fx_5_019 * y[5] + fx_5_020 * y[7] + fx_5_021 * y[9];
  yr[1] = fx_5_004 * y[1] + fx_5_005 * y[3];
  yr[2] = fx_5_022 * y[5] - fx_5_007 * y[7] - fx_5_008 * y[9];
  yr[3] = fx_5_005 * y[1] + fx_5_009 * y[3];
  yr[4] = fx_5_023 * y[5] - fx_5_011 * y[7] - fx_5_012 * y[9];
  yr[5] = fx_5_001 * y[0] + fx_5_006 * y[2] + fx_5_010 * y[4];
  yr[6] = fx_5_013 * y[6] + fx_5_014 * y[8] + fx_5_015 * y[10];
  yr[7] = fx_5_002 * y[0] + fx_5_007 * y[2] + fx_5_011 * y[4];
  yr[8] = fx_5_014 * y[6] + fx_5_016 * y[8] + fx_5_017 * y[10];
  yr[9] = fx_5_003 * y[0] + fx_5_008 * y[2] + fx_5_012 * y[4];
  yr[10] = fx_5_015 * y[6] + fx_5_017 * y[8] + fx_5_018 * y[10];
}

function sh_rot_1(m: number[], y: Float32Array, yr: Float32Array) {
  const yr0 = m[4] * y[0] - m[5] * y[1] + m[3] * y[2];
  const yr1 = m[8] * y[1] - m[7] * y[0] - m[6] * y[2];
  const yr2 = m[1] * y[0] - m[2] * y[1] + m[0] * y[2];

  yr[0] = yr0;
  yr[1] = yr1;
  yr[2] = yr2;
}

function sh_roty_1(ctm: number[], stm: number[], y: number[], yr: number[]) {
  yr[0] = y[0];
  const [yr1, yr2] = rot_inv(ctm[0], stm[0], y[1], y[2]);
  yr[1] = yr1;
  yr[2] = yr2;
}

function sh_roty_2(ctm: number[], stm: number[], y: Float32Array, yr: Float32Array) {
  sh_rotx90_2(y, yr);
  sh_rotz_2(ctm, stm, yr, tmpArray);
  sh_rotx90_inv_2(tmpArray, yr);
}

function sh_roty_3(ctm: number[], stm: number[], y: Float32Array, yr: Float32Array) {
  sh_rotx90_3(y, yr);
  sh_rotz_3(ctm, stm, yr, tmpArray);
  sh_rotx90_inv_3(tmpArray, yr);
}

function sh_roty_4(ctm: number[], stm: number[], y: Float32Array, yr: Float32Array) {
  sh_rotx90_4(y, yr);
  sh_rotz_4(ctm, stm, yr, tmpArray);
  sh_rotx90_inv_4(tmpArray, yr);
}

function sh_roty_5(ctm: number[], stm: number[], y: Float32Array, yr: Float32Array) {
  sh_rotx90_5(y, yr);
  sh_rotz_5(ctm, stm, yr, tmpArray);
  sh_rotx90_inv_5(tmpArray, yr);
}

const ROT_TOL = CONSTANT(1e-4);

/*
Finds cosine,sine pairs for zyz rotation (i.e. rotation R_z2 R_y R_z1 v).
The rotation is one which maps mx to (1,0,0) and mz to (0,0,1).
*/
function zyz(m: number[]): number[] {
  const cz = m[8];
  let zc1, zs1, yc, ys, zc2, zs2: number;

  // rotate so that (cx,cy,0) aligns to (1,0,0)
  const cxylen = sqrtf(1.0 - cz * cz);
  if (cxylen >= ROT_TOL) {
    // if above is a NaN, will do the correct thing
    yc = cz;
    ys = cxylen;
    const len67inv = 1.0 / sqrtf(m[6] * m[6] + m[7] * m[7]);
    zc1 = -m[6] * len67inv;
    zs1 = m[7] * len67inv;
    const len25inv = 1.0 / sqrtf(m[2] * m[2] + m[5] * m[5]);
    zc2 = m[2] * len25inv;
    zs2 = m[5] * len25inv;
  } else {
    // m[6],m[7],m[8] already aligned to (0,0,1)
    zc1 = 1.0;
    zs1 = 0.0; // identity
    yc = cz;
    ys = 0.0; // identity
    zc2 = m[0] * cz;
    zs2 = -m[1]; // align x axis (mx[0],mx[1],0) to (1,0,0)
  }
  return [zc1, zs1, yc, ys, zc2, zs2];
}

function sh_rotzyz_2(
  zc1m: number[],
  zs1m: number[],
  ycm: number[],
  ysm: number[],
  zc2m: number[],
  zs2m: number[],
  y: Float32Array,
  yr: Float32Array
) {
  sh_rotz_2(zc1m, zs1m, y, yr);
  sh_roty_2(ycm, ysm, yr, tmpArray);
  sh_rotz_2(zc2m, zs2m, tmpArray, yr);
}

function sh_rotzyz_3(
  zc1m: number[],
  zs1m: number[],
  ycm: number[],
  ysm: number[],
  zc2m: number[],
  zs2m: number[],
  y: Float32Array,
  yr: Float32Array
) {
  sh_rotz_3(zc1m, zs1m, y, yr);
  sh_roty_3(ycm, ysm, yr, tmpArray);
  sh_rotz_3(zc2m, zs2m, tmpArray, yr);
}

function sh_rotzyz_4(
  zc1m: number[],
  zs1m: number[],
  ycm: number[],
  ysm: number[],
  zc2m: number[],
  zs2m: number[],
  y: Float32Array,
  yr: Float32Array
) {
  sh_rotz_4(zc1m, zs1m, y, yr);
  sh_roty_4(ycm, ysm, yr, tmpArray);
  sh_rotz_4(zc2m, zs2m, tmpArray, yr);
}

function sh_rotzyz_5(
  zc1m: number[],
  zs1m: number[],
  ycm: number[],
  ysm: number[],
  zc2m: number[],
  zs2m: number[],
  y: Float32Array,
  yr: Float32Array
) {
  sh_rotz_5(zc1m, zs1m, y, yr);
  sh_roty_5(ycm, ysm, yr, tmpArray);
  sh_rotz_5(zc2m, zs2m, tmpArray, yr);
}

function sh3_rot(
  m: number[],
  zc1: number,
  zs1: number,
  yc: number,
  ys: number,
  zc2: number,
  zs2: number,
  y: Float32Array,
  yr: Float32Array
) {
  const zc1m = [0, 0, 0];
  const zs1m = [0, 0, 0];
  rot_3(zc1, zs1, zc1m, zs1m);
  const ycm = [0, 0, 0];
  const ysm = [0, 0, 0];
  rot_3(yc, ys, ycm, ysm);
  const zc2m = [0, 0, 0];
  const zs2m = [0, 0, 0];
  rot_3(zc2, zs2, zc2m, zs2m);

  yr[0] = y[0];
  sh_rot_1(m, y.subarray(NSH0), yr.subarray(NSH0));
  sh_rotzyz_2(zc1m, zs1m, ycm, ysm, zc2m, zs2m, y.subarray(NSH1), yr.subarray(NSH1));
  sh_rotzyz_3(zc1m, zs1m, ycm, ysm, zc2m, zs2m, y.subarray(NSH2), yr.subarray(NSH2));
}

function sh4_rot(
  m: number[],
  zc1: number,
  zs1: number,
  yc: number,
  ys: number,
  zc2: number,
  zs2: number,
  y: Float32Array,
  yr: Float32Array
) {
  const zc1m = [0, 0, 0, 0];
  const zs1m = [0, 0, 0, 0];
  rot_4(zc1, zs1, zc1m, zs1m);
  const ycm = [0, 0, 0, 0];
  const ysm = [0, 0, 0, 0];
  rot_4(yc, ys, ycm, ysm);
  const zc2m = [0, 0, 0, 0];
  const zs2m = [0, 0, 0, 0];
  rot_4(zc2, zs2, zc2m, zs2m);

  yr[0] = y[0];
  sh_rot_1(m, y.subarray(NSH0), yr.subarray(NSH0));
  sh_rotzyz_2(zc1m, zs1m, ycm, ysm, zc2m, zs2m, y.subarray(NSH1), yr.subarray(NSH1));
  sh_rotzyz_3(zc1m, zs1m, ycm, ysm, zc2m, zs2m, y.subarray(NSH2), yr.subarray(NSH2));
  sh_rotzyz_4(zc1m, zs1m, ycm, ysm, zc2m, zs2m, y.subarray(NSH3), yr.subarray(NSH3));
}

function sh5_rot(
  m: number[],
  zc1: number,
  zs1: number,
  yc: number,
  ys: number,
  zc2: number,
  zs2: number,
  y: Float32Array,
  yr: Float32Array
) {
  const zc1m = [0, 0, 0, 0, 0];
  const zs1m = [0, 0, 0, 0, 0];
  rot_5(zc1, zs1, zc1m, zs1m);
  const ycm = [0, 0, 0, 0, 0];
  const ysm = [0, 0, 0, 0, 0];
  rot_5(yc, ys, ycm, ysm);
  const zc2m = [0, 0, 0, 0, 0];
  const zs2m = [0, 0, 0, 0, 0];
  rot_5(zc2, zs2, zc2m, zs2m);

  yr[0] = y[0];
  sh_rot_1(m, y.subarray(NSH0), yr.subarray(NSH0));
  sh_rotzyz_2(zc1m, zs1m, ycm, ysm, zc2m, zs2m, y.subarray(NSH1), yr.subarray(NSH1));
  sh_rotzyz_3(zc1m, zs1m, ycm, ysm, zc2m, zs2m, y.subarray(NSH2), yr.subarray(NSH2));
  sh_rotzyz_4(zc1m, zs1m, ycm, ysm, zc2m, zs2m, y.subarray(NSH3), yr.subarray(NSH3));
  sh_rotzyz_5(zc1m, zs1m, ycm, ysm, zc2m, zs2m, y.subarray(NSH4), yr.subarray(NSH4));
}

function sh1_rot(m: number[], y: Float32Array, yr: Float32Array) {
  yr[0] = y[0];
  sh_rot_1(m, y.subarray(NSH0), yr.subarray(NSH0));
}

function sh3_rot_n(m: number[], y: Float32Array, yr: Float32Array) {
  const [zc1, zs1, yc, ys, zc2, zs2] = zyz(m);
  sh3_rot(m, zc1, zs1, yc, ys, zc2, zs2, y, yr);
}

function sh4_rot_n(m: number[], y: Float32Array, yr: Float32Array) {
  const [zc1, zs1, yc, ys, zc2, zs2] = zyz(m);
  sh4_rot(m, zc1, zs1, yc, ys, zc2, zs2, y, yr);
}

function sh5_rot_n(m: number[], y: Float32Array, yr: Float32Array) {
  const [zc1, zs1, yc, ys, zc2, zs2] = zyz(m);
  sh5_rot(m, zc1, zs1, yc, ys, zc2, zs2, y, yr);
}

// simple matrix vector multiply for a square matrix (only used by ZRotation)
function SimpMatMul(dim: number, matrix: number[], input: Float32Array, result: Float32Array) {
  for (let iR = 0; iR < dim; ++iR) {
    result[iR + 0] = matrix[iR * dim + 0] * input[0];
    for (let iC = 1; iC < dim; ++iC) {
      result[iR] += matrix[iR * dim + iC] * input[iC];
    }
  }
}

//-------------------------------------------------------------------------------------
// Evaluates the Spherical Harmonic basis functions
//
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb205448.aspx
//-------------------------------------------------------------------------------------
function XMSHEvalDirection(result: Float32Array, order: number, dir: Vector3): Float32Array {
  const dv = dir;

  const fX = dv.x;
  const fY = dv.y;
  const fZ = dv.z;

  switch (order) {
    case 2:
      sh_eval_basis_1(fX, fY, fZ, result);
      break;

    case 3:
      sh_eval_basis_2(fX, fY, fZ, result);
      break;

    case 4:
      sh_eval_basis_3(fX, fY, fZ, result);
      break;

    case 5:
      sh_eval_basis_4(fX, fY, fZ, result);
      break;

    case 6:
      sh_eval_basis_5(fX, fY, fZ, result);
      break;

    default:
      return null;
  }

  return result;
}

//-------------------------------------------------------------------------------------
// Rotates SH vector by a rotation matrix
//
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb204992.aspx
//-------------------------------------------------------------------------------------
function XMSHRotate(
  result: Float32Array,
  order: number,
  rotMatrix: Matrix4x4,
  input: Float32Array
): Float32Array {
  if (!result || !input) return null;

  if (result == input) return null;

  const mat = rotMatrix;

  const mRot: number[] = [];
  const r00 = (mRot[0 * 3 + 0] = mat.m00);
  const r10 = (mRot[1 * 3 + 0] = mat.m10);
  const r20 = (mRot[2 * 3 + 0] = mat.m20);

  const r01 = (mRot[0 * 3 + 1] = mat.m01);
  const r11 = (mRot[1 * 3 + 1] = mat.m11);
  const r21 = (mRot[2 * 3 + 1] = mat.m21);

  const r02 = (mRot[0 * 3 + 2] = mat.m02);
  const r12 = (mRot[1 * 3 + 2] = mat.m12);
  const r22 = (mRot[2 * 3 + 2] = mat.m22);

  result[0] = input[0]; // rotate the constant term

  switch (order) {
    case 2:
      {
        // do linear by hand...

        result[1] = r11 * input[1] - r12 * input[2] + r10 * input[3];
        result[2] = -r21 * input[1] + r22 * input[2] - r20 * input[3];
        result[3] = r01 * input[1] - r02 * input[2] + r00 * input[3];
      }
      break;

    case 3:
      {
        const R: number[] = [];
        // do linear by hand...

        result[1] = r11 * input[1] - r12 * input[2] + r10 * input[3];
        result[2] = -r21 * input[1] + r22 * input[2] - r20 * input[3];
        result[3] = r01 * input[1] - r02 * input[2] + r00 * input[3];

        // direct code for quadratics is faster than ZYZ reccurence relations

        const t41 = r01 * r00;
        const t43 = r11 * r10;
        const t48 = r11 * r12;
        const t50 = r01 * r02;
        const t55 = r02 * r02;
        const t57 = r22 * r22;
        const t58 = r12 * r12;
        const t61 = r00 * r02;
        const t63 = r10 * r12;
        const t68 = r10 * r10;
        const t70 = r01 * r01;
        const t72 = r11 * r11;
        const t74 = r00 * r00;
        const t76 = r21 * r21;
        const t78 = r20 * r20;

        const v173 = 0.1732050808e1;
        const v577 = 0.5773502693;
        const v115 = 0.1154700539e1;
        const v288 = 0.2886751347;
        const v866 = 0.866025404;

        R[0] = r11 * r00 + r01 * r10;
        R[1] = -r01 * r12 - r11 * r02;
        R[2] = v173 * r02 * r12;
        R[3] = -r10 * r02 - r00 * r12;
        R[4] = r00 * r10 - r01 * r11;
        R[5] = -r11 * r20 - r21 * r10;
        R[6] = r11 * r22 + r21 * r12;
        R[7] = -v173 * r22 * r12;
        R[8] = r20 * r12 + r10 * r22;
        R[9] = -r10 * r20 + r11 * r21;
        R[10] = -v577 * (t41 + t43) + v115 * r21 * r20;
        R[11] = v577 * (t48 + t50) - v115 * r21 * r22;
        R[12] = -0.5 * (t55 + t58) + t57;
        R[13] = v577 * (t61 + t63) - v115 * r20 * r22;
        R[14] = v288 * (t70 - t68 + t72 - t74) - v577 * (t76 - t78);
        R[15] = -r01 * r20 - r21 * r00;
        R[16] = r01 * r22 + r21 * r02;
        R[17] = -v173 * r22 * r02;
        R[18] = r00 * r22 + r20 * r02;
        R[19] = -r00 * r20 + r01 * r21;
        R[20] = t41 - t43;
        R[21] = -t50 + t48;
        R[22] = v866 * (t55 - t58);
        R[23] = t63 - t61;
        R[24] = 0.5 * (t74 - t68 - t70 + t72);

        // blow the matrix multiply out by hand, looping is ineficient on a P4...
        for (let iR = 0; iR < 5; iR++) {
          const uBase = iR * 5;
          result[4 + iR] =
            R[uBase + 0] * input[4] +
            R[uBase + 1] * input[5] +
            R[uBase + 2] * input[6] +
            R[uBase + 3] * input[7] +
            R[uBase + 4] * input[8];
        }
      }
      break;

    case 4:
      sh3_rot_n(mRot, input, result);
      break;

    case 5:
      sh4_rot_n(mRot, input, result);
      break;

    case 6:
      sh5_rot_n(mRot, input, result);
      break;

    default:
      return null;
  }

  return result;
}

//-------------------------------------------------------------------------------------
// Rotates the SH vector in the Z axis by an angle
//
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb205461.aspx
//-------------------------------------------------------------------------------------
function XMSHRotateZ(result: Float32Array, order: number, angle: number, input: Float32Array): Float32Array {
  if (!result || !input) return null;

  if (result == input) return null;

  if (order < SH_MINORDER || order > SH_MAXORDER) return null;

  const R: number[] = [];

  // these are actually very sparse matrices, most of the entries are zero's...

  const ca = cosf(angle);
  const sa = sinf(angle);

  const t1 = ca;
  const t2 = sa;
  R[0] = t1;
  R[1] = 0.0;
  R[2] = t2;
  R[3] = 0.0;
  R[4] = 1.0;
  R[5] = 0.0;
  R[6] = -t2;
  R[7] = 0.0;
  R[8] = t1;

  result[0] = input[0];
  SimpMatMul(3, R, input.subarray(1), result.subarray(1));

  if (order > 2) {
    for (let j = 0; j < 5 * 5; j++) R[j] = 0.0;
    const t1 = sa;
    const t2 = t1 * t1;
    const t3 = ca;
    const t4 = t3 * t3;
    const t5 = -t2 + t4;
    const t7 = 2.0 * t3 * t1;
    R[0] = t5;
    R[4] = t7;
    R[6] = t3;
    R[8] = t1;
    R[12] = 1.0;
    R[16] = -t1;
    R[18] = t3;
    R[20] = -t7;
    R[24] = t5;

    SimpMatMul(5, R, input.subarray(4), result.subarray(4)); // un-roll matrix/vector multiply
    if (order > 3) {
      for (let j = 0; j < 7 * 7; j++) R[j] = 0.0;
      const t1 = ca;
      const t2 = t1 * t1;
      const t4 = sa;
      const t5 = t4 * t4;
      const t8 = t2 * t1 - 3.0 * t1 * t5;
      const t12 = 3.0 * t4 * t2 - t5 * t4;
      const t13 = -t5 + t2;
      const t15 = 2.0 * t1 * t4;
      R[0] = t8;
      R[6] = t12;
      R[8] = t13;
      R[12] = t15;
      R[16] = t1;
      R[18] = t4;
      R[24] = 1.0;
      R[30] = -t4;
      R[32] = t1;
      R[36] = -t15;
      R[40] = t13;
      R[42] = -t12;
      R[48] = t8;
      SimpMatMul(7, R, input.subarray(9), result.subarray(9));
      if (order > 4) {
        for (let j = 0; j <= 9 * 9; j++) R[j] = 0.0;
        const t1 = ca;
        const t2 = t1 * t1;
        const t3 = t2 * t2;
        const t4 = sa;
        const t5 = t4 * t4;
        const t6 = t5 * t5;
        const t9 = t3 + t6 - 6.0 * t5 * t2;
        const t10 = t5 * t4;
        const t12 = t2 * t1;
        const t14 = -t10 * t1 + t4 * t12;
        const t17 = t12 - 3.0 * t1 * t5;
        const t20 = 3.0 * t4 * t2 - t10;
        const t21 = -t5 + t2;
        const t23 = 2.0 * t1 * t4;
        R[0] = t9;
        R[8] = 4.0 * t14;
        R[10] = t17;
        R[16] = t20;
        R[20] = t21;
        R[24] = t23;
        R[30] = t1;
        R[32] = t4;
        R[40] = 1.0;
        R[48] = -t4;
        R[50] = t1;
        R[56] = -t23;
        R[60] = t21;
        R[64] = -t20;
        R[70] = t17;
        R[72] = -4.0 * t14;
        R[80] = t9;

        SimpMatMul(9, R, input.subarray(16), result.subarray(16));
        if (order > 5) {
          for (let j = 0; j < 11 * 11; j++) R[j] = 0.0;
          const t1 = ca;
          const t2 = sa;
          const t3 = t2 * t2;
          const t4 = t3 * t3;
          const t7 = t1 * t1;
          const t8 = t7 * t1;
          const t11 = t7 * t7;
          const t13 = 5.0 * t1 * t4 - 10.0 * t3 * t8 + t11 * t1;
          const t14 = t3 * t2;
          const t20 = -10.0 * t14 * t7 + 5.0 * t2 * t11 + t4 * t2;
          const t23 = t11 + t4 - 6.0 * t3 * t7;
          const t26 = -t14 * t1 + t2 * t8;
          const t29 = t8 - 3.0 * t1 * t3;
          const t32 = 3.0 * t2 * t7 - t14;
          const t33 = -t3 + t7;
          const t35 = 2.0 * t1 * t2;
          R[0] = t13;
          R[10] = t20;
          R[12] = t23;
          R[20] = 4.0 * t26;
          R[24] = t29;
          R[30] = t32;
          R[36] = t33;
          R[40] = t35;
          R[48] = t1;
          R[50] = t2;
          R[60] = 1.0;
          R[70] = -t2;
          R[72] = t1;
          R[80] = -t35;
          R[84] = t33;
          R[90] = -t32;
          R[96] = t29;
          R[100] = -4.0 * t26;
          R[108] = t23;
          R[110] = -t20;
          R[120] = t13;
          SimpMatMul(11, R, input.subarray(25), result.subarray(25));
        }
      }
    }
  }

  return result;
}

//-------------------------------------------------------------------------------------
// Adds two SH vectors, result[i] = inputA[i] + inputB[i];
//
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb205438.aspx
//-------------------------------------------------------------------------------------
function XMSHAdd(
  result: Float32Array,
  order: number,
  inputA: Float32Array,
  inputB: Float32Array
): Float32Array {
  if (!result || !inputA || !inputB) return null;

  const numcoeff = order * order;

  for (let i = 0; i < numcoeff; ++i) {
    result[i] = inputA[i] + inputB[i];
  }

  return result;
}

//-------------------------------------------------------------------------------------
// Scales a SH vector, result[i] = input[i] * scale;
//
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb204994.aspx
//-------------------------------------------------------------------------------------
function XMSHScale(result: Float32Array, order: number, input: Float32Array, scale: number): Float32Array {
  if (!result || !input) return null;

  const numcoeff = order * order;

  for (let i = 0; i < numcoeff; ++i) {
    result[i] = scale * input[i];
  }

  return result;
}

//-------------------------------------------------------------------------------------
// Computes the dot product of two SH vectors
//
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb205446.aspx
//-------------------------------------------------------------------------------------
function XMSHDot(order: number, inputA: Float32Array, inputB: Float32Array): number {
  if (!inputA || !inputB) return 0;

  let result = inputA[0] * inputB[0];

  const numcoeff = order * order;

  for (let i = 1; i < numcoeff; ++i) {
    result += inputA[i] * inputB[i];
  }

  return result;
}

//-------------------------------------------------------------------------------------
// Computes the product of two functions represented using SH (f and g), where:
// result[i] = int(y_i(s) * f(s) * g(s)), where y_i(s) is the ith SH basis
// function, f(s) and g(s) are SH functions (sum_i(y_i(s)*c_i)).  The order O
// determines the lengths of the arrays, where there should always be O^2
// coefficients.  In general the product of two SH functions of order O generates
// and SH function of order 2*O - 1, but we truncate the result.  This means
// that the product commutes (f*g == g*f) but doesn't associate
// (f*(g*h) != (f*g)*h.
//-------------------------------------------------------------------------------------
function XMSHMultiply(
  result: Float32Array,
  order: number,
  inputF: Float32Array,
  inputG: Float32Array
): Float32Array {
  switch (order) {
    case 2:
      return XMSHMultiply2(result, inputF, inputG);

    case 3:
      return XMSHMultiply3(result, inputF, inputG);

    case 4:
      return XMSHMultiply4(result, inputF, inputG);

    case 5:
      return XMSHMultiply5(result, inputF, inputG);

    case 6:
      return XMSHMultiply6(result, inputF, inputG);

    default:
      return null;
  }
}

//-------------------------------------------------------------------------------------
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb205454.aspx
//-------------------------------------------------------------------------------------
function XMSHMultiply2(y: Float32Array, f: Float32Array, g: Float32Array): Float32Array {
  if (!y || !f || !g) return null;

  let tf: number, tg: number, t: number;
  // [0,0]: 0,
  y[0] = CONSTANT(0.28209479293599998) * f[0] * g[0];

  // [1,1]: 0,
  tf = CONSTANT(0.28209479177300001) * f[0];
  tg = CONSTANT(0.28209479177300001) * g[0];
  y[1] = tf * g[1] + tg * f[1];
  t = f[1] * g[1];
  y[0] += CONSTANT(0.28209479177300001) * t;

  // [2,2]: 0,
  tf = CONSTANT(0.282094795249) * f[0];
  tg = CONSTANT(0.282094795249) * g[0];
  y[2] = tf * g[2] + tg * f[2];
  t = f[2] * g[2];
  y[0] += CONSTANT(0.282094795249) * t;

  // [3,3]: 0,
  tf = CONSTANT(0.28209479177300001) * f[0];
  tg = CONSTANT(0.28209479177300001) * g[0];
  y[3] = tf * g[3] + tg * f[3];
  t = f[3] * g[3];
  y[0] += CONSTANT(0.28209479177300001) * t;

  // multiply count=20

  return y;
}

//-------------------------------------------------------------------------------------
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb232906.aspx
//-------------------------------------------------------------------------------------
function XMSHMultiply3(y: Float32Array, f: Float32Array, g: Float32Array): Float32Array {
  if (!y || !f || !g) return null;

  let tf: number, tg: number, t: number;
  // [0,0]: 0,
  y[0] = CONSTANT(0.28209479293599998) * f[0] * g[0];

  // [1,1]: 0,6,8,
  tf =
    CONSTANT(0.28209479177300001) * f[0] +
    CONSTANT(-0.12615662610100001) * f[6] +
    CONSTANT(-0.21850968611999999) * f[8];
  tg =
    CONSTANT(0.28209479177300001) * g[0] +
    CONSTANT(-0.12615662610100001) * g[6] +
    CONSTANT(-0.21850968611999999) * g[8];
  y[1] = tf * g[1] + tg * f[1];
  t = f[1] * g[1];
  y[0] += CONSTANT(0.28209479177300001) * t;
  y[6] = CONSTANT(-0.12615662610100001) * t;
  y[8] = CONSTANT(-0.21850968611999999) * t;

  // [1,2]: 5,
  tf = CONSTANT(0.21850968611800001) * f[5];
  tg = CONSTANT(0.21850968611800001) * g[5];
  y[1] += tf * g[2] + tg * f[2];
  y[2] = tf * g[1] + tg * f[1];
  t = f[1] * g[2] + f[2] * g[1];
  y[5] = CONSTANT(0.21850968611800001) * t;

  // [1,3]: 4,
  tf = CONSTANT(0.21850968611499999) * f[4];
  tg = CONSTANT(0.21850968611499999) * g[4];
  y[1] += tf * g[3] + tg * f[3];
  y[3] = tf * g[1] + tg * f[1];
  t = f[1] * g[3] + f[3] * g[1];
  y[4] = CONSTANT(0.21850968611499999) * t;

  // [2,2]: 0,6,
  tf = CONSTANT(0.282094795249) * f[0] + CONSTANT(0.25231325998699999) * f[6];
  tg = CONSTANT(0.282094795249) * g[0] + CONSTANT(0.25231325998699999) * g[6];
  y[2] += tf * g[2] + tg * f[2];
  t = f[2] * g[2];
  y[0] += CONSTANT(0.282094795249) * t;
  y[6] += CONSTANT(0.25231325998699999) * t;

  // [2,3]: 7,
  tf = CONSTANT(0.21850968611800001) * f[7];
  tg = CONSTANT(0.21850968611800001) * g[7];
  y[2] += tf * g[3] + tg * f[3];
  y[3] += tf * g[2] + tg * f[2];
  t = f[2] * g[3] + f[3] * g[2];
  y[7] = CONSTANT(0.21850968611800001) * t;

  // [3,3]: 0,6,8,
  tf =
    CONSTANT(0.28209479177300001) * f[0] +
    CONSTANT(-0.12615662610100001) * f[6] +
    CONSTANT(0.21850968611999999) * f[8];
  tg =
    CONSTANT(0.28209479177300001) * g[0] +
    CONSTANT(-0.12615662610100001) * g[6] +
    CONSTANT(0.21850968611999999) * g[8];
  y[3] += tf * g[3] + tg * f[3];
  t = f[3] * g[3];
  y[0] += CONSTANT(0.28209479177300001) * t;
  y[6] += CONSTANT(-0.12615662610100001) * t;
  y[8] += CONSTANT(0.21850968611999999) * t;

  // [4,4]: 0,6,
  tf = CONSTANT(0.28209479177000002) * f[0] + CONSTANT(-0.18022375157600001) * f[6];
  tg = CONSTANT(0.28209479177000002) * g[0] + CONSTANT(-0.18022375157600001) * g[6];
  y[4] += tf * g[4] + tg * f[4];
  t = f[4] * g[4];
  y[0] += CONSTANT(0.28209479177000002) * t;
  y[6] += CONSTANT(-0.18022375157600001) * t;

  // [4,5]: 7,
  tf = CONSTANT(0.156078347226) * f[7];
  tg = CONSTANT(0.156078347226) * g[7];
  y[4] += tf * g[5] + tg * f[5];
  y[5] += tf * g[4] + tg * f[4];
  t = f[4] * g[5] + f[5] * g[4];
  y[7] += CONSTANT(0.156078347226) * t;

  // [5,5]: 0,6,8,
  tf =
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.090111875786499998) * f[6] +
    CONSTANT(-0.15607834722799999) * f[8];
  tg =
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.090111875786499998) * g[6] +
    CONSTANT(-0.15607834722799999) * g[8];
  y[5] += tf * g[5] + tg * f[5];
  t = f[5] * g[5];
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[6] += CONSTANT(0.090111875786499998) * t;
  y[8] += CONSTANT(-0.15607834722799999) * t;

  // [6,6]: 0,6,
  tf = CONSTANT(0.28209479756) * f[0];
  tg = CONSTANT(0.28209479756) * g[0];
  y[6] += tf * g[6] + tg * f[6];
  t = f[6] * g[6];
  y[0] += CONSTANT(0.28209479756) * t;
  y[6] += CONSTANT(0.18022376452700001) * t;

  // [7,7]: 0,6,8,
  tf =
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.090111875786499998) * f[6] +
    CONSTANT(0.15607834722799999) * f[8];
  tg =
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.090111875786499998) * g[6] +
    CONSTANT(0.15607834722799999) * g[8];
  y[7] += tf * g[7] + tg * f[7];
  t = f[7] * g[7];
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[6] += CONSTANT(0.090111875786499998) * t;
  y[8] += CONSTANT(0.15607834722799999) * t;

  // [8,8]: 0,6,
  tf = CONSTANT(0.28209479177000002) * f[0] + CONSTANT(-0.18022375157600001) * f[6];
  tg = CONSTANT(0.28209479177000002) * g[0] + CONSTANT(-0.18022375157600001) * g[6];
  y[8] += tf * g[8] + tg * f[8];
  t = f[8] * g[8];
  y[0] += CONSTANT(0.28209479177000002) * t;
  y[6] += CONSTANT(-0.18022375157600001) * t;

  // multiply count=120

  return y;
}

//-------------------------------------------------------------------------------------
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb232907.aspx
//-------------------------------------------------------------------------------------
function XMSHMultiply4(y: Float32Array, f: Float32Array, g: Float32Array): Float32Array {
  if (!y || !f || !g) return null;

  let tf: number, tg: number, t: number;
  // [0,0]: 0,
  y[0] = CONSTANT(0.28209479293599998) * f[0] * g[0];

  // [1,1]: 0,6,8,
  tf =
    CONSTANT(0.28209479177300001) * f[0] +
    CONSTANT(-0.12615662610100001) * f[6] +
    CONSTANT(-0.21850968611999999) * f[8];
  tg =
    CONSTANT(0.28209479177300001) * g[0] +
    CONSTANT(-0.12615662610100001) * g[6] +
    CONSTANT(-0.21850968611999999) * g[8];
  y[1] = tf * g[1] + tg * f[1];
  t = f[1] * g[1];
  y[0] += CONSTANT(0.28209479177300001) * t;
  y[6] = CONSTANT(-0.12615662610100001) * t;
  y[8] = CONSTANT(-0.21850968611999999) * t;

  // [1,4]: 3,13,15,
  tf =
    CONSTANT(0.21850968611499999) * f[3] +
    CONSTANT(-0.0583991700823) * f[13] +
    CONSTANT(-0.22617901315799999) * f[15];
  tg =
    CONSTANT(0.21850968611499999) * g[3] +
    CONSTANT(-0.0583991700823) * g[13] +
    CONSTANT(-0.22617901315799999) * g[15];
  y[1] += tf * g[4] + tg * f[4];
  y[4] = tf * g[1] + tg * f[1];
  t = f[1] * g[4] + f[4] * g[1];
  y[3] = CONSTANT(0.21850968611499999) * t;
  y[13] = CONSTANT(-0.0583991700823) * t;
  y[15] = CONSTANT(-0.22617901315799999) * t;

  // [1,5]: 2,12,14,
  tf =
    CONSTANT(0.21850968611800001) * f[2] +
    CONSTANT(-0.143048168103) * f[12] +
    CONSTANT(-0.184674390923) * f[14];
  tg =
    CONSTANT(0.21850968611800001) * g[2] +
    CONSTANT(-0.143048168103) * g[12] +
    CONSTANT(-0.184674390923) * g[14];
  y[1] += tf * g[5] + tg * f[5];
  y[5] = tf * g[1] + tg * f[1];
  t = f[1] * g[5] + f[5] * g[1];
  y[2] = CONSTANT(0.21850968611800001) * t;
  y[12] = CONSTANT(-0.143048168103) * t;
  y[14] = CONSTANT(-0.184674390923) * t;

  // [1,6]: 11,
  tf = CONSTANT(0.20230065940299999) * f[11];
  tg = CONSTANT(0.20230065940299999) * g[11];
  y[1] += tf * g[6] + tg * f[6];
  y[6] += tf * g[1] + tg * f[1];
  t = f[1] * g[6] + f[6] * g[1];
  y[11] = CONSTANT(0.20230065940299999) * t;

  // [1,8]: 9,11,
  tf = CONSTANT(0.226179013155) * f[9] + CONSTANT(0.058399170081799998) * f[11];
  tg = CONSTANT(0.226179013155) * g[9] + CONSTANT(0.058399170081799998) * g[11];
  y[1] += tf * g[8] + tg * f[8];
  y[8] += tf * g[1] + tg * f[1];
  t = f[1] * g[8] + f[8] * g[1];
  y[9] = CONSTANT(0.226179013155) * t;
  y[11] += CONSTANT(0.058399170081799998) * t;

  // [2,2]: 0,6,
  tf = CONSTANT(0.282094795249) * f[0] + CONSTANT(0.25231325998699999) * f[6];
  tg = CONSTANT(0.282094795249) * g[0] + CONSTANT(0.25231325998699999) * g[6];
  y[2] += tf * g[2] + tg * f[2];
  t = f[2] * g[2];
  y[0] += CONSTANT(0.282094795249) * t;
  y[6] += CONSTANT(0.25231325998699999) * t;

  // [2,6]: 12,
  tf = CONSTANT(0.24776670697399999) * f[12];
  tg = CONSTANT(0.24776670697399999) * g[12];
  y[2] += tf * g[6] + tg * f[6];
  y[6] += tf * g[2] + tg * f[2];
  t = f[2] * g[6] + f[6] * g[2];
  y[12] += CONSTANT(0.24776670697399999) * t;

  // [3,3]: 0,6,8,
  tf =
    CONSTANT(0.28209479177300001) * f[0] +
    CONSTANT(-0.12615662610100001) * f[6] +
    CONSTANT(0.21850968611999999) * f[8];
  tg =
    CONSTANT(0.28209479177300001) * g[0] +
    CONSTANT(-0.12615662610100001) * g[6] +
    CONSTANT(0.21850968611999999) * g[8];
  y[3] += tf * g[3] + tg * f[3];
  t = f[3] * g[3];
  y[0] += CONSTANT(0.28209479177300001) * t;
  y[6] += CONSTANT(-0.12615662610100001) * t;
  y[8] += CONSTANT(0.21850968611999999) * t;

  // [3,6]: 13,
  tf = CONSTANT(0.20230065940299999) * f[13];
  tg = CONSTANT(0.20230065940299999) * g[13];
  y[3] += tf * g[6] + tg * f[6];
  y[6] += tf * g[3] + tg * f[3];
  t = f[3] * g[6] + f[6] * g[3];
  y[13] += CONSTANT(0.20230065940299999) * t;

  // [3,7]: 2,12,14,
  tf =
    CONSTANT(0.21850968611800001) * f[2] +
    CONSTANT(-0.143048168103) * f[12] +
    CONSTANT(0.184674390923) * f[14];
  tg =
    CONSTANT(0.21850968611800001) * g[2] +
    CONSTANT(-0.143048168103) * g[12] +
    CONSTANT(0.184674390923) * g[14];
  y[3] += tf * g[7] + tg * f[7];
  y[7] = tf * g[3] + tg * f[3];
  t = f[3] * g[7] + f[7] * g[3];
  y[2] += CONSTANT(0.21850968611800001) * t;
  y[12] += CONSTANT(-0.143048168103) * t;
  y[14] += CONSTANT(0.184674390923) * t;

  // [3,8]: 13,15,
  tf = CONSTANT(-0.058399170081799998) * f[13] + CONSTANT(0.226179013155) * f[15];
  tg = CONSTANT(-0.058399170081799998) * g[13] + CONSTANT(0.226179013155) * g[15];
  y[3] += tf * g[8] + tg * f[8];
  y[8] += tf * g[3] + tg * f[3];
  t = f[3] * g[8] + f[8] * g[3];
  y[13] += CONSTANT(-0.058399170081799998) * t;
  y[15] += CONSTANT(0.226179013155) * t;

  // [4,4]: 0,6,
  tf = CONSTANT(0.28209479177000002) * f[0] + CONSTANT(-0.18022375157600001) * f[6];
  tg = CONSTANT(0.28209479177000002) * g[0] + CONSTANT(-0.18022375157600001) * g[6];
  y[4] += tf * g[4] + tg * f[4];
  t = f[4] * g[4];
  y[0] += CONSTANT(0.28209479177000002) * t;
  y[6] += CONSTANT(-0.18022375157600001) * t;

  // [4,5]: 7,
  tf = CONSTANT(0.156078347226) * f[7];
  tg = CONSTANT(0.156078347226) * g[7];
  y[4] += tf * g[5] + tg * f[5];
  y[5] += tf * g[4] + tg * f[4];
  t = f[4] * g[5] + f[5] * g[4];
  y[7] += CONSTANT(0.156078347226) * t;

  // [4,9]: 3,13,
  tf = CONSTANT(0.22617901315799999) * f[3] + CONSTANT(-0.094031597258400004) * f[13];
  tg = CONSTANT(0.22617901315799999) * g[3] + CONSTANT(-0.094031597258400004) * g[13];
  y[4] += tf * g[9] + tg * f[9];
  y[9] += tf * g[4] + tg * f[4];
  t = f[4] * g[9] + f[9] * g[4];
  y[3] += CONSTANT(0.22617901315799999) * t;
  y[13] += CONSTANT(-0.094031597258400004) * t;

  // [4,10]: 2,12,
  tf = CONSTANT(0.18467439091999999) * f[2] + CONSTANT(-0.18806319451799999) * f[12];
  tg = CONSTANT(0.18467439091999999) * g[2] + CONSTANT(-0.18806319451799999) * g[12];
  y[4] += tf * g[10] + tg * f[10];
  y[10] = tf * g[4] + tg * f[4];
  t = f[4] * g[10] + f[10] * g[4];
  y[2] += CONSTANT(0.18467439091999999) * t;
  y[12] += CONSTANT(-0.18806319451799999) * t;

  // [4,11]: 3,13,15,
  tf =
    CONSTANT(-0.0583991700823) * f[3] +
    CONSTANT(0.14567312407800001) * f[13] +
    CONSTANT(0.094031597258400004) * f[15];
  tg =
    CONSTANT(-0.0583991700823) * g[3] +
    CONSTANT(0.14567312407800001) * g[13] +
    CONSTANT(0.094031597258400004) * g[15];
  y[4] += tf * g[11] + tg * f[11];
  y[11] += tf * g[4] + tg * f[4];
  t = f[4] * g[11] + f[11] * g[4];
  y[3] += CONSTANT(-0.0583991700823) * t;
  y[13] += CONSTANT(0.14567312407800001) * t;
  y[15] += CONSTANT(0.094031597258400004) * t;

  // [5,5]: 0,6,8,
  tf =
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.090111875786499998) * f[6] +
    CONSTANT(-0.15607834722799999) * f[8];
  tg =
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.090111875786499998) * g[6] +
    CONSTANT(-0.15607834722799999) * g[8];
  y[5] += tf * g[5] + tg * f[5];
  t = f[5] * g[5];
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[6] += CONSTANT(0.090111875786499998) * t;
  y[8] += CONSTANT(-0.15607834722799999) * t;

  // [5,9]: 14,
  tf = CONSTANT(0.14867700967799999) * f[14];
  tg = CONSTANT(0.14867700967799999) * g[14];
  y[5] += tf * g[9] + tg * f[9];
  y[9] += tf * g[5] + tg * f[5];
  t = f[5] * g[9] + f[9] * g[5];
  y[14] += CONSTANT(0.14867700967799999) * t;

  // [5,10]: 3,13,15,
  tf =
    CONSTANT(0.18467439091999999) * f[3] +
    CONSTANT(0.11516471649) * f[13] +
    CONSTANT(-0.14867700967899999) * f[15];
  tg =
    CONSTANT(0.18467439091999999) * g[3] +
    CONSTANT(0.11516471649) * g[13] +
    CONSTANT(-0.14867700967899999) * g[15];
  y[5] += tf * g[10] + tg * f[10];
  y[10] += tf * g[5] + tg * f[5];
  t = f[5] * g[10] + f[10] * g[5];
  y[3] += CONSTANT(0.18467439091999999) * t;
  y[13] += CONSTANT(0.11516471649) * t;
  y[15] += CONSTANT(-0.14867700967899999) * t;

  // [5,11]: 2,12,14,
  tf =
    CONSTANT(0.23359668032700001) * f[2] +
    CONSTANT(0.059470803871800003) * f[12] +
    CONSTANT(-0.115164716491) * f[14];
  tg =
    CONSTANT(0.23359668032700001) * g[2] +
    CONSTANT(0.059470803871800003) * g[12] +
    CONSTANT(-0.115164716491) * g[14];
  y[5] += tf * g[11] + tg * f[11];
  y[11] += tf * g[5] + tg * f[5];
  t = f[5] * g[11] + f[11] * g[5];
  y[2] += CONSTANT(0.23359668032700001) * t;
  y[12] += CONSTANT(0.059470803871800003) * t;
  y[14] += CONSTANT(-0.115164716491) * t;

  // [6,6]: 0,6,
  tf = CONSTANT(0.28209479756) * f[0];
  tg = CONSTANT(0.28209479756) * g[0];
  y[6] += tf * g[6] + tg * f[6];
  t = f[6] * g[6];
  y[0] += CONSTANT(0.28209479756) * t;
  y[6] += CONSTANT(0.18022376452700001) * t;

  // [7,7]: 6,0,8,
  tf =
    CONSTANT(0.090111875786499998) * f[6] +
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.15607834722799999) * f[8];
  tg =
    CONSTANT(0.090111875786499998) * g[6] +
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.15607834722799999) * g[8];
  y[7] += tf * g[7] + tg * f[7];
  t = f[7] * g[7];
  y[6] += CONSTANT(0.090111875786499998) * t;
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[8] += CONSTANT(0.15607834722799999) * t;

  // [7,10]: 9,1,11,
  tf =
    CONSTANT(0.14867700967899999) * f[9] +
    CONSTANT(0.18467439091999999) * f[1] +
    CONSTANT(0.11516471649) * f[11];
  tg =
    CONSTANT(0.14867700967899999) * g[9] +
    CONSTANT(0.18467439091999999) * g[1] +
    CONSTANT(0.11516471649) * g[11];
  y[7] += tf * g[10] + tg * f[10];
  y[10] += tf * g[7] + tg * f[7];
  t = f[7] * g[10] + f[10] * g[7];
  y[9] += CONSTANT(0.14867700967899999) * t;
  y[1] += CONSTANT(0.18467439091999999) * t;
  y[11] += CONSTANT(0.11516471649) * t;

  // [7,13]: 12,2,14,
  tf =
    CONSTANT(0.059470803871800003) * f[12] +
    CONSTANT(0.23359668032700001) * f[2] +
    CONSTANT(0.115164716491) * f[14];
  tg =
    CONSTANT(0.059470803871800003) * g[12] +
    CONSTANT(0.23359668032700001) * g[2] +
    CONSTANT(0.115164716491) * g[14];
  y[7] += tf * g[13] + tg * f[13];
  y[13] += tf * g[7] + tg * f[7];
  t = f[7] * g[13] + f[13] * g[7];
  y[12] += CONSTANT(0.059470803871800003) * t;
  y[2] += CONSTANT(0.23359668032700001) * t;
  y[14] += CONSTANT(0.115164716491) * t;

  // [7,14]: 15,
  tf = CONSTANT(0.14867700967799999) * f[15];
  tg = CONSTANT(0.14867700967799999) * g[15];
  y[7] += tf * g[14] + tg * f[14];
  y[14] += tf * g[7] + tg * f[7];
  t = f[7] * g[14] + f[14] * g[7];
  y[15] += CONSTANT(0.14867700967799999) * t;

  // [8,8]: 0,6,
  tf = CONSTANT(0.28209479177000002) * f[0] + CONSTANT(-0.18022375157600001) * f[6];
  tg = CONSTANT(0.28209479177000002) * g[0] + CONSTANT(-0.18022375157600001) * g[6];
  y[8] += tf * g[8] + tg * f[8];
  t = f[8] * g[8];
  y[0] += CONSTANT(0.28209479177000002) * t;
  y[6] += CONSTANT(-0.18022375157600001) * t;

  // [8,9]: 11,
  tf = CONSTANT(-0.094031597259499999) * f[11];
  tg = CONSTANT(-0.094031597259499999) * g[11];
  y[8] += tf * g[9] + tg * f[9];
  y[9] += tf * g[8] + tg * f[8];
  t = f[8] * g[9] + f[9] * g[8];
  y[11] += CONSTANT(-0.094031597259499999) * t;

  // [8,13]: 15,
  tf = CONSTANT(-0.094031597259499999) * f[15];
  tg = CONSTANT(-0.094031597259499999) * g[15];
  y[8] += tf * g[13] + tg * f[13];
  y[13] += tf * g[8] + tg * f[8];
  t = f[8] * g[13] + f[13] * g[8];
  y[15] += CONSTANT(-0.094031597259499999) * t;

  // [8,14]: 2,12,
  tf = CONSTANT(0.18467439091999999) * f[2] + CONSTANT(-0.18806319451799999) * f[12];
  tg = CONSTANT(0.18467439091999999) * g[2] + CONSTANT(-0.18806319451799999) * g[12];
  y[8] += tf * g[14] + tg * f[14];
  y[14] += tf * g[8] + tg * f[8];
  t = f[8] * g[14] + f[14] * g[8];
  y[2] += CONSTANT(0.18467439091999999) * t;
  y[12] += CONSTANT(-0.18806319451799999) * t;

  // [9,9]: 6,0,
  tf = CONSTANT(-0.21026104350800001) * f[6] + CONSTANT(0.28209479176699997) * f[0];
  tg = CONSTANT(-0.21026104350800001) * g[6] + CONSTANT(0.28209479176699997) * g[0];
  y[9] += tf * g[9] + tg * f[9];
  t = f[9] * g[9];
  y[6] += CONSTANT(-0.21026104350800001) * t;
  y[0] += CONSTANT(0.28209479176699997) * t;

  // [10,10]: 0,
  tf = CONSTANT(0.28209479177199998) * f[0];
  tg = CONSTANT(0.28209479177199998) * g[0];
  y[10] += tf * g[10] + tg * f[10];
  t = f[10] * g[10];
  y[0] += CONSTANT(0.28209479177199998) * t;

  // [11,11]: 0,6,8,
  tf =
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.12615662610100001) * f[6] +
    CONSTANT(-0.14567312407899999) * f[8];
  tg =
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.12615662610100001) * g[6] +
    CONSTANT(-0.14567312407899999) * g[8];
  y[11] += tf * g[11] + tg * f[11];
  t = f[11] * g[11];
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[6] += CONSTANT(0.12615662610100001) * t;
  y[8] += CONSTANT(-0.14567312407899999) * t;

  // [12,12]: 0,6,
  tf = CONSTANT(0.28209479987199998) * f[0] + CONSTANT(0.16820885295400001) * f[6];
  tg = CONSTANT(0.28209479987199998) * g[0] + CONSTANT(0.16820885295400001) * g[6];
  y[12] += tf * g[12] + tg * f[12];
  t = f[12] * g[12];
  y[0] += CONSTANT(0.28209479987199998) * t;
  y[6] += CONSTANT(0.16820885295400001) * t;

  // [13,13]: 0,8,6,
  tf =
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.14567312407899999) * f[8] +
    CONSTANT(0.12615662610100001) * f[6];
  tg =
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.14567312407899999) * g[8] +
    CONSTANT(0.12615662610100001) * g[6];
  y[13] += tf * g[13] + tg * f[13];
  t = f[13] * g[13];
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[8] += CONSTANT(0.14567312407899999) * t;
  y[6] += CONSTANT(0.12615662610100001) * t;

  // [14,14]: 0,
  tf = CONSTANT(0.28209479177199998) * f[0];
  tg = CONSTANT(0.28209479177199998) * g[0];
  y[14] += tf * g[14] + tg * f[14];
  t = f[14] * g[14];
  y[0] += CONSTANT(0.28209479177199998) * t;

  // [15,15]: 0,6,
  tf = CONSTANT(0.28209479176699997) * f[0] + CONSTANT(-0.21026104350800001) * f[6];
  tg = CONSTANT(0.28209479176699997) * g[0] + CONSTANT(-0.21026104350800001) * g[6];
  y[15] += tf * g[15] + tg * f[15];
  t = f[15] * g[15];
  y[0] += CONSTANT(0.28209479176699997) * t;
  y[6] += CONSTANT(-0.21026104350800001) * t;

  // multiply count=399

  return y;
}

//-------------------------------------------------------------------------------------
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb232908.aspx
//-------------------------------------------------------------------------------------
function XMSHMultiply5(y: Float32Array, f: Float32Array, g: Float32Array): Float32Array {
  if (!y || !f || !g) return null;

  let tf: number, tg: number, t: number;
  // [0,0]: 0,
  y[0] = CONSTANT(0.28209479293599998) * f[0] * g[0];

  // [1,1]: 0,6,8,
  tf =
    CONSTANT(0.28209479177300001) * f[0] +
    CONSTANT(-0.12615662610100001) * f[6] +
    CONSTANT(-0.21850968611999999) * f[8];
  tg =
    CONSTANT(0.28209479177300001) * g[0] +
    CONSTANT(-0.12615662610100001) * g[6] +
    CONSTANT(-0.21850968611999999) * g[8];
  y[1] = tf * g[1] + tg * f[1];
  t = f[1] * g[1];
  y[0] += CONSTANT(0.28209479177300001) * t;
  y[6] = CONSTANT(-0.12615662610100001) * t;
  y[8] = CONSTANT(-0.21850968611999999) * t;

  // [1,4]: 3,13,15,
  tf =
    CONSTANT(0.21850968611499999) * f[3] +
    CONSTANT(-0.0583991700823) * f[13] +
    CONSTANT(-0.22617901315799999) * f[15];
  tg =
    CONSTANT(0.21850968611499999) * g[3] +
    CONSTANT(-0.0583991700823) * g[13] +
    CONSTANT(-0.22617901315799999) * g[15];
  y[1] += tf * g[4] + tg * f[4];
  y[4] = tf * g[1] + tg * f[1];
  t = f[1] * g[4] + f[4] * g[1];
  y[3] = CONSTANT(0.21850968611499999) * t;
  y[13] = CONSTANT(-0.0583991700823) * t;
  y[15] = CONSTANT(-0.22617901315799999) * t;

  // [1,5]: 2,12,14,
  tf =
    CONSTANT(0.21850968611800001) * f[2] +
    CONSTANT(-0.143048168103) * f[12] +
    CONSTANT(-0.184674390923) * f[14];
  tg =
    CONSTANT(0.21850968611800001) * g[2] +
    CONSTANT(-0.143048168103) * g[12] +
    CONSTANT(-0.184674390923) * g[14];
  y[1] += tf * g[5] + tg * f[5];
  y[5] = tf * g[1] + tg * f[1];
  t = f[1] * g[5] + f[5] * g[1];
  y[2] = CONSTANT(0.21850968611800001) * t;
  y[12] = CONSTANT(-0.143048168103) * t;
  y[14] = CONSTANT(-0.184674390923) * t;

  // [1,9]: 8,22,24,
  tf =
    CONSTANT(0.226179013155) * f[8] +
    CONSTANT(-0.043528171378199997) * f[22] +
    CONSTANT(-0.23032943297899999) * f[24];
  tg =
    CONSTANT(0.226179013155) * g[8] +
    CONSTANT(-0.043528171378199997) * g[22] +
    CONSTANT(-0.23032943297899999) * g[24];
  y[1] += tf * g[9] + tg * f[9];
  y[9] = tf * g[1] + tg * f[1];
  t = f[1] * g[9] + f[9] * g[1];
  y[8] += CONSTANT(0.226179013155) * t;
  y[22] = CONSTANT(-0.043528171378199997) * t;
  y[24] = CONSTANT(-0.23032943297899999) * t;

  // [1,10]: 7,21,23,
  tf =
    CONSTANT(0.18467439091999999) * f[7] +
    CONSTANT(-0.075393004386799994) * f[21] +
    CONSTANT(-0.19947114020000001) * f[23];
  tg =
    CONSTANT(0.18467439091999999) * g[7] +
    CONSTANT(-0.075393004386799994) * g[21] +
    CONSTANT(-0.19947114020000001) * g[23];
  y[1] += tf * g[10] + tg * f[10];
  y[10] = tf * g[1] + tg * f[1];
  t = f[1] * g[10] + f[10] * g[1];
  y[7] = CONSTANT(0.18467439091999999) * t;
  y[21] = CONSTANT(-0.075393004386799994) * t;
  y[23] = CONSTANT(-0.19947114020000001) * t;

  // [1,11]: 6,8,20,22,
  tf =
    CONSTANT(0.20230065940299999) * f[6] +
    CONSTANT(0.058399170081799998) * f[8] +
    CONSTANT(-0.150786008773) * f[20] +
    CONSTANT(-0.16858388283699999) * f[22];
  tg =
    CONSTANT(0.20230065940299999) * g[6] +
    CONSTANT(0.058399170081799998) * g[8] +
    CONSTANT(-0.150786008773) * g[20] +
    CONSTANT(-0.16858388283699999) * g[22];
  y[1] += tf * g[11] + tg * f[11];
  y[11] = tf * g[1] + tg * f[1];
  t = f[1] * g[11] + f[11] * g[1];
  y[6] += CONSTANT(0.20230065940299999) * t;
  y[8] += CONSTANT(0.058399170081799998) * t;
  y[20] = CONSTANT(-0.150786008773) * t;
  y[22] += CONSTANT(-0.16858388283699999) * t;

  // [1,12]: 19,
  tf = CONSTANT(0.19466390027300001) * f[19];
  tg = CONSTANT(0.19466390027300001) * g[19];
  y[1] += tf * g[12] + tg * f[12];
  y[12] += tf * g[1] + tg * f[1];
  t = f[1] * g[12] + f[12] * g[1];
  y[19] = CONSTANT(0.19466390027300001) * t;

  // [1,13]: 18,
  tf = CONSTANT(0.168583882834) * f[18];
  tg = CONSTANT(0.168583882834) * g[18];
  y[1] += tf * g[13] + tg * f[13];
  y[13] += tf * g[1] + tg * f[1];
  t = f[1] * g[13] + f[13] * g[1];
  y[18] = CONSTANT(0.168583882834) * t;

  // [1,14]: 17,19,
  tf = CONSTANT(0.19947114019699999) * f[17] + CONSTANT(0.075393004386399995) * f[19];
  tg = CONSTANT(0.19947114019699999) * g[17] + CONSTANT(0.075393004386399995) * g[19];
  y[1] += tf * g[14] + tg * f[14];
  y[14] += tf * g[1] + tg * f[1];
  t = f[1] * g[14] + f[14] * g[1];
  y[17] = CONSTANT(0.19947114019699999) * t;
  y[19] += CONSTANT(0.075393004386399995) * t;

  // [1,15]: 16,18,
  tf = CONSTANT(0.23032943297399999) * f[16] + CONSTANT(0.043528171377799997) * f[18];
  tg = CONSTANT(0.23032943297399999) * g[16] + CONSTANT(0.043528171377799997) * g[18];
  y[1] += tf * g[15] + tg * f[15];
  y[15] += tf * g[1] + tg * f[1];
  t = f[1] * g[15] + f[15] * g[1];
  y[16] = CONSTANT(0.23032943297399999) * t;
  y[18] += CONSTANT(0.043528171377799997) * t;

  // [2,2]: 0,6,
  tf = CONSTANT(0.282094795249) * f[0] + CONSTANT(0.25231325998699999) * f[6];
  tg = CONSTANT(0.282094795249) * g[0] + CONSTANT(0.25231325998699999) * g[6];
  y[2] += tf * g[2] + tg * f[2];
  t = f[2] * g[2];
  y[0] += CONSTANT(0.282094795249) * t;
  y[6] += CONSTANT(0.25231325998699999) * t;

  // [2,10]: 4,18,
  tf = CONSTANT(0.18467439091999999) * f[4] + CONSTANT(0.213243618621) * f[18];
  tg = CONSTANT(0.18467439091999999) * g[4] + CONSTANT(0.213243618621) * g[18];
  y[2] += tf * g[10] + tg * f[10];
  y[10] += tf * g[2] + tg * f[2];
  t = f[2] * g[10] + f[10] * g[2];
  y[4] += CONSTANT(0.18467439091999999) * t;
  y[18] += CONSTANT(0.213243618621) * t;

  // [2,12]: 6,20,
  tf = CONSTANT(0.24776670697399999) * f[6] + CONSTANT(0.24623253717400001) * f[20];
  tg = CONSTANT(0.24776670697399999) * g[6] + CONSTANT(0.24623253717400001) * g[20];
  y[2] += tf * g[12] + tg * f[12];
  y[12] += tf * g[2] + tg * f[2];
  t = f[2] * g[12] + f[12] * g[2];
  y[6] += CONSTANT(0.24776670697399999) * t;
  y[20] += CONSTANT(0.24623253717400001) * t;

  // [2,14]: 8,22,
  tf = CONSTANT(0.18467439091999999) * f[8] + CONSTANT(0.213243618621) * f[22];
  tg = CONSTANT(0.18467439091999999) * g[8] + CONSTANT(0.213243618621) * g[22];
  y[2] += tf * g[14] + tg * f[14];
  y[14] += tf * g[2] + tg * f[2];
  t = f[2] * g[14] + f[14] * g[2];
  y[8] += CONSTANT(0.18467439091999999) * t;
  y[22] += CONSTANT(0.213243618621) * t;

  // [3,3]: 0,6,8,
  tf =
    CONSTANT(0.28209479177300001) * f[0] +
    CONSTANT(-0.12615662610100001) * f[6] +
    CONSTANT(0.21850968611999999) * f[8];
  tg =
    CONSTANT(0.28209479177300001) * g[0] +
    CONSTANT(-0.12615662610100001) * g[6] +
    CONSTANT(0.21850968611999999) * g[8];
  y[3] += tf * g[3] + tg * f[3];
  t = f[3] * g[3];
  y[0] += CONSTANT(0.28209479177300001) * t;
  y[6] += CONSTANT(-0.12615662610100001) * t;
  y[8] += CONSTANT(0.21850968611999999) * t;

  // [3,7]: 2,12,14,
  tf =
    CONSTANT(0.21850968611800001) * f[2] +
    CONSTANT(-0.143048168103) * f[12] +
    CONSTANT(0.184674390923) * f[14];
  tg =
    CONSTANT(0.21850968611800001) * g[2] +
    CONSTANT(-0.143048168103) * g[12] +
    CONSTANT(0.184674390923) * g[14];
  y[3] += tf * g[7] + tg * f[7];
  y[7] += tf * g[3] + tg * f[3];
  t = f[3] * g[7] + f[7] * g[3];
  y[2] += CONSTANT(0.21850968611800001) * t;
  y[12] += CONSTANT(-0.143048168103) * t;
  y[14] += CONSTANT(0.184674390923) * t;

  // [3,9]: 4,16,18,
  tf =
    CONSTANT(0.22617901315799999) * f[4] +
    CONSTANT(0.23032943297399999) * f[16] +
    CONSTANT(-0.043528171377799997) * f[18];
  tg =
    CONSTANT(0.22617901315799999) * g[4] +
    CONSTANT(0.23032943297399999) * g[16] +
    CONSTANT(-0.043528171377799997) * g[18];
  y[3] += tf * g[9] + tg * f[9];
  y[9] += tf * g[3] + tg * f[3];
  t = f[3] * g[9] + f[9] * g[3];
  y[4] += CONSTANT(0.22617901315799999) * t;
  y[16] += CONSTANT(0.23032943297399999) * t;
  y[18] += CONSTANT(-0.043528171377799997) * t;

  // [3,10]: 5,17,19,
  tf =
    CONSTANT(0.18467439091999999) * f[5] +
    CONSTANT(0.19947114020000001) * f[17] +
    CONSTANT(-0.075393004386799994) * f[19];
  tg =
    CONSTANT(0.18467439091999999) * g[5] +
    CONSTANT(0.19947114020000001) * g[17] +
    CONSTANT(-0.075393004386799994) * g[19];
  y[3] += tf * g[10] + tg * f[10];
  y[10] += tf * g[3] + tg * f[3];
  t = f[3] * g[10] + f[10] * g[3];
  y[5] += CONSTANT(0.18467439091999999) * t;
  y[17] += CONSTANT(0.19947114020000001) * t;
  y[19] += CONSTANT(-0.075393004386799994) * t;

  // [3,12]: 21,
  tf = CONSTANT(0.19466390027300001) * f[21];
  tg = CONSTANT(0.19466390027300001) * g[21];
  y[3] += tf * g[12] + tg * f[12];
  y[12] += tf * g[3] + tg * f[3];
  t = f[3] * g[12] + f[12] * g[3];
  y[21] += CONSTANT(0.19466390027300001) * t;

  // [3,13]: 8,6,20,22,
  tf =
    CONSTANT(-0.058399170081799998) * f[8] +
    CONSTANT(0.20230065940299999) * f[6] +
    CONSTANT(-0.150786008773) * f[20] +
    CONSTANT(0.16858388283699999) * f[22];
  tg =
    CONSTANT(-0.058399170081799998) * g[8] +
    CONSTANT(0.20230065940299999) * g[6] +
    CONSTANT(-0.150786008773) * g[20] +
    CONSTANT(0.16858388283699999) * g[22];
  y[3] += tf * g[13] + tg * f[13];
  y[13] += tf * g[3] + tg * f[3];
  t = f[3] * g[13] + f[13] * g[3];
  y[8] += CONSTANT(-0.058399170081799998) * t;
  y[6] += CONSTANT(0.20230065940299999) * t;
  y[20] += CONSTANT(-0.150786008773) * t;
  y[22] += CONSTANT(0.16858388283699999) * t;

  // [3,14]: 21,23,
  tf = CONSTANT(-0.075393004386399995) * f[21] + CONSTANT(0.19947114019699999) * f[23];
  tg = CONSTANT(-0.075393004386399995) * g[21] + CONSTANT(0.19947114019699999) * g[23];
  y[3] += tf * g[14] + tg * f[14];
  y[14] += tf * g[3] + tg * f[3];
  t = f[3] * g[14] + f[14] * g[3];
  y[21] += CONSTANT(-0.075393004386399995) * t;
  y[23] += CONSTANT(0.19947114019699999) * t;

  // [3,15]: 8,22,24,
  tf =
    CONSTANT(0.226179013155) * f[8] +
    CONSTANT(-0.043528171378199997) * f[22] +
    CONSTANT(0.23032943297899999) * f[24];
  tg =
    CONSTANT(0.226179013155) * g[8] +
    CONSTANT(-0.043528171378199997) * g[22] +
    CONSTANT(0.23032943297899999) * g[24];
  y[3] += tf * g[15] + tg * f[15];
  y[15] += tf * g[3] + tg * f[3];
  t = f[3] * g[15] + f[15] * g[3];
  y[8] += CONSTANT(0.226179013155) * t;
  y[22] += CONSTANT(-0.043528171378199997) * t;
  y[24] += CONSTANT(0.23032943297899999) * t;

  // [4,4]: 0,6,20,24,
  tf =
    CONSTANT(0.28209479177000002) * f[0] +
    CONSTANT(-0.18022375157600001) * f[6] +
    CONSTANT(0.040299255967500003) * f[20] +
    CONSTANT(-0.23841361350599999) * f[24];
  tg =
    CONSTANT(0.28209479177000002) * g[0] +
    CONSTANT(-0.18022375157600001) * g[6] +
    CONSTANT(0.040299255967500003) * g[20] +
    CONSTANT(-0.23841361350599999) * g[24];
  y[4] += tf * g[4] + tg * f[4];
  t = f[4] * g[4];
  y[0] += CONSTANT(0.28209479177000002) * t;
  y[6] += CONSTANT(-0.18022375157600001) * t;
  y[20] += CONSTANT(0.040299255967500003) * t;
  y[24] += CONSTANT(-0.23841361350599999) * t;

  // [4,5]: 7,21,23,
  tf =
    CONSTANT(0.156078347226) * f[7] +
    CONSTANT(-0.063718718434399996) * f[21] +
    CONSTANT(-0.168583882835) * f[23];
  tg =
    CONSTANT(0.156078347226) * g[7] +
    CONSTANT(-0.063718718434399996) * g[21] +
    CONSTANT(-0.168583882835) * g[23];
  y[4] += tf * g[5] + tg * f[5];
  y[5] += tf * g[4] + tg * f[4];
  t = f[4] * g[5] + f[5] * g[4];
  y[7] += CONSTANT(0.156078347226) * t;
  y[21] += CONSTANT(-0.063718718434399996) * t;
  y[23] += CONSTANT(-0.168583882835) * t;

  // [4,11]: 3,13,15,
  tf =
    CONSTANT(-0.0583991700823) * f[3] +
    CONSTANT(0.14567312407800001) * f[13] +
    CONSTANT(0.094031597258400004) * f[15];
  tg =
    CONSTANT(-0.0583991700823) * g[3] +
    CONSTANT(0.14567312407800001) * g[13] +
    CONSTANT(0.094031597258400004) * g[15];
  y[4] += tf * g[11] + tg * f[11];
  y[11] += tf * g[4] + tg * f[4];
  t = f[4] * g[11] + f[11] * g[4];
  y[3] += CONSTANT(-0.0583991700823) * t;
  y[13] += CONSTANT(0.14567312407800001) * t;
  y[15] += CONSTANT(0.094031597258400004) * t;

  // [4,16]: 8,22,
  tf = CONSTANT(0.238413613494) * f[8] + CONSTANT(-0.075080816693699995) * f[22];
  tg = CONSTANT(0.238413613494) * g[8] + CONSTANT(-0.075080816693699995) * g[22];
  y[4] += tf * g[16] + tg * f[16];
  y[16] += tf * g[4] + tg * f[4];
  t = f[4] * g[16] + f[16] * g[4];
  y[8] += CONSTANT(0.238413613494) * t;
  y[22] += CONSTANT(-0.075080816693699995) * t;

  // [4,18]: 6,20,24,
  tf =
    CONSTANT(0.156078347226) * f[6] +
    CONSTANT(-0.19036461502900001) * f[20] +
    CONSTANT(0.075080816691500005) * f[24];
  tg =
    CONSTANT(0.156078347226) * g[6] +
    CONSTANT(-0.19036461502900001) * g[20] +
    CONSTANT(0.075080816691500005) * g[24];
  y[4] += tf * g[18] + tg * f[18];
  y[18] += tf * g[4] + tg * f[4];
  t = f[4] * g[18] + f[18] * g[4];
  y[6] += CONSTANT(0.156078347226) * t;
  y[20] += CONSTANT(-0.19036461502900001) * t;
  y[24] += CONSTANT(0.075080816691500005) * t;

  // [4,19]: 7,21,23,
  tf =
    CONSTANT(-0.063718718434399996) * f[7] +
    CONSTANT(0.14188940656999999) * f[21] +
    CONSTANT(0.112621225039) * f[23];
  tg =
    CONSTANT(-0.063718718434399996) * g[7] +
    CONSTANT(0.14188940656999999) * g[21] +
    CONSTANT(0.112621225039) * g[23];
  y[4] += tf * g[19] + tg * f[19];
  y[19] += tf * g[4] + tg * f[4];
  t = f[4] * g[19] + f[19] * g[4];
  y[7] += CONSTANT(-0.063718718434399996) * t;
  y[21] += CONSTANT(0.14188940656999999) * t;
  y[23] += CONSTANT(0.112621225039) * t;

  // [5,5]: 0,6,8,20,22,
  tf =
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.090111875786499998) * f[6] +
    CONSTANT(-0.15607834722799999) * f[8] +
    CONSTANT(-0.16119702387099999) * f[20] +
    CONSTANT(-0.180223751574) * f[22];
  tg =
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.090111875786499998) * g[6] +
    CONSTANT(-0.15607834722799999) * g[8] +
    CONSTANT(-0.16119702387099999) * g[20] +
    CONSTANT(-0.180223751574) * g[22];
  y[5] += tf * g[5] + tg * f[5];
  t = f[5] * g[5];
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[6] += CONSTANT(0.090111875786499998) * t;
  y[8] += CONSTANT(-0.15607834722799999) * t;
  y[20] += CONSTANT(-0.16119702387099999) * t;
  y[22] += CONSTANT(-0.180223751574) * t;

  // [5,11]: 2,12,14,
  tf =
    CONSTANT(0.23359668032700001) * f[2] +
    CONSTANT(0.059470803871800003) * f[12] +
    CONSTANT(-0.115164716491) * f[14];
  tg =
    CONSTANT(0.23359668032700001) * g[2] +
    CONSTANT(0.059470803871800003) * g[12] +
    CONSTANT(-0.115164716491) * g[14];
  y[5] += tf * g[11] + tg * f[11];
  y[11] += tf * g[5] + tg * f[5];
  t = f[5] * g[11] + f[11] * g[5];
  y[2] += CONSTANT(0.23359668032700001) * t;
  y[12] += CONSTANT(0.059470803871800003) * t;
  y[14] += CONSTANT(-0.115164716491) * t;

  // [5,17]: 8,22,24,
  tf =
    CONSTANT(0.16858388283299999) * f[8] +
    CONSTANT(0.13272538654800001) * f[22] +
    CONSTANT(-0.140463346189) * f[24];
  tg =
    CONSTANT(0.16858388283299999) * g[8] +
    CONSTANT(0.13272538654800001) * g[22] +
    CONSTANT(-0.140463346189) * g[24];
  y[5] += tf * g[17] + tg * f[17];
  y[17] += tf * g[5] + tg * f[5];
  t = f[5] * g[17] + f[17] * g[5];
  y[8] += CONSTANT(0.16858388283299999) * t;
  y[22] += CONSTANT(0.13272538654800001) * t;
  y[24] += CONSTANT(-0.140463346189) * t;

  // [5,18]: 7,21,23,
  tf =
    CONSTANT(0.18022375157100001) * f[7] +
    CONSTANT(0.090297865407399994) * f[21] +
    CONSTANT(-0.13272538654900001) * f[23];
  tg =
    CONSTANT(0.18022375157100001) * g[7] +
    CONSTANT(0.090297865407399994) * g[21] +
    CONSTANT(-0.13272538654900001) * g[23];
  y[5] += tf * g[18] + tg * f[18];
  y[18] += tf * g[5] + tg * f[5];
  t = f[5] * g[18] + f[18] * g[5];
  y[7] += CONSTANT(0.18022375157100001) * t;
  y[21] += CONSTANT(0.090297865407399994) * t;
  y[23] += CONSTANT(-0.13272538654900001) * t;

  // [5,19]: 6,8,20,22,
  tf =
    CONSTANT(0.22072811544099999) * f[6] +
    CONSTANT(0.063718718433900007) * f[8] +
    CONSTANT(0.044869370061299998) * f[20] +
    CONSTANT(-0.090297865408399999) * f[22];
  tg =
    CONSTANT(0.22072811544099999) * g[6] +
    CONSTANT(0.063718718433900007) * g[8] +
    CONSTANT(0.044869370061299998) * g[20] +
    CONSTANT(-0.090297865408399999) * g[22];
  y[5] += tf * g[19] + tg * f[19];
  y[19] += tf * g[5] + tg * f[5];
  t = f[5] * g[19] + f[19] * g[5];
  y[6] += CONSTANT(0.22072811544099999) * t;
  y[8] += CONSTANT(0.063718718433900007) * t;
  y[20] += CONSTANT(0.044869370061299998) * t;
  y[22] += CONSTANT(-0.090297865408399999) * t;

  // [6,6]: 0,6,20,
  tf = CONSTANT(0.28209479756) * f[0] + CONSTANT(0.24179555318599999) * f[20];
  tg = CONSTANT(0.28209479756) * g[0] + CONSTANT(0.24179555318599999) * g[20];
  y[6] += tf * g[6] + tg * f[6];
  t = f[6] * g[6];
  y[0] += CONSTANT(0.28209479756) * t;
  y[6] += CONSTANT(0.18022376452700001) * t;
  y[20] += CONSTANT(0.24179555318599999) * t;

  // [7,7]: 6,0,8,20,22,
  tf =
    CONSTANT(0.090111875786499998) * f[6] +
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.15607834722799999) * f[8] +
    CONSTANT(-0.16119702387099999) * f[20] +
    CONSTANT(0.180223751574) * f[22];
  tg =
    CONSTANT(0.090111875786499998) * g[6] +
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.15607834722799999) * g[8] +
    CONSTANT(-0.16119702387099999) * g[20] +
    CONSTANT(0.180223751574) * g[22];
  y[7] += tf * g[7] + tg * f[7];
  t = f[7] * g[7];
  y[6] += CONSTANT(0.090111875786499998) * t;
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[8] += CONSTANT(0.15607834722799999) * t;
  y[20] += CONSTANT(-0.16119702387099999) * t;
  y[22] += CONSTANT(0.180223751574) * t;

  // [7,13]: 12,2,14,
  tf =
    CONSTANT(0.059470803871800003) * f[12] +
    CONSTANT(0.23359668032700001) * f[2] +
    CONSTANT(0.115164716491) * f[14];
  tg =
    CONSTANT(0.059470803871800003) * g[12] +
    CONSTANT(0.23359668032700001) * g[2] +
    CONSTANT(0.115164716491) * g[14];
  y[7] += tf * g[13] + tg * f[13];
  y[13] += tf * g[7] + tg * f[7];
  t = f[7] * g[13] + f[13] * g[7];
  y[12] += CONSTANT(0.059470803871800003) * t;
  y[2] += CONSTANT(0.23359668032700001) * t;
  y[14] += CONSTANT(0.115164716491) * t;

  // [7,17]: 16,4,18,
  tf =
    CONSTANT(0.14046334618799999) * f[16] +
    CONSTANT(0.168583882835) * f[4] +
    CONSTANT(0.13272538654900001) * f[18];
  tg =
    CONSTANT(0.14046334618799999) * g[16] +
    CONSTANT(0.168583882835) * g[4] +
    CONSTANT(0.13272538654900001) * g[18];
  y[7] += tf * g[17] + tg * f[17];
  y[17] += tf * g[7] + tg * f[7];
  t = f[7] * g[17] + f[17] * g[7];
  y[16] += CONSTANT(0.14046334618799999) * t;
  y[4] += CONSTANT(0.168583882835) * t;
  y[18] += CONSTANT(0.13272538654900001) * t;

  // [7,21]: 8,20,6,22,
  tf =
    CONSTANT(-0.063718718433900007) * f[8] +
    CONSTANT(0.044869370061299998) * f[20] +
    CONSTANT(0.22072811544099999) * f[6] +
    CONSTANT(0.090297865408399999) * f[22];
  tg =
    CONSTANT(-0.063718718433900007) * g[8] +
    CONSTANT(0.044869370061299998) * g[20] +
    CONSTANT(0.22072811544099999) * g[6] +
    CONSTANT(0.090297865408399999) * g[22];
  y[7] += tf * g[21] + tg * f[21];
  y[21] += tf * g[7] + tg * f[7];
  t = f[7] * g[21] + f[21] * g[7];
  y[8] += CONSTANT(-0.063718718433900007) * t;
  y[20] += CONSTANT(0.044869370061299998) * t;
  y[6] += CONSTANT(0.22072811544099999) * t;
  y[22] += CONSTANT(0.090297865408399999) * t;

  // [7,23]: 8,22,24,
  tf =
    CONSTANT(0.16858388283299999) * f[8] +
    CONSTANT(0.13272538654800001) * f[22] +
    CONSTANT(0.140463346189) * f[24];
  tg =
    CONSTANT(0.16858388283299999) * g[8] +
    CONSTANT(0.13272538654800001) * g[22] +
    CONSTANT(0.140463346189) * g[24];
  y[7] += tf * g[23] + tg * f[23];
  y[23] += tf * g[7] + tg * f[7];
  t = f[7] * g[23] + f[23] * g[7];
  y[8] += CONSTANT(0.16858388283299999) * t;
  y[22] += CONSTANT(0.13272538654800001) * t;
  y[24] += CONSTANT(0.140463346189) * t;

  // [8,8]: 0,6,20,24,
  tf =
    CONSTANT(0.28209479177000002) * f[0] +
    CONSTANT(-0.18022375157600001) * f[6] +
    CONSTANT(0.040299255967500003) * f[20] +
    CONSTANT(0.23841361350599999) * f[24];
  tg =
    CONSTANT(0.28209479177000002) * g[0] +
    CONSTANT(-0.18022375157600001) * g[6] +
    CONSTANT(0.040299255967500003) * g[20] +
    CONSTANT(0.23841361350599999) * g[24];
  y[8] += tf * g[8] + tg * f[8];
  t = f[8] * g[8];
  y[0] += CONSTANT(0.28209479177000002) * t;
  y[6] += CONSTANT(-0.18022375157600001) * t;
  y[20] += CONSTANT(0.040299255967500003) * t;
  y[24] += CONSTANT(0.23841361350599999) * t;

  // [8,22]: 6,20,24,
  tf =
    CONSTANT(0.156078347226) * f[6] +
    CONSTANT(-0.19036461502900001) * f[20] +
    CONSTANT(-0.075080816691500005) * f[24];
  tg =
    CONSTANT(0.156078347226) * g[6] +
    CONSTANT(-0.19036461502900001) * g[20] +
    CONSTANT(-0.075080816691500005) * g[24];
  y[8] += tf * g[22] + tg * f[22];
  y[22] += tf * g[8] + tg * f[8];
  t = f[8] * g[22] + f[22] * g[8];
  y[6] += CONSTANT(0.156078347226) * t;
  y[20] += CONSTANT(-0.19036461502900001) * t;
  y[24] += CONSTANT(-0.075080816691500005) * t;

  // [9,9]: 6,0,20,
  tf =
    CONSTANT(-0.21026104350800001) * f[6] +
    CONSTANT(0.28209479176699997) * f[0] +
    CONSTANT(0.076934943209800002) * f[20];
  tg =
    CONSTANT(-0.21026104350800001) * g[6] +
    CONSTANT(0.28209479176699997) * g[0] +
    CONSTANT(0.076934943209800002) * g[20];
  y[9] += tf * g[9] + tg * f[9];
  t = f[9] * g[9];
  y[6] += CONSTANT(-0.21026104350800001) * t;
  y[0] += CONSTANT(0.28209479176699997) * t;
  y[20] += CONSTANT(0.076934943209800002) * t;

  // [9,10]: 7,21,
  tf = CONSTANT(0.14867700967899999) * f[7] + CONSTANT(-0.0993225845996) * f[21];
  tg = CONSTANT(0.14867700967899999) * g[7] + CONSTANT(-0.0993225845996) * g[21];
  y[9] += tf * g[10] + tg * f[10];
  y[10] += tf * g[9] + tg * f[9];
  t = f[9] * g[10] + f[10] * g[9];
  y[7] += CONSTANT(0.14867700967899999) * t;
  y[21] += CONSTANT(-0.0993225845996) * t;

  // [9,11]: 8,22,24,
  tf =
    CONSTANT(-0.094031597259499999) * f[8] +
    CONSTANT(0.13325523051800001) * f[22] +
    CONSTANT(0.11752006695099999) * f[24];
  tg =
    CONSTANT(-0.094031597259499999) * g[8] +
    CONSTANT(0.13325523051800001) * g[22] +
    CONSTANT(0.11752006695099999) * g[24];
  y[9] += tf * g[11] + tg * f[11];
  y[11] += tf * g[9] + tg * f[9];
  t = f[9] * g[11] + f[11] * g[9];
  y[8] += CONSTANT(-0.094031597259499999) * t;
  y[22] += CONSTANT(0.13325523051800001) * t;
  y[24] += CONSTANT(0.11752006695099999) * t;

  // [9,13]: 4,16,18,
  tf =
    CONSTANT(-0.094031597258400004) * f[4] +
    CONSTANT(-0.117520066953) * f[16] +
    CONSTANT(0.13325523051900001) * f[18];
  tg =
    CONSTANT(-0.094031597258400004) * g[4] +
    CONSTANT(-0.117520066953) * g[16] +
    CONSTANT(0.13325523051900001) * g[18];
  y[9] += tf * g[13] + tg * f[13];
  y[13] += tf * g[9] + tg * f[9];
  t = f[9] * g[13] + f[13] * g[9];
  y[4] += CONSTANT(-0.094031597258400004) * t;
  y[16] += CONSTANT(-0.117520066953) * t;
  y[18] += CONSTANT(0.13325523051900001) * t;

  // [9,14]: 5,19,
  tf = CONSTANT(0.14867700967799999) * f[5] + CONSTANT(-0.099322584600699995) * f[19];
  tg = CONSTANT(0.14867700967799999) * g[5] + CONSTANT(-0.099322584600699995) * g[19];
  y[9] += tf * g[14] + tg * f[14];
  y[14] += tf * g[9] + tg * f[9];
  t = f[9] * g[14] + f[14] * g[9];
  y[5] += CONSTANT(0.14867700967799999) * t;
  y[19] += CONSTANT(-0.099322584600699995) * t;

  // [9,17]: 2,12,
  tf = CONSTANT(0.16286750396499999) * f[2] + CONSTANT(-0.20355072687299999) * f[12];
  tg = CONSTANT(0.16286750396499999) * g[2] + CONSTANT(-0.20355072687299999) * g[12];
  y[9] += tf * g[17] + tg * f[17];
  y[17] += tf * g[9] + tg * f[9];
  t = f[9] * g[17] + f[17] * g[9];
  y[2] += CONSTANT(0.16286750396499999) * t;
  y[12] += CONSTANT(-0.20355072687299999) * t;

  // [10,10]: 0,20,24,
  tf =
    CONSTANT(0.28209479177199998) * f[0] +
    CONSTANT(-0.179514867494) * f[20] +
    CONSTANT(-0.15171775404900001) * f[24];
  tg =
    CONSTANT(0.28209479177199998) * g[0] +
    CONSTANT(-0.179514867494) * g[20] +
    CONSTANT(-0.15171775404900001) * g[24];
  y[10] += tf * g[10] + tg * f[10];
  t = f[10] * g[10];
  y[0] += CONSTANT(0.28209479177199998) * t;
  y[20] += CONSTANT(-0.179514867494) * t;
  y[24] += CONSTANT(-0.15171775404900001) * t;

  // [10,11]: 7,21,23,
  tf =
    CONSTANT(0.11516471649) * f[7] +
    CONSTANT(0.102579924281) * f[21] +
    CONSTANT(-0.067850242288900006) * f[23];
  tg =
    CONSTANT(0.11516471649) * g[7] +
    CONSTANT(0.102579924281) * g[21] +
    CONSTANT(-0.067850242288900006) * g[23];
  y[10] += tf * g[11] + tg * f[11];
  y[11] += tf * g[10] + tg * f[10];
  t = f[10] * g[11] + f[11] * g[10];
  y[7] += CONSTANT(0.11516471649) * t;
  y[21] += CONSTANT(0.102579924281) * t;
  y[23] += CONSTANT(-0.067850242288900006) * t;

  // [10,12]: 4,18,
  tf = CONSTANT(-0.18806319451799999) * f[4] + CONSTANT(-0.044418410173299998) * f[18];
  tg = CONSTANT(-0.18806319451799999) * g[4] + CONSTANT(-0.044418410173299998) * g[18];
  y[10] += tf * g[12] + tg * f[12];
  y[12] += tf * g[10] + tg * f[10];
  t = f[10] * g[12] + f[12] * g[10];
  y[4] += CONSTANT(-0.18806319451799999) * t;
  y[18] += CONSTANT(-0.044418410173299998) * t;

  // [10,13]: 5,17,19,
  tf =
    CONSTANT(0.11516471649) * f[5] +
    CONSTANT(0.067850242288900006) * f[17] +
    CONSTANT(0.102579924281) * f[19];
  tg =
    CONSTANT(0.11516471649) * g[5] +
    CONSTANT(0.067850242288900006) * g[17] +
    CONSTANT(0.102579924281) * g[19];
  y[10] += tf * g[13] + tg * f[13];
  y[13] += tf * g[10] + tg * f[10];
  t = f[10] * g[13] + f[13] * g[10];
  y[5] += CONSTANT(0.11516471649) * t;
  y[17] += CONSTANT(0.067850242288900006) * t;
  y[19] += CONSTANT(0.102579924281) * t;

  // [10,14]: 16,
  tf = CONSTANT(0.15171775404499999) * f[16];
  tg = CONSTANT(0.15171775404499999) * g[16];
  y[10] += tf * g[14] + tg * f[14];
  y[14] += tf * g[10] + tg * f[10];
  t = f[10] * g[14] + f[14] * g[10];
  y[16] += CONSTANT(0.15171775404499999) * t;

  // [10,15]: 5,19,
  tf = CONSTANT(-0.14867700967899999) * f[5] + CONSTANT(0.0993225845996) * f[19];
  tg = CONSTANT(-0.14867700967899999) * g[5] + CONSTANT(0.0993225845996) * g[19];
  y[10] += tf * g[15] + tg * f[15];
  y[15] += tf * g[10] + tg * f[10];
  t = f[10] * g[15] + f[15] * g[10];
  y[5] += CONSTANT(-0.14867700967899999) * t;
  y[19] += CONSTANT(0.0993225845996) * t;

  // [11,11]: 0,6,8,20,22,
  tf =
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.12615662610100001) * f[6] +
    CONSTANT(-0.14567312407899999) * f[8] +
    CONSTANT(0.025644981070299999) * f[20] +
    CONSTANT(-0.11468784191) * f[22];
  tg =
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.12615662610100001) * g[6] +
    CONSTANT(-0.14567312407899999) * g[8] +
    CONSTANT(0.025644981070299999) * g[20] +
    CONSTANT(-0.11468784191) * g[22];
  y[11] += tf * g[11] + tg * f[11];
  t = f[11] * g[11];
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[6] += CONSTANT(0.12615662610100001) * t;
  y[8] += CONSTANT(-0.14567312407899999) * t;
  y[20] += CONSTANT(0.025644981070299999) * t;
  y[22] += CONSTANT(-0.11468784191) * t;

  // [11,14]: 17,
  tf = CONSTANT(0.067850242288500007) * f[17];
  tg = CONSTANT(0.067850242288500007) * g[17];
  y[11] += tf * g[14] + tg * f[14];
  y[14] += tf * g[11] + tg * f[11];
  t = f[11] * g[14] + f[14] * g[11];
  y[17] += CONSTANT(0.067850242288500007) * t;

  // [11,15]: 16,
  tf = CONSTANT(-0.117520066953) * f[16];
  tg = CONSTANT(-0.117520066953) * g[16];
  y[11] += tf * g[15] + tg * f[15];
  y[15] += tf * g[11] + tg * f[11];
  t = f[11] * g[15] + f[15] * g[11];
  y[16] += CONSTANT(-0.117520066953) * t;

  // [11,18]: 3,13,15,
  tf =
    CONSTANT(0.168583882834) * f[3] +
    CONSTANT(0.114687841909) * f[13] +
    CONSTANT(-0.13325523051900001) * f[15];
  tg =
    CONSTANT(0.168583882834) * g[3] +
    CONSTANT(0.114687841909) * g[13] +
    CONSTANT(-0.13325523051900001) * g[15];
  y[11] += tf * g[18] + tg * f[18];
  y[18] += tf * g[11] + tg * f[11];
  t = f[11] * g[18] + f[18] * g[11];
  y[3] += CONSTANT(0.168583882834) * t;
  y[13] += CONSTANT(0.114687841909) * t;
  y[15] += CONSTANT(-0.13325523051900001) * t;

  // [11,19]: 2,14,12,
  tf =
    CONSTANT(0.238413613504) * f[2] +
    CONSTANT(-0.102579924282) * f[14] +
    CONSTANT(0.099322584599300004) * f[12];
  tg =
    CONSTANT(0.238413613504) * g[2] +
    CONSTANT(-0.102579924282) * g[14] +
    CONSTANT(0.099322584599300004) * g[12];
  y[11] += tf * g[19] + tg * f[19];
  y[19] += tf * g[11] + tg * f[11];
  t = f[11] * g[19] + f[19] * g[11];
  y[2] += CONSTANT(0.238413613504) * t;
  y[14] += CONSTANT(-0.102579924282) * t;
  y[12] += CONSTANT(0.099322584599300004) * t;

  // [12,12]: 0,6,20,
  tf =
    CONSTANT(0.28209479987199998) * f[0] +
    CONSTANT(0.16820885295400001) * f[6] +
    CONSTANT(0.15386991078600001) * f[20];
  tg =
    CONSTANT(0.28209479987199998) * g[0] +
    CONSTANT(0.16820885295400001) * g[6] +
    CONSTANT(0.15386991078600001) * g[20];
  y[12] += tf * g[12] + tg * f[12];
  t = f[12] * g[12];
  y[0] += CONSTANT(0.28209479987199998) * t;
  y[6] += CONSTANT(0.16820885295400001) * t;
  y[20] += CONSTANT(0.15386991078600001) * t;

  // [12,14]: 8,22,
  tf = CONSTANT(-0.18806319451799999) * f[8] + CONSTANT(-0.044418410173299998) * f[22];
  tg = CONSTANT(-0.18806319451799999) * g[8] + CONSTANT(-0.044418410173299998) * g[22];
  y[12] += tf * g[14] + tg * f[14];
  y[14] += tf * g[12] + tg * f[12];
  t = f[12] * g[14] + f[14] * g[12];
  y[8] += CONSTANT(-0.18806319451799999) * t;
  y[22] += CONSTANT(-0.044418410173299998) * t;

  // [13,13]: 0,8,6,20,22,
  tf =
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.14567312407899999) * f[8] +
    CONSTANT(0.12615662610100001) * f[6] +
    CONSTANT(0.025644981070299999) * f[20] +
    CONSTANT(0.11468784191) * f[22];
  tg =
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.14567312407899999) * g[8] +
    CONSTANT(0.12615662610100001) * g[6] +
    CONSTANT(0.025644981070299999) * g[20] +
    CONSTANT(0.11468784191) * g[22];
  y[13] += tf * g[13] + tg * f[13];
  t = f[13] * g[13];
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[8] += CONSTANT(0.14567312407899999) * t;
  y[6] += CONSTANT(0.12615662610100001) * t;
  y[20] += CONSTANT(0.025644981070299999) * t;
  y[22] += CONSTANT(0.11468784191) * t;

  // [13,14]: 23,
  tf = CONSTANT(0.067850242288500007) * f[23];
  tg = CONSTANT(0.067850242288500007) * g[23];
  y[13] += tf * g[14] + tg * f[14];
  y[14] += tf * g[13] + tg * f[13];
  t = f[13] * g[14] + f[14] * g[13];
  y[23] += CONSTANT(0.067850242288500007) * t;

  // [13,15]: 8,22,24,
  tf =
    CONSTANT(-0.094031597259499999) * f[8] +
    CONSTANT(0.13325523051800001) * f[22] +
    CONSTANT(-0.11752006695099999) * f[24];
  tg =
    CONSTANT(-0.094031597259499999) * g[8] +
    CONSTANT(0.13325523051800001) * g[22] +
    CONSTANT(-0.11752006695099999) * g[24];
  y[13] += tf * g[15] + tg * f[15];
  y[15] += tf * g[13] + tg * f[13];
  t = f[13] * g[15] + f[15] * g[13];
  y[8] += CONSTANT(-0.094031597259499999) * t;
  y[22] += CONSTANT(0.13325523051800001) * t;
  y[24] += CONSTANT(-0.11752006695099999) * t;

  // [13,21]: 2,12,14,
  tf =
    CONSTANT(0.238413613504) * f[2] +
    CONSTANT(0.099322584599300004) * f[12] +
    CONSTANT(0.102579924282) * f[14];
  tg =
    CONSTANT(0.238413613504) * g[2] +
    CONSTANT(0.099322584599300004) * g[12] +
    CONSTANT(0.102579924282) * g[14];
  y[13] += tf * g[21] + tg * f[21];
  y[21] += tf * g[13] + tg * f[13];
  t = f[13] * g[21] + f[21] * g[13];
  y[2] += CONSTANT(0.238413613504) * t;
  y[12] += CONSTANT(0.099322584599300004) * t;
  y[14] += CONSTANT(0.102579924282) * t;

  // [14,14]: 0,20,24,
  tf =
    CONSTANT(0.28209479177199998) * f[0] +
    CONSTANT(-0.179514867494) * f[20] +
    CONSTANT(0.15171775404900001) * f[24];
  tg =
    CONSTANT(0.28209479177199998) * g[0] +
    CONSTANT(-0.179514867494) * g[20] +
    CONSTANT(0.15171775404900001) * g[24];
  y[14] += tf * g[14] + tg * f[14];
  t = f[14] * g[14];
  y[0] += CONSTANT(0.28209479177199998) * t;
  y[20] += CONSTANT(-0.179514867494) * t;
  y[24] += CONSTANT(0.15171775404900001) * t;

  // [14,15]: 7,21,
  tf = CONSTANT(0.14867700967799999) * f[7] + CONSTANT(-0.099322584600699995) * f[21];
  tg = CONSTANT(0.14867700967799999) * g[7] + CONSTANT(-0.099322584600699995) * g[21];
  y[14] += tf * g[15] + tg * f[15];
  y[15] += tf * g[14] + tg * f[14];
  t = f[14] * g[15] + f[15] * g[14];
  y[7] += CONSTANT(0.14867700967799999) * t;
  y[21] += CONSTANT(-0.099322584600699995) * t;

  // [15,15]: 0,6,20,
  tf =
    CONSTANT(0.28209479176699997) * f[0] +
    CONSTANT(-0.21026104350800001) * f[6] +
    CONSTANT(0.076934943209800002) * f[20];
  tg =
    CONSTANT(0.28209479176699997) * g[0] +
    CONSTANT(-0.21026104350800001) * g[6] +
    CONSTANT(0.076934943209800002) * g[20];
  y[15] += tf * g[15] + tg * f[15];
  t = f[15] * g[15];
  y[0] += CONSTANT(0.28209479176699997) * t;
  y[6] += CONSTANT(-0.21026104350800001) * t;
  y[20] += CONSTANT(0.076934943209800002) * t;

  // [15,23]: 12,2,
  tf = CONSTANT(-0.20355072687299999) * f[12] + CONSTANT(0.16286750396499999) * f[2];
  tg = CONSTANT(-0.20355072687299999) * g[12] + CONSTANT(0.16286750396499999) * g[2];
  y[15] += tf * g[23] + tg * f[23];
  y[23] += tf * g[15] + tg * f[15];
  t = f[15] * g[23] + f[23] * g[15];
  y[12] += CONSTANT(-0.20355072687299999) * t;
  y[2] += CONSTANT(0.16286750396499999) * t;

  // [16,16]: 0,6,20,
  tf =
    CONSTANT(0.28209479176399999) * f[0] +
    CONSTANT(-0.229375683829) * f[6] +
    CONSTANT(0.106525305981) * f[20];
  tg =
    CONSTANT(0.28209479176399999) * g[0] +
    CONSTANT(-0.229375683829) * g[6] +
    CONSTANT(0.106525305981) * g[20];
  y[16] += tf * g[16] + tg * f[16];
  t = f[16] * g[16];
  y[0] += CONSTANT(0.28209479176399999) * t;
  y[6] += CONSTANT(-0.229375683829) * t;
  y[20] += CONSTANT(0.106525305981) * t;

  // [16,18]: 8,22,
  tf = CONSTANT(-0.075080816693699995) * f[8] + CONSTANT(0.13504547338) * f[22];
  tg = CONSTANT(-0.075080816693699995) * g[8] + CONSTANT(0.13504547338) * g[22];
  y[16] += tf * g[18] + tg * f[18];
  y[18] += tf * g[16] + tg * f[16];
  t = f[16] * g[18] + f[18] * g[16];
  y[8] += CONSTANT(-0.075080816693699995) * t;
  y[22] += CONSTANT(0.13504547338) * t;

  // [16,23]: 19,5,
  tf = CONSTANT(-0.11909891275499999) * f[19] + CONSTANT(0.14046334618799999) * f[5];
  tg = CONSTANT(-0.11909891275499999) * g[19] + CONSTANT(0.14046334618799999) * g[5];
  y[16] += tf * g[23] + tg * f[23];
  y[23] += tf * g[16] + tg * f[16];
  t = f[16] * g[23] + f[23] * g[16];
  y[19] += CONSTANT(-0.11909891275499999) * t;
  y[5] += CONSTANT(0.14046334618799999) * t;

  // [17,17]: 0,6,20,
  tf =
    CONSTANT(0.28209479176899999) * f[0] +
    CONSTANT(-0.057343920955899998) * f[6] +
    CONSTANT(-0.159787958979) * f[20];
  tg =
    CONSTANT(0.28209479176899999) * g[0] +
    CONSTANT(-0.057343920955899998) * g[6] +
    CONSTANT(-0.159787958979) * g[20];
  y[17] += tf * g[17] + tg * f[17];
  t = f[17] * g[17];
  y[0] += CONSTANT(0.28209479176899999) * t;
  y[6] += CONSTANT(-0.057343920955899998) * t;
  y[20] += CONSTANT(-0.159787958979) * t;

  // [17,19]: 8,22,24,
  tf =
    CONSTANT(-0.112621225039) * f[8] +
    CONSTANT(0.045015157794100001) * f[22] +
    CONSTANT(0.119098912753) * f[24];
  tg =
    CONSTANT(-0.112621225039) * g[8] +
    CONSTANT(0.045015157794100001) * g[22] +
    CONSTANT(0.119098912753) * g[24];
  y[17] += tf * g[19] + tg * f[19];
  y[19] += tf * g[17] + tg * f[17];
  t = f[17] * g[19] + f[19] * g[17];
  y[8] += CONSTANT(-0.112621225039) * t;
  y[22] += CONSTANT(0.045015157794100001) * t;
  y[24] += CONSTANT(0.119098912753) * t;

  // [17,21]: 16,4,18,
  tf =
    CONSTANT(-0.11909891275499999) * f[16] +
    CONSTANT(-0.112621225039) * f[4] +
    CONSTANT(0.045015157794399997) * f[18];
  tg =
    CONSTANT(-0.11909891275499999) * g[16] +
    CONSTANT(-0.112621225039) * g[4] +
    CONSTANT(0.045015157794399997) * g[18];
  y[17] += tf * g[21] + tg * f[21];
  y[21] += tf * g[17] + tg * f[17];
  t = f[17] * g[21] + f[21] * g[17];
  y[16] += CONSTANT(-0.11909891275499999) * t;
  y[4] += CONSTANT(-0.112621225039) * t;
  y[18] += CONSTANT(0.045015157794399997) * t;

  // [18,18]: 6,0,20,24,
  tf =
    CONSTANT(0.065535909662600006) * f[6] +
    CONSTANT(0.28209479177199998) * f[0] +
    CONSTANT(-0.083698454702400005) * f[20] +
    CONSTANT(-0.135045473384) * f[24];
  tg =
    CONSTANT(0.065535909662600006) * g[6] +
    CONSTANT(0.28209479177199998) * g[0] +
    CONSTANT(-0.083698454702400005) * g[20] +
    CONSTANT(-0.135045473384) * g[24];
  y[18] += tf * g[18] + tg * f[18];
  t = f[18] * g[18];
  y[6] += CONSTANT(0.065535909662600006) * t;
  y[0] += CONSTANT(0.28209479177199998) * t;
  y[20] += CONSTANT(-0.083698454702400005) * t;
  y[24] += CONSTANT(-0.135045473384) * t;

  // [18,19]: 7,21,23,
  tf =
    CONSTANT(0.090297865407399994) * f[7] +
    CONSTANT(0.102084782359) * f[21] +
    CONSTANT(-0.045015157794399997) * f[23];
  tg =
    CONSTANT(0.090297865407399994) * g[7] +
    CONSTANT(0.102084782359) * g[21] +
    CONSTANT(-0.045015157794399997) * g[23];
  y[18] += tf * g[19] + tg * f[19];
  y[19] += tf * g[18] + tg * f[18];
  t = f[18] * g[19] + f[19] * g[18];
  y[7] += CONSTANT(0.090297865407399994) * t;
  y[21] += CONSTANT(0.102084782359) * t;
  y[23] += CONSTANT(-0.045015157794399997) * t;

  // [19,19]: 6,8,0,20,22,
  tf =
    CONSTANT(0.13926380803399999) * f[6] +
    CONSTANT(-0.14188940657099999) * f[8] +
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.068480553847200004) * f[20] +
    CONSTANT(-0.10208478236) * f[22];
  tg =
    CONSTANT(0.13926380803399999) * g[6] +
    CONSTANT(-0.14188940657099999) * g[8] +
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.068480553847200004) * g[20] +
    CONSTANT(-0.10208478236) * g[22];
  y[19] += tf * g[19] + tg * f[19];
  t = f[19] * g[19];
  y[6] += CONSTANT(0.13926380803399999) * t;
  y[8] += CONSTANT(-0.14188940657099999) * t;
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[20] += CONSTANT(0.068480553847200004) * t;
  y[22] += CONSTANT(-0.10208478236) * t;

  // [20,20]: 6,0,20,
  tf = CONSTANT(0.16383979750300001) * f[6] + CONSTANT(0.28209480223200001) * f[0];
  tg = CONSTANT(0.16383979750300001) * g[6] + CONSTANT(0.28209480223200001) * g[0];
  y[20] += tf * g[20] + tg * f[20];
  t = f[20] * g[20];
  y[6] += CONSTANT(0.16383979750300001) * t;
  y[0] += CONSTANT(0.28209480223200001) * t;
  y[20] += CONSTANT(0.13696113900599999) * t;

  // [21,21]: 6,20,0,8,22,
  tf =
    CONSTANT(0.13926380803399999) * f[6] +
    CONSTANT(0.068480553847200004) * f[20] +
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.14188940657099999) * f[8] +
    CONSTANT(0.10208478236) * f[22];
  tg =
    CONSTANT(0.13926380803399999) * g[6] +
    CONSTANT(0.068480553847200004) * g[20] +
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.14188940657099999) * g[8] +
    CONSTANT(0.10208478236) * g[22];
  y[21] += tf * g[21] + tg * f[21];
  t = f[21] * g[21];
  y[6] += CONSTANT(0.13926380803399999) * t;
  y[20] += CONSTANT(0.068480553847200004) * t;
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[8] += CONSTANT(0.14188940657099999) * t;
  y[22] += CONSTANT(0.10208478236) * t;

  // [21,23]: 8,22,24,
  tf =
    CONSTANT(-0.112621225039) * f[8] +
    CONSTANT(0.045015157794100001) * f[22] +
    CONSTANT(-0.119098912753) * f[24];
  tg =
    CONSTANT(-0.112621225039) * g[8] +
    CONSTANT(0.045015157794100001) * g[22] +
    CONSTANT(-0.119098912753) * g[24];
  y[21] += tf * g[23] + tg * f[23];
  y[23] += tf * g[21] + tg * f[21];
  t = f[21] * g[23] + f[23] * g[21];
  y[8] += CONSTANT(-0.112621225039) * t;
  y[22] += CONSTANT(0.045015157794100001) * t;
  y[24] += CONSTANT(-0.119098912753) * t;

  // [22,22]: 6,20,0,24,
  tf =
    CONSTANT(0.065535909662600006) * f[6] +
    CONSTANT(-0.083698454702400005) * f[20] +
    CONSTANT(0.28209479177199998) * f[0] +
    CONSTANT(0.135045473384) * f[24];
  tg =
    CONSTANT(0.065535909662600006) * g[6] +
    CONSTANT(-0.083698454702400005) * g[20] +
    CONSTANT(0.28209479177199998) * g[0] +
    CONSTANT(0.135045473384) * g[24];
  y[22] += tf * g[22] + tg * f[22];
  t = f[22] * g[22];
  y[6] += CONSTANT(0.065535909662600006) * t;
  y[20] += CONSTANT(-0.083698454702400005) * t;
  y[0] += CONSTANT(0.28209479177199998) * t;
  y[24] += CONSTANT(0.135045473384) * t;

  // [23,23]: 6,20,0,
  tf =
    CONSTANT(-0.057343920955899998) * f[6] +
    CONSTANT(-0.159787958979) * f[20] +
    CONSTANT(0.28209479176899999) * f[0];
  tg =
    CONSTANT(-0.057343920955899998) * g[6] +
    CONSTANT(-0.159787958979) * g[20] +
    CONSTANT(0.28209479176899999) * g[0];
  y[23] += tf * g[23] + tg * f[23];
  t = f[23] * g[23];
  y[6] += CONSTANT(-0.057343920955899998) * t;
  y[20] += CONSTANT(-0.159787958979) * t;
  y[0] += CONSTANT(0.28209479176899999) * t;

  // [24,24]: 6,0,20,
  tf =
    CONSTANT(-0.229375683829) * f[6] +
    CONSTANT(0.28209479176399999) * f[0] +
    CONSTANT(0.106525305981) * f[20];
  tg =
    CONSTANT(-0.229375683829) * g[6] +
    CONSTANT(0.28209479176399999) * g[0] +
    CONSTANT(0.106525305981) * g[20];
  y[24] += tf * g[24] + tg * f[24];
  t = f[24] * g[24];
  y[6] += CONSTANT(-0.229375683829) * t;
  y[0] += CONSTANT(0.28209479176399999) * t;
  y[20] += CONSTANT(0.106525305981) * t;

  // multiply count=1135

  return y;
}

//-------------------------------------------------------------------------------------
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb232909.aspx
//-------------------------------------------------------------------------------------
function XMSHMultiply6(y: Float32Array, f: Float32Array, g: Float32Array): Float32Array {
  if (!y || !f || !g) return null;

  let tf: number, tg: number, t: number;
  // [0,0]: 0,
  y[0] = CONSTANT(0.28209479293599998) * f[0] * g[0];

  // [1,1]: 0,6,8,
  tf =
    CONSTANT(0.28209479177300001) * f[0] +
    CONSTANT(-0.12615662610100001) * f[6] +
    CONSTANT(-0.21850968611999999) * f[8];
  tg =
    CONSTANT(0.28209479177300001) * g[0] +
    CONSTANT(-0.12615662610100001) * g[6] +
    CONSTANT(-0.21850968611999999) * g[8];
  y[1] = tf * g[1] + tg * f[1];
  t = f[1] * g[1];
  y[0] += CONSTANT(0.28209479177300001) * t;
  y[6] = CONSTANT(-0.12615662610100001) * t;
  y[8] = CONSTANT(-0.21850968611999999) * t;

  // [1,4]: 3,13,15,
  tf =
    CONSTANT(0.21850968611499999) * f[3] +
    CONSTANT(-0.0583991700823) * f[13] +
    CONSTANT(-0.22617901315799999) * f[15];
  tg =
    CONSTANT(0.21850968611499999) * g[3] +
    CONSTANT(-0.0583991700823) * g[13] +
    CONSTANT(-0.22617901315799999) * g[15];
  y[1] += tf * g[4] + tg * f[4];
  y[4] = tf * g[1] + tg * f[1];
  t = f[1] * g[4] + f[4] * g[1];
  y[3] = CONSTANT(0.21850968611499999) * t;
  y[13] = CONSTANT(-0.0583991700823) * t;
  y[15] = CONSTANT(-0.22617901315799999) * t;

  // [1,5]: 2,12,
  tf = CONSTANT(0.21850968611800001) * f[2] + CONSTANT(-0.143048168103) * f[12];
  tg = CONSTANT(0.21850968611800001) * g[2] + CONSTANT(-0.143048168103) * g[12];
  y[1] += tf * g[5] + tg * f[5];
  y[5] = tf * g[1] + tg * f[1];
  t = f[1] * g[5] + f[5] * g[1];
  y[2] = CONSTANT(0.21850968611800001) * t;
  y[12] = CONSTANT(-0.143048168103) * t;

  // [1,11]: 6,8,20,22,
  tf =
    CONSTANT(0.20230065940299999) * f[6] +
    CONSTANT(0.058399170081799998) * f[8] +
    CONSTANT(-0.150786008773) * f[20] +
    CONSTANT(-0.16858388283699999) * f[22];
  tg =
    CONSTANT(0.20230065940299999) * g[6] +
    CONSTANT(0.058399170081799998) * g[8] +
    CONSTANT(-0.150786008773) * g[20] +
    CONSTANT(-0.16858388283699999) * g[22];
  y[1] += tf * g[11] + tg * f[11];
  y[11] = tf * g[1] + tg * f[1];
  t = f[1] * g[11] + f[11] * g[1];
  y[6] += CONSTANT(0.20230065940299999) * t;
  y[8] += CONSTANT(0.058399170081799998) * t;
  y[20] = CONSTANT(-0.150786008773) * t;
  y[22] = CONSTANT(-0.16858388283699999) * t;

  // [1,16]: 15,33,35,
  tf =
    CONSTANT(0.23032943297399999) * f[15] +
    CONSTANT(-0.034723468517399998) * f[33] +
    CONSTANT(-0.23293210805199999) * f[35];
  tg =
    CONSTANT(0.23032943297399999) * g[15] +
    CONSTANT(-0.034723468517399998) * g[33] +
    CONSTANT(-0.23293210805199999) * g[35];
  y[1] += tf * g[16] + tg * f[16];
  y[16] = tf * g[1] + tg * f[1];
  t = f[1] * g[16] + f[16] * g[1];
  y[15] += CONSTANT(0.23032943297399999) * t;
  y[33] = CONSTANT(-0.034723468517399998) * t;
  y[35] = CONSTANT(-0.23293210805199999) * t;

  // [1,18]: 15,13,31,33,
  tf =
    CONSTANT(0.043528171377799997) * f[15] +
    CONSTANT(0.168583882834) * f[13] +
    CONSTANT(-0.085054779966799998) * f[31] +
    CONSTANT(-0.18373932470599999) * f[33];
  tg =
    CONSTANT(0.043528171377799997) * g[15] +
    CONSTANT(0.168583882834) * g[13] +
    CONSTANT(-0.085054779966799998) * g[31] +
    CONSTANT(-0.18373932470599999) * g[33];
  y[1] += tf * g[18] + tg * f[18];
  y[18] = tf * g[1] + tg * f[1];
  t = f[1] * g[18] + f[18] * g[1];
  y[15] += CONSTANT(0.043528171377799997) * t;
  y[13] += CONSTANT(0.168583882834) * t;
  y[31] = CONSTANT(-0.085054779966799998) * t;
  y[33] += CONSTANT(-0.18373932470599999) * t;

  // [1,19]: 14,12,30,32,
  tf =
    CONSTANT(0.075393004386399995) * f[14] +
    CONSTANT(0.19466390027300001) * f[12] +
    CONSTANT(-0.15528807203700001) * f[30] +
    CONSTANT(-0.15912292286999999) * f[32];
  tg =
    CONSTANT(0.075393004386399995) * g[14] +
    CONSTANT(0.19466390027300001) * g[12] +
    CONSTANT(-0.15528807203700001) * g[30] +
    CONSTANT(-0.15912292286999999) * g[32];
  y[1] += tf * g[19] + tg * f[19];
  y[19] = tf * g[1] + tg * f[1];
  t = f[1] * g[19] + f[19] * g[1];
  y[14] = CONSTANT(0.075393004386399995) * t;
  y[12] += CONSTANT(0.19466390027300001) * t;
  y[30] = CONSTANT(-0.15528807203700001) * t;
  y[32] = CONSTANT(-0.15912292286999999) * t;

  // [1,24]: 9,25,27,
  tf =
    CONSTANT(-0.23032943297899999) * f[9] +
    CONSTANT(0.232932108049) * f[25] +
    CONSTANT(0.034723468517100002) * f[27];
  tg =
    CONSTANT(-0.23032943297899999) * g[9] +
    CONSTANT(0.232932108049) * g[25] +
    CONSTANT(0.034723468517100002) * g[27];
  y[1] += tf * g[24] + tg * f[24];
  y[24] = tf * g[1] + tg * f[1];
  t = f[1] * g[24] + f[24] * g[1];
  y[9] = CONSTANT(-0.23032943297899999) * t;
  y[25] = CONSTANT(0.232932108049) * t;
  y[27] = CONSTANT(0.034723468517100002) * t;

  // [1,29]: 22,20,
  tf = CONSTANT(0.085054779965999999) * f[22] + CONSTANT(0.19018826981500001) * f[20];
  tg = CONSTANT(0.085054779965999999) * g[22] + CONSTANT(0.19018826981500001) * g[20];
  y[1] += tf * g[29] + tg * f[29];
  y[29] = tf * g[1] + tg * f[1];
  t = f[1] * g[29] + f[29] * g[1];
  y[22] += CONSTANT(0.085054779965999999) * t;
  y[20] += CONSTANT(0.19018826981500001) * t;

  // [2,2]: 0,6,
  tf = CONSTANT(0.282094795249) * f[0] + CONSTANT(0.25231325998699999) * f[6];
  tg = CONSTANT(0.282094795249) * g[0] + CONSTANT(0.25231325998699999) * g[6];
  y[2] += tf * g[2] + tg * f[2];
  t = f[2] * g[2];
  y[0] += CONSTANT(0.282094795249) * t;
  y[6] += CONSTANT(0.25231325998699999) * t;

  // [2,12]: 6,20,
  tf = CONSTANT(0.24776670697399999) * f[6] + CONSTANT(0.24623253717400001) * f[20];
  tg = CONSTANT(0.24776670697399999) * g[6] + CONSTANT(0.24623253717400001) * g[20];
  y[2] += tf * g[12] + tg * f[12];
  y[12] += tf * g[2] + tg * f[2];
  t = f[2] * g[12] + f[12] * g[2];
  y[6] += CONSTANT(0.24776670697399999) * t;
  y[20] += CONSTANT(0.24623253717400001) * t;

  // [2,20]: 30,
  tf = CONSTANT(0.24553202056000001) * f[30];
  tg = CONSTANT(0.24553202056000001) * g[30];
  y[2] += tf * g[20] + tg * f[20];
  y[20] += tf * g[2] + tg * f[2];
  t = f[2] * g[20] + f[20] * g[2];
  y[30] += CONSTANT(0.24553202056000001) * t;

  // [3,3]: 0,6,8,
  tf =
    CONSTANT(0.28209479177300001) * f[0] +
    CONSTANT(-0.12615662610100001) * f[6] +
    CONSTANT(0.21850968611999999) * f[8];
  tg =
    CONSTANT(0.28209479177300001) * g[0] +
    CONSTANT(-0.12615662610100001) * g[6] +
    CONSTANT(0.21850968611999999) * g[8];
  y[3] += tf * g[3] + tg * f[3];
  t = f[3] * g[3];
  y[0] += CONSTANT(0.28209479177300001) * t;
  y[6] += CONSTANT(-0.12615662610100001) * t;
  y[8] += CONSTANT(0.21850968611999999) * t;

  // [3,7]: 2,12,
  tf = CONSTANT(0.21850968611800001) * f[2] + CONSTANT(-0.143048168103) * f[12];
  tg = CONSTANT(0.21850968611800001) * g[2] + CONSTANT(-0.143048168103) * g[12];
  y[3] += tf * g[7] + tg * f[7];
  y[7] = tf * g[3] + tg * f[3];
  t = f[3] * g[7] + f[7] * g[3];
  y[2] += CONSTANT(0.21850968611800001) * t;
  y[12] += CONSTANT(-0.143048168103) * t;

  // [3,13]: 8,6,20,22,
  tf =
    CONSTANT(-0.058399170081799998) * f[8] +
    CONSTANT(0.20230065940299999) * f[6] +
    CONSTANT(-0.150786008773) * f[20] +
    CONSTANT(0.16858388283699999) * f[22];
  tg =
    CONSTANT(-0.058399170081799998) * g[8] +
    CONSTANT(0.20230065940299999) * g[6] +
    CONSTANT(-0.150786008773) * g[20] +
    CONSTANT(0.16858388283699999) * g[22];
  y[3] += tf * g[13] + tg * f[13];
  y[13] += tf * g[3] + tg * f[3];
  t = f[3] * g[13] + f[13] * g[3];
  y[8] += CONSTANT(-0.058399170081799998) * t;
  y[6] += CONSTANT(0.20230065940299999) * t;
  y[20] += CONSTANT(-0.150786008773) * t;
  y[22] += CONSTANT(0.16858388283699999) * t;

  // [3,16]: 9,25,27,
  tf =
    CONSTANT(0.23032943297399999) * f[9] +
    CONSTANT(0.23293210805199999) * f[25] +
    CONSTANT(-0.034723468517399998) * f[27];
  tg =
    CONSTANT(0.23032943297399999) * g[9] +
    CONSTANT(0.23293210805199999) * g[25] +
    CONSTANT(-0.034723468517399998) * g[27];
  y[3] += tf * g[16] + tg * f[16];
  y[16] += tf * g[3] + tg * f[3];
  t = f[3] * g[16] + f[16] * g[3];
  y[9] += CONSTANT(0.23032943297399999) * t;
  y[25] += CONSTANT(0.23293210805199999) * t;
  y[27] += CONSTANT(-0.034723468517399998) * t;

  // [3,21]: 12,14,30,32,
  tf =
    CONSTANT(0.19466390027300001) * f[12] +
    CONSTANT(-0.075393004386399995) * f[14] +
    CONSTANT(-0.15528807203700001) * f[30] +
    CONSTANT(0.15912292286999999) * f[32];
  tg =
    CONSTANT(0.19466390027300001) * g[12] +
    CONSTANT(-0.075393004386399995) * g[14] +
    CONSTANT(-0.15528807203700001) * g[30] +
    CONSTANT(0.15912292286999999) * g[32];
  y[3] += tf * g[21] + tg * f[21];
  y[21] = tf * g[3] + tg * f[3];
  t = f[3] * g[21] + f[21] * g[3];
  y[12] += CONSTANT(0.19466390027300001) * t;
  y[14] += CONSTANT(-0.075393004386399995) * t;
  y[30] += CONSTANT(-0.15528807203700001) * t;
  y[32] += CONSTANT(0.15912292286999999) * t;

  // [3,24]: 15,33,35,
  tf =
    CONSTANT(0.23032943297899999) * f[15] +
    CONSTANT(-0.034723468517100002) * f[33] +
    CONSTANT(0.232932108049) * f[35];
  tg =
    CONSTANT(0.23032943297899999) * g[15] +
    CONSTANT(-0.034723468517100002) * g[33] +
    CONSTANT(0.232932108049) * g[35];
  y[3] += tf * g[24] + tg * f[24];
  y[24] += tf * g[3] + tg * f[3];
  t = f[3] * g[24] + f[24] * g[3];
  y[15] += CONSTANT(0.23032943297899999) * t;
  y[33] += CONSTANT(-0.034723468517100002) * t;
  y[35] += CONSTANT(0.232932108049) * t;

  // [3,31]: 20,22,
  tf = CONSTANT(0.19018826981500001) * f[20] + CONSTANT(-0.085054779965999999) * f[22];
  tg = CONSTANT(0.19018826981500001) * g[20] + CONSTANT(-0.085054779965999999) * g[22];
  y[3] += tf * g[31] + tg * f[31];
  y[31] += tf * g[3] + tg * f[3];
  t = f[3] * g[31] + f[31] * g[3];
  y[20] += CONSTANT(0.19018826981500001) * t;
  y[22] += CONSTANT(-0.085054779965999999) * t;

  // [4,4]: 0,6,20,24,
  tf =
    CONSTANT(0.28209479177000002) * f[0] +
    CONSTANT(-0.18022375157600001) * f[6] +
    CONSTANT(0.040299255967500003) * f[20] +
    CONSTANT(-0.23841361350599999) * f[24];
  tg =
    CONSTANT(0.28209479177000002) * g[0] +
    CONSTANT(-0.18022375157600001) * g[6] +
    CONSTANT(0.040299255967500003) * g[20] +
    CONSTANT(-0.23841361350599999) * g[24];
  y[4] += tf * g[4] + tg * f[4];
  t = f[4] * g[4];
  y[0] += CONSTANT(0.28209479177000002) * t;
  y[6] += CONSTANT(-0.18022375157600001) * t;
  y[20] += CONSTANT(0.040299255967500003) * t;
  y[24] += CONSTANT(-0.23841361350599999) * t;

  // [4,5]: 7,21,23,
  tf =
    CONSTANT(0.156078347226) * f[7] +
    CONSTANT(-0.063718718434399996) * f[21] +
    CONSTANT(-0.168583882835) * f[23];
  tg =
    CONSTANT(0.156078347226) * g[7] +
    CONSTANT(-0.063718718434399996) * g[21] +
    CONSTANT(-0.168583882835) * g[23];
  y[4] += tf * g[5] + tg * f[5];
  y[5] += tf * g[4] + tg * f[4];
  t = f[4] * g[5] + f[5] * g[4];
  y[7] += CONSTANT(0.156078347226) * t;
  y[21] += CONSTANT(-0.063718718434399996) * t;
  y[23] = CONSTANT(-0.168583882835) * t;

  // [4,9]: 3,13,31,35,
  tf =
    CONSTANT(0.22617901315799999) * f[3] +
    CONSTANT(-0.094031597258400004) * f[13] +
    CONSTANT(0.016943317729299998) * f[31] +
    CONSTANT(-0.245532000542) * f[35];
  tg =
    CONSTANT(0.22617901315799999) * g[3] +
    CONSTANT(-0.094031597258400004) * g[13] +
    CONSTANT(0.016943317729299998) * g[31] +
    CONSTANT(-0.245532000542) * g[35];
  y[4] += tf * g[9] + tg * f[9];
  y[9] += tf * g[4] + tg * f[4];
  t = f[4] * g[9] + f[9] * g[4];
  y[3] += CONSTANT(0.22617901315799999) * t;
  y[13] += CONSTANT(-0.094031597258400004) * t;
  y[31] += CONSTANT(0.016943317729299998) * t;
  y[35] += CONSTANT(-0.245532000542) * t;

  // [4,10]: 2,12,30,34,
  tf =
    CONSTANT(0.18467439091999999) * f[2] +
    CONSTANT(-0.18806319451799999) * f[12] +
    CONSTANT(0.0535794751444) * f[30] +
    CONSTANT(-0.19018826981600001) * f[34];
  tg =
    CONSTANT(0.18467439091999999) * g[2] +
    CONSTANT(-0.18806319451799999) * g[12] +
    CONSTANT(0.0535794751444) * g[30] +
    CONSTANT(-0.19018826981600001) * g[34];
  y[4] += tf * g[10] + tg * f[10];
  y[10] = tf * g[4] + tg * f[4];
  t = f[4] * g[10] + f[10] * g[4];
  y[2] += CONSTANT(0.18467439091999999) * t;
  y[12] += CONSTANT(-0.18806319451799999) * t;
  y[30] += CONSTANT(0.0535794751444) * t;
  y[34] = CONSTANT(-0.19018826981600001) * t;

  // [4,11]: 3,13,15,31,33,
  tf =
    CONSTANT(-0.0583991700823) * f[3] +
    CONSTANT(0.14567312407800001) * f[13] +
    CONSTANT(0.094031597258400004) * f[15] +
    CONSTANT(-0.065621187395699998) * f[31] +
    CONSTANT(-0.14175796661000001) * f[33];
  tg =
    CONSTANT(-0.0583991700823) * g[3] +
    CONSTANT(0.14567312407800001) * g[13] +
    CONSTANT(0.094031597258400004) * g[15] +
    CONSTANT(-0.065621187395699998) * g[31] +
    CONSTANT(-0.14175796661000001) * g[33];
  y[4] += tf * g[11] + tg * f[11];
  y[11] += tf * g[4] + tg * f[4];
  t = f[4] * g[11] + f[11] * g[4];
  y[3] += CONSTANT(-0.0583991700823) * t;
  y[13] += CONSTANT(0.14567312407800001) * t;
  y[15] += CONSTANT(0.094031597258400004) * t;
  y[31] += CONSTANT(-0.065621187395699998) * t;
  y[33] += CONSTANT(-0.14175796661000001) * t;

  // [4,16]: 8,22,
  tf = CONSTANT(0.238413613494) * f[8] + CONSTANT(-0.075080816693699995) * f[22];
  tg = CONSTANT(0.238413613494) * g[8] + CONSTANT(-0.075080816693699995) * g[22];
  y[4] += tf * g[16] + tg * f[16];
  y[16] += tf * g[4] + tg * f[4];
  t = f[4] * g[16] + f[16] * g[4];
  y[8] += CONSTANT(0.238413613494) * t;
  y[22] += CONSTANT(-0.075080816693699995) * t;

  // [4,18]: 6,20,24,
  tf =
    CONSTANT(0.156078347226) * f[6] +
    CONSTANT(-0.19036461502900001) * f[20] +
    CONSTANT(0.075080816691500005) * f[24];
  tg =
    CONSTANT(0.156078347226) * g[6] +
    CONSTANT(-0.19036461502900001) * g[20] +
    CONSTANT(0.075080816691500005) * g[24];
  y[4] += tf * g[18] + tg * f[18];
  y[18] += tf * g[4] + tg * f[4];
  t = f[4] * g[18] + f[18] * g[4];
  y[6] += CONSTANT(0.156078347226) * t;
  y[20] += CONSTANT(-0.19036461502900001) * t;
  y[24] += CONSTANT(0.075080816691500005) * t;

  // [4,19]: 7,21,23,
  tf =
    CONSTANT(-0.063718718434399996) * f[7] +
    CONSTANT(0.14188940656999999) * f[21] +
    CONSTANT(0.112621225039) * f[23];
  tg =
    CONSTANT(-0.063718718434399996) * g[7] +
    CONSTANT(0.14188940656999999) * g[21] +
    CONSTANT(0.112621225039) * g[23];
  y[4] += tf * g[19] + tg * f[19];
  y[19] += tf * g[4] + tg * f[4];
  t = f[4] * g[19] + f[19] * g[4];
  y[7] += CONSTANT(-0.063718718434399996) * t;
  y[21] += CONSTANT(0.14188940656999999) * t;
  y[23] += CONSTANT(0.112621225039) * t;

  // [4,25]: 15,33,
  tf = CONSTANT(0.245532000542) * f[15] + CONSTANT(-0.0626413476808) * f[33];
  tg = CONSTANT(0.245532000542) * g[15] + CONSTANT(-0.0626413476808) * g[33];
  y[4] += tf * g[25] + tg * f[25];
  y[25] += tf * g[4] + tg * f[4];
  t = f[4] * g[25] + f[25] * g[4];
  y[15] += CONSTANT(0.245532000542) * t;
  y[33] += CONSTANT(-0.0626413476808) * t;

  // [4,26]: 14,32,
  tf = CONSTANT(0.19018826980699999) * f[14] + CONSTANT(-0.097043558542400002) * f[32];
  tg = CONSTANT(0.19018826980699999) * g[14] + CONSTANT(-0.097043558542400002) * g[32];
  y[4] += tf * g[26] + tg * f[26];
  y[26] = tf * g[4] + tg * f[4];
  t = f[4] * g[26] + f[26] * g[4];
  y[14] += CONSTANT(0.19018826980699999) * t;
  y[32] += CONSTANT(-0.097043558542400002) * t;

  // [4,27]: 13,31,35,
  tf =
    CONSTANT(0.14175796661000001) * f[13] +
    CONSTANT(-0.121034582549) * f[31] +
    CONSTANT(0.0626413476808) * f[35];
  tg =
    CONSTANT(0.14175796661000001) * g[13] +
    CONSTANT(-0.121034582549) * g[31] +
    CONSTANT(0.0626413476808) * g[35];
  y[4] += tf * g[27] + tg * f[27];
  y[27] += tf * g[4] + tg * f[4];
  t = f[4] * g[27] + f[27] * g[4];
  y[13] += CONSTANT(0.14175796661000001) * t;
  y[31] += CONSTANT(-0.121034582549) * t;
  y[35] += CONSTANT(0.0626413476808) * t;

  // [4,28]: 12,30,34,
  tf =
    CONSTANT(0.141757966609) * f[12] +
    CONSTANT(-0.191372478254) * f[30] +
    CONSTANT(0.097043558538899996) * f[34];
  tg =
    CONSTANT(0.141757966609) * g[12] +
    CONSTANT(-0.191372478254) * g[30] +
    CONSTANT(0.097043558538899996) * g[34];
  y[4] += tf * g[28] + tg * f[28];
  y[28] = tf * g[4] + tg * f[4];
  t = f[4] * g[28] + f[28] * g[4];
  y[12] += CONSTANT(0.141757966609) * t;
  y[30] += CONSTANT(-0.191372478254) * t;
  y[34] += CONSTANT(0.097043558538899996) * t;

  // [4,29]: 13,15,31,33,
  tf =
    CONSTANT(-0.065621187395699998) * f[13] +
    CONSTANT(-0.016943317729299998) * f[15] +
    CONSTANT(0.14007031161399999) * f[31] +
    CONSTANT(0.121034582549) * f[33];
  tg =
    CONSTANT(-0.065621187395699998) * g[13] +
    CONSTANT(-0.016943317729299998) * g[15] +
    CONSTANT(0.14007031161399999) * g[31] +
    CONSTANT(0.121034582549) * g[33];
  y[4] += tf * g[29] + tg * f[29];
  y[29] += tf * g[4] + tg * f[4];
  t = f[4] * g[29] + f[29] * g[4];
  y[13] += CONSTANT(-0.065621187395699998) * t;
  y[15] += CONSTANT(-0.016943317729299998) * t;
  y[31] += CONSTANT(0.14007031161399999) * t;
  y[33] += CONSTANT(0.121034582549) * t;

  // [5,5]: 0,6,8,20,22,
  tf =
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.090111875786499998) * f[6] +
    CONSTANT(-0.15607834722799999) * f[8] +
    CONSTANT(-0.16119702387099999) * f[20] +
    CONSTANT(-0.180223751574) * f[22];
  tg =
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.090111875786499998) * g[6] +
    CONSTANT(-0.15607834722799999) * g[8] +
    CONSTANT(-0.16119702387099999) * g[20] +
    CONSTANT(-0.180223751574) * g[22];
  y[5] += tf * g[5] + tg * f[5];
  t = f[5] * g[5];
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[6] += CONSTANT(0.090111875786499998) * t;
  y[8] += CONSTANT(-0.15607834722799999) * t;
  y[20] += CONSTANT(-0.16119702387099999) * t;
  y[22] += CONSTANT(-0.180223751574) * t;

  // [5,10]: 3,13,15,31,33,
  tf =
    CONSTANT(0.18467439091999999) * f[3] +
    CONSTANT(0.11516471649) * f[13] +
    CONSTANT(-0.14867700967899999) * f[15] +
    CONSTANT(-0.083004965974099995) * f[31] +
    CONSTANT(-0.17931122038399999) * f[33];
  tg =
    CONSTANT(0.18467439091999999) * g[3] +
    CONSTANT(0.11516471649) * g[13] +
    CONSTANT(-0.14867700967899999) * g[15] +
    CONSTANT(-0.083004965974099995) * g[31] +
    CONSTANT(-0.17931122038399999) * g[33];
  y[5] += tf * g[10] + tg * f[10];
  y[10] += tf * g[5] + tg * f[5];
  t = f[5] * g[10] + f[10] * g[5];
  y[3] += CONSTANT(0.18467439091999999) * t;
  y[13] += CONSTANT(0.11516471649) * t;
  y[15] += CONSTANT(-0.14867700967899999) * t;
  y[31] += CONSTANT(-0.083004965974099995) * t;
  y[33] += CONSTANT(-0.17931122038399999) * t;

  // [5,11]: 2,12,14,30,32,
  tf =
    CONSTANT(0.23359668032700001) * f[2] +
    CONSTANT(0.059470803871800003) * f[12] +
    CONSTANT(-0.115164716491) * f[14] +
    CONSTANT(-0.16943317729400001) * f[30] +
    CONSTANT(-0.173617342585) * f[32];
  tg =
    CONSTANT(0.23359668032700001) * g[2] +
    CONSTANT(0.059470803871800003) * g[12] +
    CONSTANT(-0.115164716491) * g[14] +
    CONSTANT(-0.16943317729400001) * g[30] +
    CONSTANT(-0.173617342585) * g[32];
  y[5] += tf * g[11] + tg * f[11];
  y[11] += tf * g[5] + tg * f[5];
  t = f[5] * g[11] + f[11] * g[5];
  y[2] += CONSTANT(0.23359668032700001) * t;
  y[12] += CONSTANT(0.059470803871800003) * t;
  y[14] += CONSTANT(-0.115164716491) * t;
  y[30] += CONSTANT(-0.16943317729400001) * t;
  y[32] += CONSTANT(-0.173617342585) * t;

  // [5,14]: 9,1,27,29,
  tf =
    CONSTANT(0.14867700967799999) * f[9] +
    CONSTANT(-0.184674390923) * f[1] +
    CONSTANT(0.17931122038200001) * f[27] +
    CONSTANT(0.083004965973399999) * f[29];
  tg =
    CONSTANT(0.14867700967799999) * g[9] +
    CONSTANT(-0.184674390923) * g[1] +
    CONSTANT(0.17931122038200001) * g[27] +
    CONSTANT(0.083004965973399999) * g[29];
  y[5] += tf * g[14] + tg * f[14];
  y[14] += tf * g[5] + tg * f[5];
  t = f[5] * g[14] + f[14] * g[5];
  y[9] += CONSTANT(0.14867700967799999) * t;
  y[1] += CONSTANT(-0.184674390923) * t;
  y[27] += CONSTANT(0.17931122038200001) * t;
  y[29] += CONSTANT(0.083004965973399999) * t;

  // [5,17]: 8,22,24,
  tf =
    CONSTANT(0.16858388283299999) * f[8] +
    CONSTANT(0.13272538654800001) * f[22] +
    CONSTANT(-0.140463346189) * f[24];
  tg =
    CONSTANT(0.16858388283299999) * g[8] +
    CONSTANT(0.13272538654800001) * g[22] +
    CONSTANT(-0.140463346189) * g[24];
  y[5] += tf * g[17] + tg * f[17];
  y[17] = tf * g[5] + tg * f[5];
  t = f[5] * g[17] + f[17] * g[5];
  y[8] += CONSTANT(0.16858388283299999) * t;
  y[22] += CONSTANT(0.13272538654800001) * t;
  y[24] += CONSTANT(-0.140463346189) * t;

  // [5,18]: 7,21,23,
  tf =
    CONSTANT(0.18022375157100001) * f[7] +
    CONSTANT(0.090297865407399994) * f[21] +
    CONSTANT(-0.13272538654900001) * f[23];
  tg =
    CONSTANT(0.18022375157100001) * g[7] +
    CONSTANT(0.090297865407399994) * g[21] +
    CONSTANT(-0.13272538654900001) * g[23];
  y[5] += tf * g[18] + tg * f[18];
  y[18] += tf * g[5] + tg * f[5];
  t = f[5] * g[18] + f[18] * g[5];
  y[7] += CONSTANT(0.18022375157100001) * t;
  y[21] += CONSTANT(0.090297865407399994) * t;
  y[23] += CONSTANT(-0.13272538654900001) * t;

  // [5,19]: 6,8,20,22,
  tf =
    CONSTANT(0.22072811544099999) * f[6] +
    CONSTANT(0.063718718433900007) * f[8] +
    CONSTANT(0.044869370061299998) * f[20] +
    CONSTANT(-0.090297865408399999) * f[22];
  tg =
    CONSTANT(0.22072811544099999) * g[6] +
    CONSTANT(0.063718718433900007) * g[8] +
    CONSTANT(0.044869370061299998) * g[20] +
    CONSTANT(-0.090297865408399999) * g[22];
  y[5] += tf * g[19] + tg * f[19];
  y[19] += tf * g[5] + tg * f[5];
  t = f[5] * g[19] + f[19] * g[5];
  y[6] += CONSTANT(0.22072811544099999) * t;
  y[8] += CONSTANT(0.063718718433900007) * t;
  y[20] += CONSTANT(0.044869370061299998) * t;
  y[22] += CONSTANT(-0.090297865408399999) * t;

  // [5,26]: 15,33,35,
  tf =
    CONSTANT(0.155288072035) * f[15] +
    CONSTANT(0.13866253405699999) * f[33] +
    CONSTANT(-0.13288236517999999) * f[35];
  tg =
    CONSTANT(0.155288072035) * g[15] +
    CONSTANT(0.13866253405699999) * g[33] +
    CONSTANT(-0.13288236517999999) * g[35];
  y[5] += tf * g[26] + tg * f[26];
  y[26] += tf * g[5] + tg * f[5];
  t = f[5] * g[26] + f[26] * g[5];
  y[15] += CONSTANT(0.155288072035) * t;
  y[33] += CONSTANT(0.13866253405699999) * t;
  y[35] += CONSTANT(-0.13288236517999999) * t;

  // [5,28]: 15,13,31,33,
  tf =
    CONSTANT(0.044827805096399997) * f[15] +
    CONSTANT(0.173617342584) * f[13] +
    CONSTANT(0.074118242118699995) * f[31] +
    CONSTANT(-0.114366930522) * f[33];
  tg =
    CONSTANT(0.044827805096399997) * g[15] +
    CONSTANT(0.173617342584) * g[13] +
    CONSTANT(0.074118242118699995) * g[31] +
    CONSTANT(-0.114366930522) * g[33];
  y[5] += tf * g[28] + tg * f[28];
  y[28] += tf * g[5] + tg * f[5];
  t = f[5] * g[28] + f[28] * g[5];
  y[15] += CONSTANT(0.044827805096399997) * t;
  y[13] += CONSTANT(0.173617342584) * t;
  y[31] += CONSTANT(0.074118242118699995) * t;
  y[33] += CONSTANT(-0.114366930522) * t;

  // [5,29]: 12,30,32,
  tf =
    CONSTANT(0.21431790057899999) * f[12] +
    CONSTANT(0.036165998945399999) * f[30] +
    CONSTANT(-0.074118242119099995) * f[32];
  tg =
    CONSTANT(0.21431790057899999) * g[12] +
    CONSTANT(0.036165998945399999) * g[30] +
    CONSTANT(-0.074118242119099995) * g[32];
  y[5] += tf * g[29] + tg * f[29];
  y[29] += tf * g[5] + tg * f[5];
  t = f[5] * g[29] + f[29] * g[5];
  y[12] += CONSTANT(0.21431790057899999) * t;
  y[30] += CONSTANT(0.036165998945399999) * t;
  y[32] += CONSTANT(-0.074118242119099995) * t;

  // [5,32]: 9,27,
  tf = CONSTANT(-0.044827805096799997) * f[9] + CONSTANT(0.114366930522) * f[27];
  tg = CONSTANT(-0.044827805096799997) * g[9] + CONSTANT(0.114366930522) * g[27];
  y[5] += tf * g[32] + tg * f[32];
  y[32] += tf * g[5] + tg * f[5];
  t = f[5] * g[32] + f[32] * g[5];
  y[9] += CONSTANT(-0.044827805096799997) * t;
  y[27] += CONSTANT(0.114366930522) * t;

  // [5,34]: 9,27,25,
  tf =
    CONSTANT(-0.15528807203600001) * f[9] +
    CONSTANT(-0.138662534059) * f[27] +
    CONSTANT(0.13288236517900001) * f[25];
  tg =
    CONSTANT(-0.15528807203600001) * g[9] +
    CONSTANT(-0.138662534059) * g[27] +
    CONSTANT(0.13288236517900001) * g[25];
  y[5] += tf * g[34] + tg * f[34];
  y[34] += tf * g[5] + tg * f[5];
  t = f[5] * g[34] + f[34] * g[5];
  y[9] += CONSTANT(-0.15528807203600001) * t;
  y[27] += CONSTANT(-0.138662534059) * t;
  y[25] += CONSTANT(0.13288236517900001) * t;

  // [6,6]: 0,6,20,
  tf = CONSTANT(0.28209479756) * f[0] + CONSTANT(0.24179555318599999) * f[20];
  tg = CONSTANT(0.28209479756) * g[0] + CONSTANT(0.24179555318599999) * g[20];
  y[6] += tf * g[6] + tg * f[6];
  t = f[6] * g[6];
  y[0] += CONSTANT(0.28209479756) * t;
  y[6] += CONSTANT(0.18022376452700001) * t;
  y[20] += CONSTANT(0.24179555318599999) * t;

  // [7,7]: 6,0,8,20,22,
  tf =
    CONSTANT(0.090111875786499998) * f[6] +
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.15607834722799999) * f[8] +
    CONSTANT(-0.16119702387099999) * f[20] +
    CONSTANT(0.180223751574) * f[22];
  tg =
    CONSTANT(0.090111875786499998) * g[6] +
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.15607834722799999) * g[8] +
    CONSTANT(-0.16119702387099999) * g[20] +
    CONSTANT(0.180223751574) * g[22];
  y[7] += tf * g[7] + tg * f[7];
  t = f[7] * g[7];
  y[6] += CONSTANT(0.090111875786499998) * t;
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[8] += CONSTANT(0.15607834722799999) * t;
  y[20] += CONSTANT(-0.16119702387099999) * t;
  y[22] += CONSTANT(0.180223751574) * t;

  // [7,10]: 9,1,11,27,29,
  tf =
    CONSTANT(0.14867700967899999) * f[9] +
    CONSTANT(0.18467439091999999) * f[1] +
    CONSTANT(0.11516471649) * f[11] +
    CONSTANT(0.17931122038399999) * f[27] +
    CONSTANT(-0.083004965974099995) * f[29];
  tg =
    CONSTANT(0.14867700967899999) * g[9] +
    CONSTANT(0.18467439091999999) * g[1] +
    CONSTANT(0.11516471649) * g[11] +
    CONSTANT(0.17931122038399999) * g[27] +
    CONSTANT(-0.083004965974099995) * g[29];
  y[7] += tf * g[10] + tg * f[10];
  y[10] += tf * g[7] + tg * f[7];
  t = f[7] * g[10] + f[10] * g[7];
  y[9] += CONSTANT(0.14867700967899999) * t;
  y[1] += CONSTANT(0.18467439091999999) * t;
  y[11] += CONSTANT(0.11516471649) * t;
  y[27] += CONSTANT(0.17931122038399999) * t;
  y[29] += CONSTANT(-0.083004965974099995) * t;

  // [7,13]: 12,2,14,30,32,
  tf =
    CONSTANT(0.059470803871800003) * f[12] +
    CONSTANT(0.23359668032700001) * f[2] +
    CONSTANT(0.115164716491) * f[14] +
    CONSTANT(-0.16943317729400001) * f[30] +
    CONSTANT(0.173617342585) * f[32];
  tg =
    CONSTANT(0.059470803871800003) * g[12] +
    CONSTANT(0.23359668032700001) * g[2] +
    CONSTANT(0.115164716491) * g[14] +
    CONSTANT(-0.16943317729400001) * g[30] +
    CONSTANT(0.173617342585) * g[32];
  y[7] += tf * g[13] + tg * f[13];
  y[13] += tf * g[7] + tg * f[7];
  t = f[7] * g[13] + f[13] * g[7];
  y[12] += CONSTANT(0.059470803871800003) * t;
  y[2] += CONSTANT(0.23359668032700001) * t;
  y[14] += CONSTANT(0.115164716491) * t;
  y[30] += CONSTANT(-0.16943317729400001) * t;
  y[32] += CONSTANT(0.173617342585) * t;

  // [7,14]: 3,15,31,33,
  tf =
    CONSTANT(0.184674390923) * f[3] +
    CONSTANT(0.14867700967799999) * f[15] +
    CONSTANT(-0.083004965973399999) * f[31] +
    CONSTANT(0.17931122038200001) * f[33];
  tg =
    CONSTANT(0.184674390923) * g[3] +
    CONSTANT(0.14867700967799999) * g[15] +
    CONSTANT(-0.083004965973399999) * g[31] +
    CONSTANT(0.17931122038200001) * g[33];
  y[7] += tf * g[14] + tg * f[14];
  y[14] += tf * g[7] + tg * f[7];
  t = f[7] * g[14] + f[14] * g[7];
  y[3] += CONSTANT(0.184674390923) * t;
  y[15] += CONSTANT(0.14867700967799999) * t;
  y[31] += CONSTANT(-0.083004965973399999) * t;
  y[33] += CONSTANT(0.17931122038200001) * t;

  // [7,17]: 16,4,18,
  tf =
    CONSTANT(0.14046334618799999) * f[16] +
    CONSTANT(0.168583882835) * f[4] +
    CONSTANT(0.13272538654900001) * f[18];
  tg =
    CONSTANT(0.14046334618799999) * g[16] +
    CONSTANT(0.168583882835) * g[4] +
    CONSTANT(0.13272538654900001) * g[18];
  y[7] += tf * g[17] + tg * f[17];
  y[17] += tf * g[7] + tg * f[7];
  t = f[7] * g[17] + f[17] * g[7];
  y[16] += CONSTANT(0.14046334618799999) * t;
  y[4] += CONSTANT(0.168583882835) * t;
  y[18] += CONSTANT(0.13272538654900001) * t;

  // [7,21]: 8,20,6,22,
  tf =
    CONSTANT(-0.063718718433900007) * f[8] +
    CONSTANT(0.044869370061299998) * f[20] +
    CONSTANT(0.22072811544099999) * f[6] +
    CONSTANT(0.090297865408399999) * f[22];
  tg =
    CONSTANT(-0.063718718433900007) * g[8] +
    CONSTANT(0.044869370061299998) * g[20] +
    CONSTANT(0.22072811544099999) * g[6] +
    CONSTANT(0.090297865408399999) * g[22];
  y[7] += tf * g[21] + tg * f[21];
  y[21] += tf * g[7] + tg * f[7];
  t = f[7] * g[21] + f[21] * g[7];
  y[8] += CONSTANT(-0.063718718433900007) * t;
  y[20] += CONSTANT(0.044869370061299998) * t;
  y[6] += CONSTANT(0.22072811544099999) * t;
  y[22] += CONSTANT(0.090297865408399999) * t;

  // [7,23]: 8,22,24,
  tf =
    CONSTANT(0.16858388283299999) * f[8] +
    CONSTANT(0.13272538654800001) * f[22] +
    CONSTANT(0.140463346189) * f[24];
  tg =
    CONSTANT(0.16858388283299999) * g[8] +
    CONSTANT(0.13272538654800001) * g[22] +
    CONSTANT(0.140463346189) * g[24];
  y[7] += tf * g[23] + tg * f[23];
  y[23] += tf * g[7] + tg * f[7];
  t = f[7] * g[23] + f[23] * g[7];
  y[8] += CONSTANT(0.16858388283299999) * t;
  y[22] += CONSTANT(0.13272538654800001) * t;
  y[24] += CONSTANT(0.140463346189) * t;

  // [7,26]: 9,25,27,
  tf =
    CONSTANT(0.155288072035) * f[9] +
    CONSTANT(0.13288236517999999) * f[25] +
    CONSTANT(0.13866253405699999) * f[27];
  tg =
    CONSTANT(0.155288072035) * g[9] +
    CONSTANT(0.13288236517999999) * g[25] +
    CONSTANT(0.13866253405699999) * g[27];
  y[7] += tf * g[26] + tg * f[26];
  y[26] += tf * g[7] + tg * f[7];
  t = f[7] * g[26] + f[26] * g[7];
  y[9] += CONSTANT(0.155288072035) * t;
  y[25] += CONSTANT(0.13288236517999999) * t;
  y[27] += CONSTANT(0.13866253405699999) * t;

  // [7,28]: 27,11,9,29,
  tf =
    CONSTANT(0.114366930522) * f[27] +
    CONSTANT(0.173617342584) * f[11] +
    CONSTANT(-0.044827805096399997) * f[9] +
    CONSTANT(0.074118242118699995) * f[29];
  tg =
    CONSTANT(0.114366930522) * g[27] +
    CONSTANT(0.173617342584) * g[11] +
    CONSTANT(-0.044827805096399997) * g[9] +
    CONSTANT(0.074118242118699995) * g[29];
  y[7] += tf * g[28] + tg * f[28];
  y[28] += tf * g[7] + tg * f[7];
  t = f[7] * g[28] + f[28] * g[7];
  y[27] += CONSTANT(0.114366930522) * t;
  y[11] += CONSTANT(0.173617342584) * t;
  y[9] += CONSTANT(-0.044827805096399997) * t;
  y[29] += CONSTANT(0.074118242118699995) * t;

  // [7,31]: 30,12,32,
  tf =
    CONSTANT(0.036165998945399999) * f[30] +
    CONSTANT(0.21431790057899999) * f[12] +
    CONSTANT(0.074118242119099995) * f[32];
  tg =
    CONSTANT(0.036165998945399999) * g[30] +
    CONSTANT(0.21431790057899999) * g[12] +
    CONSTANT(0.074118242119099995) * g[32];
  y[7] += tf * g[31] + tg * f[31];
  y[31] += tf * g[7] + tg * f[7];
  t = f[7] * g[31] + f[31] * g[7];
  y[30] += CONSTANT(0.036165998945399999) * t;
  y[12] += CONSTANT(0.21431790057899999) * t;
  y[32] += CONSTANT(0.074118242119099995) * t;

  // [7,32]: 15,33,
  tf = CONSTANT(-0.044827805096799997) * f[15] + CONSTANT(0.114366930522) * f[33];
  tg = CONSTANT(-0.044827805096799997) * g[15] + CONSTANT(0.114366930522) * g[33];
  y[7] += tf * g[32] + tg * f[32];
  y[32] += tf * g[7] + tg * f[7];
  t = f[7] * g[32] + f[32] * g[7];
  y[15] += CONSTANT(-0.044827805096799997) * t;
  y[33] += CONSTANT(0.114366930522) * t;

  // [7,34]: 15,33,35,
  tf =
    CONSTANT(0.15528807203600001) * f[15] +
    CONSTANT(0.138662534059) * f[33] +
    CONSTANT(0.13288236517900001) * f[35];
  tg =
    CONSTANT(0.15528807203600001) * g[15] +
    CONSTANT(0.138662534059) * g[33] +
    CONSTANT(0.13288236517900001) * g[35];
  y[7] += tf * g[34] + tg * f[34];
  y[34] += tf * g[7] + tg * f[7];
  t = f[7] * g[34] + f[34] * g[7];
  y[15] += CONSTANT(0.15528807203600001) * t;
  y[33] += CONSTANT(0.138662534059) * t;
  y[35] += CONSTANT(0.13288236517900001) * t;

  // [8,8]: 0,6,20,24,
  tf =
    CONSTANT(0.28209479177000002) * f[0] +
    CONSTANT(-0.18022375157600001) * f[6] +
    CONSTANT(0.040299255967500003) * f[20] +
    CONSTANT(0.23841361350599999) * f[24];
  tg =
    CONSTANT(0.28209479177000002) * g[0] +
    CONSTANT(-0.18022375157600001) * g[6] +
    CONSTANT(0.040299255967500003) * g[20] +
    CONSTANT(0.23841361350599999) * g[24];
  y[8] += tf * g[8] + tg * f[8];
  t = f[8] * g[8];
  y[0] += CONSTANT(0.28209479177000002) * t;
  y[6] += CONSTANT(-0.18022375157600001) * t;
  y[20] += CONSTANT(0.040299255967500003) * t;
  y[24] += CONSTANT(0.23841361350599999) * t;

  // [8,9]: 1,11,25,29,
  tf =
    CONSTANT(0.226179013155) * f[1] +
    CONSTANT(-0.094031597259499999) * f[11] +
    CONSTANT(0.245532000541) * f[25] +
    CONSTANT(0.016943317729199998) * f[29];
  tg =
    CONSTANT(0.226179013155) * g[1] +
    CONSTANT(-0.094031597259499999) * g[11] +
    CONSTANT(0.245532000541) * g[25] +
    CONSTANT(0.016943317729199998) * g[29];
  y[8] += tf * g[9] + tg * f[9];
  y[9] += tf * g[8] + tg * f[8];
  t = f[8] * g[9] + f[9] * g[8];
  y[1] += CONSTANT(0.226179013155) * t;
  y[11] += CONSTANT(-0.094031597259499999) * t;
  y[25] += CONSTANT(0.245532000541) * t;
  y[29] += CONSTANT(0.016943317729199998) * t;

  // [8,14]: 2,12,30,34,
  tf =
    CONSTANT(0.18467439091999999) * f[2] +
    CONSTANT(-0.18806319451799999) * f[12] +
    CONSTANT(0.0535794751444) * f[30] +
    CONSTANT(0.19018826981600001) * f[34];
  tg =
    CONSTANT(0.18467439091999999) * g[2] +
    CONSTANT(-0.18806319451799999) * g[12] +
    CONSTANT(0.0535794751444) * g[30] +
    CONSTANT(0.19018826981600001) * g[34];
  y[8] += tf * g[14] + tg * f[14];
  y[14] += tf * g[8] + tg * f[8];
  t = f[8] * g[14] + f[14] * g[8];
  y[2] += CONSTANT(0.18467439091999999) * t;
  y[12] += CONSTANT(-0.18806319451799999) * t;
  y[30] += CONSTANT(0.0535794751444) * t;
  y[34] += CONSTANT(0.19018826981600001) * t;

  // [8,15]: 13,3,31,35,
  tf =
    CONSTANT(-0.094031597259499999) * f[13] +
    CONSTANT(0.226179013155) * f[3] +
    CONSTANT(0.016943317729199998) * f[31] +
    CONSTANT(0.245532000541) * f[35];
  tg =
    CONSTANT(-0.094031597259499999) * g[13] +
    CONSTANT(0.226179013155) * g[3] +
    CONSTANT(0.016943317729199998) * g[31] +
    CONSTANT(0.245532000541) * g[35];
  y[8] += tf * g[15] + tg * f[15];
  y[15] += tf * g[8] + tg * f[8];
  t = f[8] * g[15] + f[15] * g[8];
  y[13] += CONSTANT(-0.094031597259499999) * t;
  y[3] += CONSTANT(0.226179013155) * t;
  y[31] += CONSTANT(0.016943317729199998) * t;
  y[35] += CONSTANT(0.245532000541) * t;

  // [8,22]: 6,20,24,
  tf =
    CONSTANT(0.156078347226) * f[6] +
    CONSTANT(-0.19036461502900001) * f[20] +
    CONSTANT(-0.075080816691500005) * f[24];
  tg =
    CONSTANT(0.156078347226) * g[6] +
    CONSTANT(-0.19036461502900001) * g[20] +
    CONSTANT(-0.075080816691500005) * g[24];
  y[8] += tf * g[22] + tg * f[22];
  y[22] += tf * g[8] + tg * f[8];
  t = f[8] * g[22] + f[22] * g[8];
  y[6] += CONSTANT(0.156078347226) * t;
  y[20] += CONSTANT(-0.19036461502900001) * t;
  y[24] += CONSTANT(-0.075080816691500005) * t;

  // [8,26]: 10,28,
  tf = CONSTANT(0.19018826980699999) * f[10] + CONSTANT(-0.097043558542400002) * f[28];
  tg = CONSTANT(0.19018826980699999) * g[10] + CONSTANT(-0.097043558542400002) * g[28];
  y[8] += tf * g[26] + tg * f[26];
  y[26] += tf * g[8] + tg * f[8];
  t = f[8] * g[26] + f[26] * g[8];
  y[10] += CONSTANT(0.19018826980699999) * t;
  y[28] += CONSTANT(-0.097043558542400002) * t;

  // [8,27]: 25,11,29,
  tf =
    CONSTANT(-0.0626413476808) * f[25] +
    CONSTANT(0.141757966609) * f[11] +
    CONSTANT(-0.12103458255000001) * f[29];
  tg =
    CONSTANT(-0.0626413476808) * g[25] +
    CONSTANT(0.141757966609) * g[11] +
    CONSTANT(-0.12103458255000001) * g[29];
  y[8] += tf * g[27] + tg * f[27];
  y[27] += tf * g[8] + tg * f[8];
  t = f[8] * g[27] + f[27] * g[8];
  y[25] += CONSTANT(-0.0626413476808) * t;
  y[11] += CONSTANT(0.141757966609) * t;
  y[29] += CONSTANT(-0.12103458255000001) * t;

  // [8,32]: 30,12,34,
  tf =
    CONSTANT(-0.191372478254) * f[30] +
    CONSTANT(0.141757966609) * f[12] +
    CONSTANT(-0.097043558538899996) * f[34];
  tg =
    CONSTANT(-0.191372478254) * g[30] +
    CONSTANT(0.141757966609) * g[12] +
    CONSTANT(-0.097043558538899996) * g[34];
  y[8] += tf * g[32] + tg * f[32];
  y[32] += tf * g[8] + tg * f[8];
  t = f[8] * g[32] + f[32] * g[8];
  y[30] += CONSTANT(-0.191372478254) * t;
  y[12] += CONSTANT(0.141757966609) * t;
  y[34] += CONSTANT(-0.097043558538899996) * t;

  // [8,33]: 13,31,35,
  tf =
    CONSTANT(0.141757966609) * f[13] +
    CONSTANT(-0.12103458255000001) * f[31] +
    CONSTANT(-0.0626413476808) * f[35];
  tg =
    CONSTANT(0.141757966609) * g[13] +
    CONSTANT(-0.12103458255000001) * g[31] +
    CONSTANT(-0.0626413476808) * g[35];
  y[8] += tf * g[33] + tg * f[33];
  y[33] += tf * g[8] + tg * f[8];
  t = f[8] * g[33] + f[33] * g[8];
  y[13] += CONSTANT(0.141757966609) * t;
  y[31] += CONSTANT(-0.12103458255000001) * t;
  y[35] += CONSTANT(-0.0626413476808) * t;

  // [9,9]: 6,0,20,
  tf =
    CONSTANT(-0.21026104350800001) * f[6] +
    CONSTANT(0.28209479176699997) * f[0] +
    CONSTANT(0.076934943209800002) * f[20];
  tg =
    CONSTANT(-0.21026104350800001) * g[6] +
    CONSTANT(0.28209479176699997) * g[0] +
    CONSTANT(0.076934943209800002) * g[20];
  y[9] += tf * g[9] + tg * f[9];
  t = f[9] * g[9];
  y[6] += CONSTANT(-0.21026104350800001) * t;
  y[0] += CONSTANT(0.28209479176699997) * t;
  y[20] += CONSTANT(0.076934943209800002) * t;

  // [9,17]: 2,12,30,
  tf =
    CONSTANT(0.16286750396499999) * f[2] +
    CONSTANT(-0.20355072687299999) * f[12] +
    CONSTANT(0.098140130728100003) * f[30];
  tg =
    CONSTANT(0.16286750396499999) * g[2] +
    CONSTANT(-0.20355072687299999) * g[12] +
    CONSTANT(0.098140130728100003) * g[30];
  y[9] += tf * g[17] + tg * f[17];
  y[17] += tf * g[9] + tg * f[9];
  t = f[9] * g[17] + f[17] * g[9];
  y[2] += CONSTANT(0.16286750396499999) * t;
  y[12] += CONSTANT(-0.20355072687299999) * t;
  y[30] += CONSTANT(0.098140130728100003) * t;

  // [9,18]: 3,13,31,35,
  tf =
    CONSTANT(-0.043528171377799997) * f[3] +
    CONSTANT(0.13325523051900001) * f[13] +
    CONSTANT(-0.10158468631000001) * f[31] +
    CONSTANT(0.098140130731999994) * f[35];
  tg =
    CONSTANT(-0.043528171377799997) * g[3] +
    CONSTANT(0.13325523051900001) * g[13] +
    CONSTANT(-0.10158468631000001) * g[31] +
    CONSTANT(0.098140130731999994) * g[35];
  y[9] += tf * g[18] + tg * f[18];
  y[18] += tf * g[9] + tg * f[9];
  t = f[9] * g[18] + f[18] * g[9];
  y[3] += CONSTANT(-0.043528171377799997) * t;
  y[13] += CONSTANT(0.13325523051900001) * t;
  y[31] += CONSTANT(-0.10158468631000001) * t;
  y[35] += CONSTANT(0.098140130731999994) * t;

  // [9,19]: 14,32,34,
  tf =
    CONSTANT(-0.099322584600699995) * f[14] +
    CONSTANT(0.12669836397000001) * f[32] +
    CONSTANT(0.13166880218099999) * f[34];
  tg =
    CONSTANT(-0.099322584600699995) * g[14] +
    CONSTANT(0.12669836397000001) * g[32] +
    CONSTANT(0.13166880218099999) * g[34];
  y[9] += tf * g[19] + tg * f[19];
  y[19] += tf * g[9] + tg * f[9];
  t = f[9] * g[19] + f[19] * g[9];
  y[14] += CONSTANT(-0.099322584600699995) * t;
  y[32] += CONSTANT(0.12669836397000001) * t;
  y[34] += CONSTANT(0.13166880218099999) * t;

  // [9,22]: 1,11,25,29,
  tf =
    CONSTANT(-0.043528171378199997) * f[1] +
    CONSTANT(0.13325523051800001) * f[11] +
    CONSTANT(-0.098140130732499997) * f[25] +
    CONSTANT(-0.101584686311) * f[29];
  tg =
    CONSTANT(-0.043528171378199997) * g[1] +
    CONSTANT(0.13325523051800001) * g[11] +
    CONSTANT(-0.098140130732499997) * g[25] +
    CONSTANT(-0.101584686311) * g[29];
  y[9] += tf * g[22] + tg * f[22];
  y[22] += tf * g[9] + tg * f[9];
  t = f[9] * g[22] + f[22] * g[9];
  y[1] += CONSTANT(-0.043528171378199997) * t;
  y[11] += CONSTANT(0.13325523051800001) * t;
  y[25] += CONSTANT(-0.098140130732499997) * t;
  y[29] += CONSTANT(-0.101584686311) * t;

  // [9,27]: 6,20,
  tf = CONSTANT(0.12679217987499999) * f[6] + CONSTANT(-0.19628026146499999) * f[20];
  tg = CONSTANT(0.12679217987499999) * g[6] + CONSTANT(-0.19628026146499999) * g[20];
  y[9] += tf * g[27] + tg * f[27];
  y[27] += tf * g[9] + tg * f[9];
  t = f[9] * g[27] + f[27] * g[9];
  y[6] += CONSTANT(0.12679217987499999) * t;
  y[20] += CONSTANT(-0.19628026146499999) * t;

  // [10,10]: 0,20,24,
  tf =
    CONSTANT(0.28209479177199998) * f[0] +
    CONSTANT(-0.179514867494) * f[20] +
    CONSTANT(-0.15171775404900001) * f[24];
  tg =
    CONSTANT(0.28209479177199998) * g[0] +
    CONSTANT(-0.179514867494) * g[20] +
    CONSTANT(-0.15171775404900001) * g[24];
  y[10] += tf * g[10] + tg * f[10];
  t = f[10] * g[10];
  y[0] += CONSTANT(0.28209479177199998) * t;
  y[20] += CONSTANT(-0.179514867494) * t;
  y[24] += CONSTANT(-0.15171775404900001) * t;

  // [10,16]: 14,32,
  tf = CONSTANT(0.15171775404499999) * f[14] + CONSTANT(-0.077413979111300005) * f[32];
  tg = CONSTANT(0.15171775404499999) * g[14] + CONSTANT(-0.077413979111300005) * g[32];
  y[10] += tf * g[16] + tg * f[16];
  y[16] += tf * g[10] + tg * f[10];
  t = f[10] * g[16] + f[16] * g[10];
  y[14] += CONSTANT(0.15171775404499999) * t;
  y[32] += CONSTANT(-0.077413979111300005) * t;

  // [10,17]: 13,3,31,35,
  tf =
    CONSTANT(0.067850242288900006) * f[13] +
    CONSTANT(0.19947114020000001) * f[3] +
    CONSTANT(-0.113793659091) * f[31] +
    CONSTANT(-0.14991152592599999) * f[35];
  tg =
    CONSTANT(0.067850242288900006) * g[13] +
    CONSTANT(0.19947114020000001) * g[3] +
    CONSTANT(-0.113793659091) * g[31] +
    CONSTANT(-0.14991152592599999) * g[35];
  y[10] += tf * g[17] + tg * f[17];
  y[17] += tf * g[10] + tg * f[10];
  t = f[10] * g[17] + f[17] * g[10];
  y[13] += CONSTANT(0.067850242288900006) * t;
  y[3] += CONSTANT(0.19947114020000001) * t;
  y[31] += CONSTANT(-0.113793659091) * t;
  y[35] += CONSTANT(-0.14991152592599999) * t;

  // [10,18]: 12,2,30,34,
  tf =
    CONSTANT(-0.044418410173299998) * f[12] +
    CONSTANT(0.213243618621) * f[2] +
    CONSTANT(-0.171327458205) * f[30] +
    CONSTANT(-0.101358691177) * f[34];
  tg =
    CONSTANT(-0.044418410173299998) * g[12] +
    CONSTANT(0.213243618621) * g[2] +
    CONSTANT(-0.171327458205) * g[30] +
    CONSTANT(-0.101358691177) * g[34];
  y[10] += tf * g[18] + tg * f[18];
  y[18] += tf * g[10] + tg * f[10];
  t = f[10] * g[18] + f[18] * g[10];
  y[12] += CONSTANT(-0.044418410173299998) * t;
  y[2] += CONSTANT(0.213243618621) * t;
  y[30] += CONSTANT(-0.171327458205) * t;
  y[34] += CONSTANT(-0.101358691177) * t;

  // [10,19]: 3,15,13,31,33,
  tf =
    CONSTANT(-0.075393004386799994) * f[3] +
    CONSTANT(0.0993225845996) * f[15] +
    CONSTANT(0.102579924281) * f[13] +
    CONSTANT(0.097749909976500002) * f[31] +
    CONSTANT(-0.025339672794100002) * f[33];
  tg =
    CONSTANT(-0.075393004386799994) * g[3] +
    CONSTANT(0.0993225845996) * g[15] +
    CONSTANT(0.102579924281) * g[13] +
    CONSTANT(0.097749909976500002) * g[31] +
    CONSTANT(-0.025339672794100002) * g[33];
  y[10] += tf * g[19] + tg * f[19];
  y[19] += tf * g[10] + tg * f[10];
  t = f[10] * g[19] + f[19] * g[10];
  y[3] += CONSTANT(-0.075393004386799994) * t;
  y[15] += CONSTANT(0.0993225845996) * t;
  y[13] += CONSTANT(0.102579924281) * t;
  y[31] += CONSTANT(0.097749909976500002) * t;
  y[33] += CONSTANT(-0.025339672794100002) * t;

  // [10,21]: 11,1,9,27,29,
  tf =
    CONSTANT(0.102579924281) * f[11] +
    CONSTANT(-0.075393004386799994) * f[1] +
    CONSTANT(-0.0993225845996) * f[9] +
    CONSTANT(0.025339672794100002) * f[27] +
    CONSTANT(0.097749909976500002) * f[29];
  tg =
    CONSTANT(0.102579924281) * g[11] +
    CONSTANT(-0.075393004386799994) * g[1] +
    CONSTANT(-0.0993225845996) * g[9] +
    CONSTANT(0.025339672794100002) * g[27] +
    CONSTANT(0.097749909976500002) * g[29];
  y[10] += tf * g[21] + tg * f[21];
  y[21] += tf * g[10] + tg * f[10];
  t = f[10] * g[21] + f[21] * g[10];
  y[11] += CONSTANT(0.102579924281) * t;
  y[1] += CONSTANT(-0.075393004386799994) * t;
  y[9] += CONSTANT(-0.0993225845996) * t;
  y[27] += CONSTANT(0.025339672794100002) * t;
  y[29] += CONSTANT(0.097749909976500002) * t;

  // [10,23]: 11,1,25,29,
  tf =
    CONSTANT(-0.067850242288900006) * f[11] +
    CONSTANT(-0.19947114020000001) * f[1] +
    CONSTANT(0.14991152592599999) * f[25] +
    CONSTANT(0.113793659091) * f[29];
  tg =
    CONSTANT(-0.067850242288900006) * g[11] +
    CONSTANT(-0.19947114020000001) * g[1] +
    CONSTANT(0.14991152592599999) * g[25] +
    CONSTANT(0.113793659091) * g[29];
  y[10] += tf * g[23] + tg * f[23];
  y[23] += tf * g[10] + tg * f[10];
  t = f[10] * g[23] + f[23] * g[10];
  y[11] += CONSTANT(-0.067850242288900006) * t;
  y[1] += CONSTANT(-0.19947114020000001) * t;
  y[25] += CONSTANT(0.14991152592599999) * t;
  y[29] += CONSTANT(0.113793659091) * t;

  // [10,28]: 6,20,24,
  tf =
    CONSTANT(0.190188269814) * f[6] +
    CONSTANT(-0.065426753820500005) * f[20] +
    CONSTANT(0.077413979109600004) * f[24];
  tg =
    CONSTANT(0.190188269814) * g[6] +
    CONSTANT(-0.065426753820500005) * g[20] +
    CONSTANT(0.077413979109600004) * g[24];
  y[10] += tf * g[28] + tg * f[28];
  y[28] += tf * g[10] + tg * f[10];
  t = f[10] * g[28] + f[28] * g[10];
  y[6] += CONSTANT(0.190188269814) * t;
  y[20] += CONSTANT(-0.065426753820500005) * t;
  y[24] += CONSTANT(0.077413979109600004) * t;

  // [11,11]: 0,6,8,20,22,
  tf =
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.12615662610100001) * f[6] +
    CONSTANT(-0.14567312407899999) * f[8] +
    CONSTANT(0.025644981070299999) * f[20] +
    CONSTANT(-0.11468784191) * f[22];
  tg =
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.12615662610100001) * g[6] +
    CONSTANT(-0.14567312407899999) * g[8] +
    CONSTANT(0.025644981070299999) * g[20] +
    CONSTANT(-0.11468784191) * g[22];
  y[11] += tf * g[11] + tg * f[11];
  t = f[11] * g[11];
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[6] += CONSTANT(0.12615662610100001) * t;
  y[8] += CONSTANT(-0.14567312407899999) * t;
  y[20] += CONSTANT(0.025644981070299999) * t;
  y[22] += CONSTANT(-0.11468784191) * t;

  // [11,16]: 15,33,35,
  tf =
    CONSTANT(-0.117520066953) * f[15] +
    CONSTANT(0.11992922073999999) * f[33] +
    CONSTANT(0.13408494503599999) * f[35];
  tg =
    CONSTANT(-0.117520066953) * g[15] +
    CONSTANT(0.11992922073999999) * g[33] +
    CONSTANT(0.13408494503599999) * g[35];
  y[11] += tf * g[16] + tg * f[16];
  y[16] += tf * g[11] + tg * f[11];
  t = f[11] * g[16] + f[16] * g[11];
  y[15] += CONSTANT(-0.117520066953) * t;
  y[33] += CONSTANT(0.11992922073999999) * t;
  y[35] += CONSTANT(0.13408494503599999) * t;

  // [11,18]: 3,13,15,31,33,
  tf =
    CONSTANT(0.168583882834) * f[3] +
    CONSTANT(0.114687841909) * f[13] +
    CONSTANT(-0.13325523051900001) * f[15] +
    CONSTANT(0.075189952564900006) * f[31] +
    CONSTANT(-0.101990215611) * f[33];
  tg =
    CONSTANT(0.168583882834) * g[3] +
    CONSTANT(0.114687841909) * g[13] +
    CONSTANT(-0.13325523051900001) * g[15] +
    CONSTANT(0.075189952564900006) * g[31] +
    CONSTANT(-0.101990215611) * g[33];
  y[11] += tf * g[18] + tg * f[18];
  y[18] += tf * g[11] + tg * f[11];
  t = f[11] * g[18] + f[18] * g[11];
  y[3] += CONSTANT(0.168583882834) * t;
  y[13] += CONSTANT(0.114687841909) * t;
  y[15] += CONSTANT(-0.13325523051900001) * t;
  y[31] += CONSTANT(0.075189952564900006) * t;
  y[33] += CONSTANT(-0.101990215611) * t;

  // [11,19]: 2,14,12,30,32,
  tf =
    CONSTANT(0.238413613504) * f[2] +
    CONSTANT(-0.102579924282) * f[14] +
    CONSTANT(0.099322584599300004) * f[12] +
    CONSTANT(0.009577496073830001) * f[30] +
    CONSTANT(-0.104682806112) * f[32];
  tg =
    CONSTANT(0.238413613504) * g[2] +
    CONSTANT(-0.102579924282) * g[14] +
    CONSTANT(0.099322584599300004) * g[12] +
    CONSTANT(0.009577496073830001) * g[30] +
    CONSTANT(-0.104682806112) * g[32];
  y[11] += tf * g[19] + tg * f[19];
  y[19] += tf * g[11] + tg * f[11];
  t = f[11] * g[19] + f[19] * g[11];
  y[2] += CONSTANT(0.238413613504) * t;
  y[14] += CONSTANT(-0.102579924282) * t;
  y[12] += CONSTANT(0.099322584599300004) * t;
  y[30] += CONSTANT(0.009577496073830001) * t;
  y[32] += CONSTANT(-0.104682806112) * t;

  // [11,24]: 9,25,27,
  tf =
    CONSTANT(0.11752006695099999) * f[9] +
    CONSTANT(-0.134084945037) * f[25] +
    CONSTANT(-0.11992922074200001) * f[27];
  tg =
    CONSTANT(0.11752006695099999) * g[9] +
    CONSTANT(-0.134084945037) * g[25] +
    CONSTANT(-0.11992922074200001) * g[27];
  y[11] += tf * g[24] + tg * f[24];
  y[24] += tf * g[11] + tg * f[11];
  t = f[11] * g[24] + f[24] * g[11];
  y[9] += CONSTANT(0.11752006695099999) * t;
  y[25] += CONSTANT(-0.134084945037) * t;
  y[27] += CONSTANT(-0.11992922074200001) * t;

  // [11,29]: 6,20,22,8,
  tf =
    CONSTANT(0.22731846124300001) * f[6] +
    CONSTANT(0.086019920779800002) * f[20] +
    CONSTANT(-0.075189952565200002) * f[22] +
    CONSTANT(0.065621187395299999) * f[8];
  tg =
    CONSTANT(0.22731846124300001) * g[6] +
    CONSTANT(0.086019920779800002) * g[20] +
    CONSTANT(-0.075189952565200002) * g[22] +
    CONSTANT(0.065621187395299999) * g[8];
  y[11] += tf * g[29] + tg * f[29];
  y[29] += tf * g[11] + tg * f[11];
  t = f[11] * g[29] + f[29] * g[11];
  y[6] += CONSTANT(0.22731846124300001) * t;
  y[20] += CONSTANT(0.086019920779800002) * t;
  y[22] += CONSTANT(-0.075189952565200002) * t;
  y[8] += CONSTANT(0.065621187395299999) * t;

  // [12,12]: 0,6,20,
  tf =
    CONSTANT(0.28209479987199998) * f[0] +
    CONSTANT(0.16820885295400001) * f[6] +
    CONSTANT(0.15386991078600001) * f[20];
  tg =
    CONSTANT(0.28209479987199998) * g[0] +
    CONSTANT(0.16820885295400001) * g[6] +
    CONSTANT(0.15386991078600001) * g[20];
  y[12] += tf * g[12] + tg * f[12];
  t = f[12] * g[12];
  y[0] += CONSTANT(0.28209479987199998) * t;
  y[6] += CONSTANT(0.16820885295400001) * t;
  y[20] += CONSTANT(0.15386991078600001) * t;

  // [12,30]: 20,6,
  tf = CONSTANT(0.14837396171299999) * f[20] + CONSTANT(0.239614719999) * f[6];
  tg = CONSTANT(0.14837396171299999) * g[20] + CONSTANT(0.239614719999) * g[6];
  y[12] += tf * g[30] + tg * f[30];
  y[30] += tf * g[12] + tg * f[12];
  t = f[12] * g[30] + f[30] * g[12];
  y[20] += CONSTANT(0.14837396171299999) * t;
  y[6] += CONSTANT(0.239614719999) * t;

  // [13,13]: 0,8,6,20,22,
  tf =
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.14567312407899999) * f[8] +
    CONSTANT(0.12615662610100001) * f[6] +
    CONSTANT(0.025644981070299999) * f[20] +
    CONSTANT(0.11468784191) * f[22];
  tg =
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.14567312407899999) * g[8] +
    CONSTANT(0.12615662610100001) * g[6] +
    CONSTANT(0.025644981070299999) * g[20] +
    CONSTANT(0.11468784191) * g[22];
  y[13] += tf * g[13] + tg * f[13];
  t = f[13] * g[13];
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[8] += CONSTANT(0.14567312407899999) * t;
  y[6] += CONSTANT(0.12615662610100001) * t;
  y[20] += CONSTANT(0.025644981070299999) * t;
  y[22] += CONSTANT(0.11468784191) * t;

  // [13,16]: 9,25,27,
  tf =
    CONSTANT(-0.117520066953) * f[9] +
    CONSTANT(-0.13408494503599999) * f[25] +
    CONSTANT(0.11992922073999999) * f[27];
  tg =
    CONSTANT(-0.117520066953) * g[9] +
    CONSTANT(-0.13408494503599999) * g[25] +
    CONSTANT(0.11992922073999999) * g[27];
  y[13] += tf * g[16] + tg * f[16];
  y[16] += tf * g[13] + tg * f[13];
  t = f[13] * g[16] + f[16] * g[13];
  y[9] += CONSTANT(-0.117520066953) * t;
  y[25] += CONSTANT(-0.13408494503599999) * t;
  y[27] += CONSTANT(0.11992922073999999) * t;

  // [13,21]: 2,12,14,30,32,
  tf =
    CONSTANT(0.238413613504) * f[2] +
    CONSTANT(0.099322584599300004) * f[12] +
    CONSTANT(0.102579924282) * f[14] +
    CONSTANT(0.009577496073830001) * f[30] +
    CONSTANT(0.104682806112) * f[32];
  tg =
    CONSTANT(0.238413613504) * g[2] +
    CONSTANT(0.099322584599300004) * g[12] +
    CONSTANT(0.102579924282) * g[14] +
    CONSTANT(0.009577496073830001) * g[30] +
    CONSTANT(0.104682806112) * g[32];
  y[13] += tf * g[21] + tg * f[21];
  y[21] += tf * g[13] + tg * f[13];
  t = f[13] * g[21] + f[21] * g[13];
  y[2] += CONSTANT(0.238413613504) * t;
  y[12] += CONSTANT(0.099322584599300004) * t;
  y[14] += CONSTANT(0.102579924282) * t;
  y[30] += CONSTANT(0.009577496073830001) * t;
  y[32] += CONSTANT(0.104682806112) * t;

  // [13,24]: 15,33,35,
  tf =
    CONSTANT(-0.11752006695099999) * f[15] +
    CONSTANT(0.11992922074200001) * f[33] +
    CONSTANT(-0.134084945037) * f[35];
  tg =
    CONSTANT(-0.11752006695099999) * g[15] +
    CONSTANT(0.11992922074200001) * g[33] +
    CONSTANT(-0.134084945037) * g[35];
  y[13] += tf * g[24] + tg * f[24];
  y[24] += tf * g[13] + tg * f[13];
  t = f[13] * g[24] + f[24] * g[13];
  y[15] += CONSTANT(-0.11752006695099999) * t;
  y[33] += CONSTANT(0.11992922074200001) * t;
  y[35] += CONSTANT(-0.134084945037) * t;

  // [13,31]: 6,22,20,8,
  tf =
    CONSTANT(0.22731846124300001) * f[6] +
    CONSTANT(0.075189952565200002) * f[22] +
    CONSTANT(0.086019920779800002) * f[20] +
    CONSTANT(-0.065621187395299999) * f[8];
  tg =
    CONSTANT(0.22731846124300001) * g[6] +
    CONSTANT(0.075189952565200002) * g[22] +
    CONSTANT(0.086019920779800002) * g[20] +
    CONSTANT(-0.065621187395299999) * g[8];
  y[13] += tf * g[31] + tg * f[31];
  y[31] += tf * g[13] + tg * f[13];
  t = f[13] * g[31] + f[31] * g[13];
  y[6] += CONSTANT(0.22731846124300001) * t;
  y[22] += CONSTANT(0.075189952565200002) * t;
  y[20] += CONSTANT(0.086019920779800002) * t;
  y[8] += CONSTANT(-0.065621187395299999) * t;

  // [14,14]: 0,20,24,
  tf =
    CONSTANT(0.28209479177199998) * f[0] +
    CONSTANT(-0.179514867494) * f[20] +
    CONSTANT(0.15171775404900001) * f[24];
  tg =
    CONSTANT(0.28209479177199998) * g[0] +
    CONSTANT(-0.179514867494) * g[20] +
    CONSTANT(0.15171775404900001) * g[24];
  y[14] += tf * g[14] + tg * f[14];
  t = f[14] * g[14];
  y[0] += CONSTANT(0.28209479177199998) * t;
  y[20] += CONSTANT(-0.179514867494) * t;
  y[24] += CONSTANT(0.15171775404900001) * t;

  // [14,17]: 11,1,25,29,
  tf =
    CONSTANT(0.067850242288500007) * f[11] +
    CONSTANT(0.19947114019699999) * f[1] +
    CONSTANT(0.14991152592599999) * f[25] +
    CONSTANT(-0.113793659092) * f[29];
  tg =
    CONSTANT(0.067850242288500007) * g[11] +
    CONSTANT(0.19947114019699999) * g[1] +
    CONSTANT(0.14991152592599999) * g[25] +
    CONSTANT(-0.113793659092) * g[29];
  y[14] += tf * g[17] + tg * f[17];
  y[17] += tf * g[14] + tg * f[14];
  t = f[14] * g[17] + f[17] * g[14];
  y[11] += CONSTANT(0.067850242288500007) * t;
  y[1] += CONSTANT(0.19947114019699999) * t;
  y[25] += CONSTANT(0.14991152592599999) * t;
  y[29] += CONSTANT(-0.113793659092) * t;

  // [14,22]: 12,2,30,34,
  tf =
    CONSTANT(-0.044418410173299998) * f[12] +
    CONSTANT(0.213243618621) * f[2] +
    CONSTANT(-0.171327458205) * f[30] +
    CONSTANT(0.101358691177) * f[34];
  tg =
    CONSTANT(-0.044418410173299998) * g[12] +
    CONSTANT(0.213243618621) * g[2] +
    CONSTANT(-0.171327458205) * g[30] +
    CONSTANT(0.101358691177) * g[34];
  y[14] += tf * g[22] + tg * f[22];
  y[22] += tf * g[14] + tg * f[14];
  t = f[14] * g[22] + f[22] * g[14];
  y[12] += CONSTANT(-0.044418410173299998) * t;
  y[2] += CONSTANT(0.213243618621) * t;
  y[30] += CONSTANT(-0.171327458205) * t;
  y[34] += CONSTANT(0.101358691177) * t;

  // [14,23]: 13,3,31,35,
  tf =
    CONSTANT(0.067850242288500007) * f[13] +
    CONSTANT(0.19947114019699999) * f[3] +
    CONSTANT(-0.113793659092) * f[31] +
    CONSTANT(0.14991152592599999) * f[35];
  tg =
    CONSTANT(0.067850242288500007) * g[13] +
    CONSTANT(0.19947114019699999) * g[3] +
    CONSTANT(-0.113793659092) * g[31] +
    CONSTANT(0.14991152592599999) * g[35];
  y[14] += tf * g[23] + tg * f[23];
  y[23] += tf * g[14] + tg * f[14];
  t = f[14] * g[23] + f[23] * g[14];
  y[13] += CONSTANT(0.067850242288500007) * t;
  y[3] += CONSTANT(0.19947114019699999) * t;
  y[31] += CONSTANT(-0.113793659092) * t;
  y[35] += CONSTANT(0.14991152592599999) * t;

  // [14,32]: 20,6,24,
  tf =
    CONSTANT(-0.065426753820500005) * f[20] +
    CONSTANT(0.190188269814) * f[6] +
    CONSTANT(-0.077413979109600004) * f[24];
  tg =
    CONSTANT(-0.065426753820500005) * g[20] +
    CONSTANT(0.190188269814) * g[6] +
    CONSTANT(-0.077413979109600004) * g[24];
  y[14] += tf * g[32] + tg * f[32];
  y[32] += tf * g[14] + tg * f[14];
  t = f[14] * g[32] + f[32] * g[14];
  y[20] += CONSTANT(-0.065426753820500005) * t;
  y[6] += CONSTANT(0.190188269814) * t;
  y[24] += CONSTANT(-0.077413979109600004) * t;

  // [15,15]: 0,6,20,
  tf =
    CONSTANT(0.28209479176699997) * f[0] +
    CONSTANT(-0.21026104350800001) * f[6] +
    CONSTANT(0.076934943209800002) * f[20];
  tg =
    CONSTANT(0.28209479176699997) * g[0] +
    CONSTANT(-0.21026104350800001) * g[6] +
    CONSTANT(0.076934943209800002) * g[20];
  y[15] += tf * g[15] + tg * f[15];
  t = f[15] * g[15];
  y[0] += CONSTANT(0.28209479176699997) * t;
  y[6] += CONSTANT(-0.21026104350800001) * t;
  y[20] += CONSTANT(0.076934943209800002) * t;

  // [15,21]: 14,32,34,
  tf =
    CONSTANT(-0.099322584600699995) * f[14] +
    CONSTANT(0.12669836397000001) * f[32] +
    CONSTANT(-0.13166880218099999) * f[34];
  tg =
    CONSTANT(-0.099322584600699995) * g[14] +
    CONSTANT(0.12669836397000001) * g[32] +
    CONSTANT(-0.13166880218099999) * g[34];
  y[15] += tf * g[21] + tg * f[21];
  y[21] += tf * g[15] + tg * f[15];
  t = f[15] * g[21] + f[21] * g[15];
  y[14] += CONSTANT(-0.099322584600699995) * t;
  y[32] += CONSTANT(0.12669836397000001) * t;
  y[34] += CONSTANT(-0.13166880218099999) * t;

  // [15,22]: 13,3,31,35,
  tf =
    CONSTANT(0.13325523051800001) * f[13] +
    CONSTANT(-0.043528171378199997) * f[3] +
    CONSTANT(-0.101584686311) * f[31] +
    CONSTANT(-0.098140130732499997) * f[35];
  tg =
    CONSTANT(0.13325523051800001) * g[13] +
    CONSTANT(-0.043528171378199997) * g[3] +
    CONSTANT(-0.101584686311) * g[31] +
    CONSTANT(-0.098140130732499997) * g[35];
  y[15] += tf * g[22] + tg * f[22];
  y[22] += tf * g[15] + tg * f[15];
  t = f[15] * g[22] + f[22] * g[15];
  y[13] += CONSTANT(0.13325523051800001) * t;
  y[3] += CONSTANT(-0.043528171378199997) * t;
  y[31] += CONSTANT(-0.101584686311) * t;
  y[35] += CONSTANT(-0.098140130732499997) * t;

  // [15,23]: 12,2,30,
  tf =
    CONSTANT(-0.20355072687299999) * f[12] +
    CONSTANT(0.16286750396499999) * f[2] +
    CONSTANT(0.098140130728100003) * f[30];
  tg =
    CONSTANT(-0.20355072687299999) * g[12] +
    CONSTANT(0.16286750396499999) * g[2] +
    CONSTANT(0.098140130728100003) * g[30];
  y[15] += tf * g[23] + tg * f[23];
  y[23] += tf * g[15] + tg * f[15];
  t = f[15] * g[23] + f[23] * g[15];
  y[12] += CONSTANT(-0.20355072687299999) * t;
  y[2] += CONSTANT(0.16286750396499999) * t;
  y[30] += CONSTANT(0.098140130728100003) * t;

  // [15,33]: 6,20,
  tf = CONSTANT(0.12679217987499999) * f[6] + CONSTANT(-0.19628026146499999) * f[20];
  tg = CONSTANT(0.12679217987499999) * g[6] + CONSTANT(-0.19628026146499999) * g[20];
  y[15] += tf * g[33] + tg * f[33];
  y[33] += tf * g[15] + tg * f[15];
  t = f[15] * g[33] + f[33] * g[15];
  y[6] += CONSTANT(0.12679217987499999) * t;
  y[20] += CONSTANT(-0.19628026146499999) * t;

  // [16,16]: 0,6,20,
  tf =
    CONSTANT(0.28209479176399999) * f[0] +
    CONSTANT(-0.229375683829) * f[6] +
    CONSTANT(0.106525305981) * f[20];
  tg =
    CONSTANT(0.28209479176399999) * g[0] +
    CONSTANT(-0.229375683829) * g[6] +
    CONSTANT(0.106525305981) * g[20];
  y[16] += tf * g[16] + tg * f[16];
  t = f[16] * g[16];
  y[0] += CONSTANT(0.28209479176399999) * t;
  y[6] += CONSTANT(-0.229375683829) * t;
  y[20] += CONSTANT(0.106525305981) * t;

  // [16,18]: 8,22,
  tf = CONSTANT(-0.075080816693699995) * f[8] + CONSTANT(0.13504547338) * f[22];
  tg = CONSTANT(-0.075080816693699995) * g[8] + CONSTANT(0.13504547338) * g[22];
  y[16] += tf * g[18] + tg * f[18];
  y[18] += tf * g[16] + tg * f[16];
  t = f[16] * g[18] + f[18] * g[16];
  y[8] += CONSTANT(-0.075080816693699995) * t;
  y[22] += CONSTANT(0.13504547338) * t;

  // [16,23]: 19,5,
  tf = CONSTANT(-0.11909891275499999) * f[19] + CONSTANT(0.14046334618799999) * f[5];
  tg = CONSTANT(-0.11909891275499999) * g[19] + CONSTANT(0.14046334618799999) * g[5];
  y[16] += tf * g[23] + tg * f[23];
  y[23] += tf * g[16] + tg * f[16];
  t = f[16] * g[23] + f[23] * g[16];
  y[19] += CONSTANT(-0.11909891275499999) * t;
  y[5] += CONSTANT(0.14046334618799999) * t;

  // [16,26]: 12,2,30,
  tf =
    CONSTANT(-0.207723503645) * f[12] +
    CONSTANT(0.14731920032500001) * f[2] +
    CONSTANT(0.13019759619999999) * f[30];
  tg =
    CONSTANT(-0.207723503645) * g[12] +
    CONSTANT(0.14731920032500001) * g[2] +
    CONSTANT(0.13019759619999999) * g[30];
  y[16] += tf * g[26] + tg * f[26];
  y[26] += tf * g[16] + tg * f[16];
  t = f[16] * g[26] + f[26] * g[16];
  y[12] += CONSTANT(-0.207723503645) * t;
  y[2] += CONSTANT(0.14731920032500001) * t;
  y[30] += CONSTANT(0.13019759619999999) * t;

  // [16,28]: 14,32,
  tf = CONSTANT(-0.077413979111300005) * f[14] + CONSTANT(0.12837656111500001) * f[32];
  tg = CONSTANT(-0.077413979111300005) * g[14] + CONSTANT(0.12837656111500001) * g[32];
  y[16] += tf * g[28] + tg * f[28];
  y[28] += tf * g[16] + tg * f[16];
  t = f[16] * g[28] + f[28] * g[16];
  y[14] += CONSTANT(-0.077413979111300005) * t;
  y[32] += CONSTANT(0.12837656111500001) * t;

  // [16,29]: 15,33,35,
  tf =
    CONSTANT(0.035835708931099997) * f[15] +
    CONSTANT(-0.11885360062399999) * f[33] +
    CONSTANT(-0.053152946071899999) * f[35];
  tg =
    CONSTANT(0.035835708931099997) * g[15] +
    CONSTANT(-0.11885360062399999) * g[33] +
    CONSTANT(-0.053152946071899999) * g[35];
  y[16] += tf * g[29] + tg * f[29];
  y[29] += tf * g[16] + tg * f[16];
  t = f[16] * g[29] + f[29] * g[16];
  y[15] += CONSTANT(0.035835708931099997) * t;
  y[33] += CONSTANT(-0.11885360062399999) * t;
  y[35] += CONSTANT(-0.053152946071899999) * t;

  // [16,31]: 27,9,25,
  tf =
    CONSTANT(-0.11885360062399999) * f[27] +
    CONSTANT(0.035835708931099997) * f[9] +
    CONSTANT(0.053152946071899999) * f[25];
  tg =
    CONSTANT(-0.11885360062399999) * g[27] +
    CONSTANT(0.035835708931099997) * g[9] +
    CONSTANT(0.053152946071899999) * g[25];
  y[16] += tf * g[31] + tg * f[31];
  y[31] += tf * g[16] + tg * f[16];
  t = f[16] * g[31] + f[31] * g[16];
  y[27] += CONSTANT(-0.11885360062399999) * t;
  y[9] += CONSTANT(0.035835708931099997) * t;
  y[25] += CONSTANT(0.053152946071899999) * t;

  // [17,17]: 0,6,20,
  tf =
    CONSTANT(0.28209479176899999) * f[0] +
    CONSTANT(-0.057343920955899998) * f[6] +
    CONSTANT(-0.159787958979) * f[20];
  tg =
    CONSTANT(0.28209479176899999) * g[0] +
    CONSTANT(-0.057343920955899998) * g[6] +
    CONSTANT(-0.159787958979) * g[20];
  y[17] += tf * g[17] + tg * f[17];
  t = f[17] * g[17];
  y[0] += CONSTANT(0.28209479176899999) * t;
  y[6] += CONSTANT(-0.057343920955899998) * t;
  y[20] += CONSTANT(-0.159787958979) * t;

  // [17,19]: 8,22,24,
  tf =
    CONSTANT(-0.112621225039) * f[8] +
    CONSTANT(0.045015157794100001) * f[22] +
    CONSTANT(0.119098912753) * f[24];
  tg =
    CONSTANT(-0.112621225039) * g[8] +
    CONSTANT(0.045015157794100001) * g[22] +
    CONSTANT(0.119098912753) * g[24];
  y[17] += tf * g[19] + tg * f[19];
  y[19] += tf * g[17] + tg * f[17];
  t = f[17] * g[19] + f[19] * g[17];
  y[8] += CONSTANT(-0.112621225039) * t;
  y[22] += CONSTANT(0.045015157794100001) * t;
  y[24] += CONSTANT(0.119098912753) * t;

  // [17,21]: 16,4,18,
  tf =
    CONSTANT(-0.11909891275499999) * f[16] +
    CONSTANT(-0.112621225039) * f[4] +
    CONSTANT(0.045015157794399997) * f[18];
  tg =
    CONSTANT(-0.11909891275499999) * g[16] +
    CONSTANT(-0.112621225039) * g[4] +
    CONSTANT(0.045015157794399997) * g[18];
  y[17] += tf * g[21] + tg * f[21];
  y[21] += tf * g[17] + tg * f[17];
  t = f[17] * g[21] + f[21] * g[17];
  y[16] += CONSTANT(-0.11909891275499999) * t;
  y[4] += CONSTANT(-0.112621225039) * t;
  y[18] += CONSTANT(0.045015157794399997) * t;

  // [17,26]: 3,13,31,
  tf =
    CONSTANT(0.208340811096) * f[3] +
    CONSTANT(0.029982305185199998) * f[13] +
    CONSTANT(-0.11885360062399999) * f[31];
  tg =
    CONSTANT(0.208340811096) * g[3] +
    CONSTANT(0.029982305185199998) * g[13] +
    CONSTANT(-0.11885360062399999) * g[31];
  y[17] += tf * g[26] + tg * f[26];
  y[26] += tf * g[17] + tg * f[17];
  t = f[17] * g[26] + f[26] * g[17];
  y[3] += CONSTANT(0.208340811096) * t;
  y[13] += CONSTANT(0.029982305185199998) * t;
  y[31] += CONSTANT(-0.11885360062399999) * t;

  // [17,27]: 12,2,30,
  tf =
    CONSTANT(-0.10386175182100001) * f[12] +
    CONSTANT(0.196425600433) * f[2] +
    CONSTANT(-0.13019759620499999) * f[30];
  tg =
    CONSTANT(-0.10386175182100001) * g[12] +
    CONSTANT(0.196425600433) * g[2] +
    CONSTANT(-0.13019759620499999) * g[30];
  y[17] += tf * g[27] + tg * f[27];
  y[27] += tf * g[17] + tg * f[17];
  t = f[17] * g[27] + f[27] * g[17];
  y[12] += CONSTANT(-0.10386175182100001) * t;
  y[2] += CONSTANT(0.196425600433) * t;
  y[30] += CONSTANT(-0.13019759620499999) * t;

  // [17,28]: 13,3,31,35,
  tf =
    CONSTANT(0.121172043789) * f[13] +
    CONSTANT(-0.0601428116865) * f[3] +
    CONSTANT(0.0343100791567) * f[31] +
    CONSTANT(0.099440056652200001) * f[35];
  tg =
    CONSTANT(0.121172043789) * g[13] +
    CONSTANT(-0.0601428116865) * g[3] +
    CONSTANT(0.0343100791567) * g[31] +
    CONSTANT(0.099440056652200001) * g[35];
  y[17] += tf * g[28] + tg * f[28];
  y[28] += tf * g[17] + tg * f[17];
  t = f[17] * g[28] + f[28] * g[17];
  y[13] += CONSTANT(0.121172043789) * t;
  y[3] += CONSTANT(-0.0601428116865) * t;
  y[31] += CONSTANT(0.0343100791567) * t;
  y[35] += CONSTANT(0.099440056652200001) * t;

  // [17,32]: 11,1,25,29,
  tf =
    CONSTANT(0.12117204378800001) * f[11] +
    CONSTANT(-0.0601428116869) * f[1] +
    CONSTANT(-0.099440056652700004) * f[25] +
    CONSTANT(0.034310079156599997) * f[29];
  tg =
    CONSTANT(0.12117204378800001) * g[11] +
    CONSTANT(-0.0601428116869) * g[1] +
    CONSTANT(-0.099440056652700004) * g[25] +
    CONSTANT(0.034310079156599997) * g[29];
  y[17] += tf * g[32] + tg * f[32];
  y[32] += tf * g[17] + tg * f[17];
  t = f[17] * g[32] + f[32] * g[17];
  y[11] += CONSTANT(0.12117204378800001) * t;
  y[1] += CONSTANT(-0.0601428116869) * t;
  y[25] += CONSTANT(-0.099440056652700004) * t;
  y[29] += CONSTANT(0.034310079156599997) * t;

  // [17,34]: 29,11,1,
  tf =
    CONSTANT(0.118853600623) * f[29] +
    CONSTANT(-0.029982305185400002) * f[11] +
    CONSTANT(-0.2083408111) * f[1];
  tg =
    CONSTANT(0.118853600623) * g[29] +
    CONSTANT(-0.029982305185400002) * g[11] +
    CONSTANT(-0.2083408111) * g[1];
  y[17] += tf * g[34] + tg * f[34];
  y[34] += tf * g[17] + tg * f[17];
  t = f[17] * g[34] + f[34] * g[17];
  y[29] += CONSTANT(0.118853600623) * t;
  y[11] += CONSTANT(-0.029982305185400002) * t;
  y[1] += CONSTANT(-0.2083408111) * t;

  // [18,18]: 6,0,20,24,
  tf =
    CONSTANT(0.065535909662600006) * f[6] +
    CONSTANT(0.28209479177199998) * f[0] +
    CONSTANT(-0.083698454702400005) * f[20] +
    CONSTANT(-0.135045473384) * f[24];
  tg =
    CONSTANT(0.065535909662600006) * g[6] +
    CONSTANT(0.28209479177199998) * g[0] +
    CONSTANT(-0.083698454702400005) * g[20] +
    CONSTANT(-0.135045473384) * g[24];
  y[18] += tf * g[18] + tg * f[18];
  t = f[18] * g[18];
  y[6] += CONSTANT(0.065535909662600006) * t;
  y[0] += CONSTANT(0.28209479177199998) * t;
  y[20] += CONSTANT(-0.083698454702400005) * t;
  y[24] += CONSTANT(-0.135045473384) * t;

  // [18,19]: 7,21,23,
  tf =
    CONSTANT(0.090297865407399994) * f[7] +
    CONSTANT(0.102084782359) * f[21] +
    CONSTANT(-0.045015157794399997) * f[23];
  tg =
    CONSTANT(0.090297865407399994) * g[7] +
    CONSTANT(0.102084782359) * g[21] +
    CONSTANT(-0.045015157794399997) * g[23];
  y[18] += tf * g[19] + tg * f[19];
  y[19] += tf * g[18] + tg * f[18];
  t = f[18] * g[19] + f[19] * g[18];
  y[7] += CONSTANT(0.090297865407399994) * t;
  y[21] += CONSTANT(0.102084782359) * t;
  y[23] += CONSTANT(-0.045015157794399997) * t;

  // [18,25]: 15,33,
  tf = CONSTANT(-0.098140130731999994) * f[15] + CONSTANT(0.130197596202) * f[33];
  tg = CONSTANT(-0.098140130731999994) * g[15] + CONSTANT(0.130197596202) * g[33];
  y[18] += tf * g[25] + tg * f[25];
  y[25] += tf * g[18] + tg * f[18];
  t = f[18] * g[25] + f[25] * g[18];
  y[15] += CONSTANT(-0.098140130731999994) * t;
  y[33] += CONSTANT(0.130197596202) * t;

  // [18,26]: 14,32,
  tf = CONSTANT(0.101358691174) * f[14] + CONSTANT(0.084042186965900004) * f[32];
  tg = CONSTANT(0.101358691174) * g[14] + CONSTANT(0.084042186965900004) * g[32];
  y[18] += tf * g[26] + tg * f[26];
  y[26] += tf * g[18] + tg * f[18];
  t = f[18] * g[26] + f[26] * g[18];
  y[14] += CONSTANT(0.101358691174) * t;
  y[32] += CONSTANT(0.084042186965900004) * t;

  // [18,27]: 13,3,35,
  tf =
    CONSTANT(0.101990215611) * f[13] +
    CONSTANT(0.18373932470599999) * f[3] +
    CONSTANT(-0.130197596202) * f[35];
  tg =
    CONSTANT(0.101990215611) * g[13] +
    CONSTANT(0.18373932470599999) * g[3] +
    CONSTANT(-0.130197596202) * g[35];
  y[18] += tf * g[27] + tg * f[27];
  y[27] += tf * g[18] + tg * f[18];
  t = f[18] * g[27] + f[27] * g[18];
  y[13] += CONSTANT(0.101990215611) * t;
  y[3] += CONSTANT(0.18373932470599999) * t;
  y[35] += CONSTANT(-0.130197596202) * t;

  // [18,28]: 2,12,30,34,
  tf =
    CONSTANT(0.22503379560600001) * f[2] +
    CONSTANT(0.022664492358099999) * f[12] +
    CONSTANT(-0.099440056651100006) * f[30] +
    CONSTANT(-0.084042186968800003) * f[34];
  tg =
    CONSTANT(0.22503379560600001) * g[2] +
    CONSTANT(0.022664492358099999) * g[12] +
    CONSTANT(-0.099440056651100006) * g[30] +
    CONSTANT(-0.084042186968800003) * g[34];
  y[18] += tf * g[28] + tg * f[28];
  y[28] += tf * g[18] + tg * f[18];
  t = f[18] * g[28] + f[28] * g[18];
  y[2] += CONSTANT(0.22503379560600001) * t;
  y[12] += CONSTANT(0.022664492358099999) * t;
  y[30] += CONSTANT(-0.099440056651100006) * t;
  y[34] += CONSTANT(-0.084042186968800003) * t;

  // [18,29]: 3,13,15,31,
  tf =
    CONSTANT(-0.085054779966799998) * f[3] +
    CONSTANT(0.075189952564900006) * f[13] +
    CONSTANT(0.10158468631000001) * f[15] +
    CONSTANT(0.097043558538999999) * f[31];
  tg =
    CONSTANT(-0.085054779966799998) * g[3] +
    CONSTANT(0.075189952564900006) * g[13] +
    CONSTANT(0.10158468631000001) * g[15] +
    CONSTANT(0.097043558538999999) * g[31];
  y[18] += tf * g[29] + tg * f[29];
  y[29] += tf * g[18] + tg * f[18];
  t = f[18] * g[29] + f[29] * g[18];
  y[3] += CONSTANT(-0.085054779966799998) * t;
  y[13] += CONSTANT(0.075189952564900006) * t;
  y[15] += CONSTANT(0.10158468631000001) * t;
  y[31] += CONSTANT(0.097043558538999999) * t;

  // [19,19]: 6,8,0,20,22,
  tf =
    CONSTANT(0.13926380803399999) * f[6] +
    CONSTANT(-0.14188940657099999) * f[8] +
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.068480553847200004) * f[20] +
    CONSTANT(-0.10208478236) * f[22];
  tg =
    CONSTANT(0.13926380803399999) * g[6] +
    CONSTANT(-0.14188940657099999) * g[8] +
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.068480553847200004) * g[20] +
    CONSTANT(-0.10208478236) * g[22];
  y[19] += tf * g[19] + tg * f[19];
  t = f[19] * g[19];
  y[6] += CONSTANT(0.13926380803399999) * t;
  y[8] += CONSTANT(-0.14188940657099999) * t;
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[20] += CONSTANT(0.068480553847200004) * t;
  y[22] += CONSTANT(-0.10208478236) * t;

  // [19,25]: 34,
  tf = CONSTANT(-0.13019759620599999) * f[34];
  tg = CONSTANT(-0.13019759620599999) * g[34];
  y[19] += tf * g[25] + tg * f[25];
  y[25] += tf * g[19] + tg * f[19];
  t = f[19] * g[25] + f[25] * g[19];
  y[34] += CONSTANT(-0.13019759620599999) * t;

  // [19,26]: 15,35,
  tf = CONSTANT(-0.131668802182) * f[15] + CONSTANT(0.13019759620499999) * f[35];
  tg = CONSTANT(-0.131668802182) * g[15] + CONSTANT(0.13019759620499999) * g[35];
  y[19] += tf * g[26] + tg * f[26];
  y[26] += tf * g[19] + tg * f[19];
  t = f[19] * g[26] + f[26] * g[19];
  y[15] += CONSTANT(-0.131668802182) * t;
  y[35] += CONSTANT(0.13019759620499999) * t;

  // [19,27]: 14,32,
  tf = CONSTANT(0.025339672793899998) * f[14] + CONSTANT(0.084042186967699994) * f[32];
  tg = CONSTANT(0.025339672793899998) * g[14] + CONSTANT(0.084042186967699994) * g[32];
  y[19] += tf * g[27] + tg * f[27];
  y[27] += tf * g[19] + tg * f[19];
  t = f[19] * g[27] + f[27] * g[19];
  y[14] += CONSTANT(0.025339672793899998) * t;
  y[32] += CONSTANT(0.084042186967699994) * t;

  // [19,28]: 13,3,15,31,33,
  tf =
    CONSTANT(0.104682806111) * f[13] +
    CONSTANT(0.15912292286999999) * f[3] +
    CONSTANT(-0.12669836397000001) * f[15] +
    CONSTANT(0.090775936911399999) * f[31] +
    CONSTANT(-0.084042186968400004) * f[33];
  tg =
    CONSTANT(0.104682806111) * g[13] +
    CONSTANT(0.15912292286999999) * g[3] +
    CONSTANT(-0.12669836397000001) * g[15] +
    CONSTANT(0.090775936911399999) * g[31] +
    CONSTANT(-0.084042186968400004) * g[33];
  y[19] += tf * g[28] + tg * f[28];
  y[28] += tf * g[19] + tg * f[19];
  t = f[19] * g[28] + f[28] * g[19];
  y[13] += CONSTANT(0.104682806111) * t;
  y[3] += CONSTANT(0.15912292286999999) * t;
  y[15] += CONSTANT(-0.12669836397000001) * t;
  y[31] += CONSTANT(0.090775936911399999) * t;
  y[33] += CONSTANT(-0.084042186968400004) * t;

  // [19,29]: 12,14,2,30,32,
  tf =
    CONSTANT(0.11508946712400001) * f[12] +
    CONSTANT(-0.097749909977199997) * f[14] +
    CONSTANT(0.24057124674499999) * f[2] +
    CONSTANT(0.053152946072499999) * f[30] +
    CONSTANT(-0.090775936912099994) * f[32];
  tg =
    CONSTANT(0.11508946712400001) * g[12] +
    CONSTANT(-0.097749909977199997) * g[14] +
    CONSTANT(0.24057124674499999) * g[2] +
    CONSTANT(0.053152946072499999) * g[30] +
    CONSTANT(-0.090775936912099994) * g[32];
  y[19] += tf * g[29] + tg * f[29];
  y[29] += tf * g[19] + tg * f[19];
  t = f[19] * g[29] + f[29] * g[19];
  y[12] += CONSTANT(0.11508946712400001) * t;
  y[14] += CONSTANT(-0.097749909977199997) * t;
  y[2] += CONSTANT(0.24057124674499999) * t;
  y[30] += CONSTANT(0.053152946072499999) * t;
  y[32] += CONSTANT(-0.090775936912099994) * t;

  // [20,20]: 6,0,20,
  tf = CONSTANT(0.16383979750300001) * f[6] + CONSTANT(0.28209480223200001) * f[0];
  tg = CONSTANT(0.16383979750300001) * g[6] + CONSTANT(0.28209480223200001) * g[0];
  y[20] += tf * g[20] + tg * f[20];
  t = f[20] * g[20];
  y[6] += CONSTANT(0.16383979750300001) * t;
  y[0] += CONSTANT(0.28209480223200001) * t;
  y[20] += CONSTANT(0.13696113900599999) * t;

  // [21,21]: 6,20,0,8,22,
  tf =
    CONSTANT(0.13926380803399999) * f[6] +
    CONSTANT(0.068480553847200004) * f[20] +
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(0.14188940657099999) * f[8] +
    CONSTANT(0.10208478236) * f[22];
  tg =
    CONSTANT(0.13926380803399999) * g[6] +
    CONSTANT(0.068480553847200004) * g[20] +
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(0.14188940657099999) * g[8] +
    CONSTANT(0.10208478236) * g[22];
  y[21] += tf * g[21] + tg * f[21];
  t = f[21] * g[21];
  y[6] += CONSTANT(0.13926380803399999) * t;
  y[20] += CONSTANT(0.068480553847200004) * t;
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[8] += CONSTANT(0.14188940657099999) * t;
  y[22] += CONSTANT(0.10208478236) * t;

  // [21,23]: 8,22,24,
  tf =
    CONSTANT(-0.112621225039) * f[8] +
    CONSTANT(0.045015157794100001) * f[22] +
    CONSTANT(-0.119098912753) * f[24];
  tg =
    CONSTANT(-0.112621225039) * g[8] +
    CONSTANT(0.045015157794100001) * g[22] +
    CONSTANT(-0.119098912753) * g[24];
  y[21] += tf * g[23] + tg * f[23];
  y[23] += tf * g[21] + tg * f[21];
  t = f[21] * g[23] + f[23] * g[21];
  y[8] += CONSTANT(-0.112621225039) * t;
  y[22] += CONSTANT(0.045015157794100001) * t;
  y[24] += CONSTANT(-0.119098912753) * t;

  // [21,26]: 9,25,
  tf = CONSTANT(-0.131668802182) * f[9] + CONSTANT(-0.13019759620499999) * f[25];
  tg = CONSTANT(-0.131668802182) * g[9] + CONSTANT(-0.13019759620499999) * g[25];
  y[21] += tf * g[26] + tg * f[26];
  y[26] += tf * g[21] + tg * f[21];
  t = f[21] * g[26] + f[26] * g[21];
  y[9] += CONSTANT(-0.131668802182) * t;
  y[25] += CONSTANT(-0.13019759620499999) * t;

  // [21,28]: 27,1,11,9,29,
  tf =
    CONSTANT(0.084042186968400004) * f[27] +
    CONSTANT(0.15912292286999999) * f[1] +
    CONSTANT(0.104682806111) * f[11] +
    CONSTANT(0.12669836397000001) * f[9] +
    CONSTANT(0.090775936911399999) * f[29];
  tg =
    CONSTANT(0.084042186968400004) * g[27] +
    CONSTANT(0.15912292286999999) * g[1] +
    CONSTANT(0.104682806111) * g[11] +
    CONSTANT(0.12669836397000001) * g[9] +
    CONSTANT(0.090775936911399999) * g[29];
  y[21] += tf * g[28] + tg * f[28];
  y[28] += tf * g[21] + tg * f[21];
  t = f[21] * g[28] + f[28] * g[21];
  y[27] += CONSTANT(0.084042186968400004) * t;
  y[1] += CONSTANT(0.15912292286999999) * t;
  y[11] += CONSTANT(0.104682806111) * t;
  y[9] += CONSTANT(0.12669836397000001) * t;
  y[29] += CONSTANT(0.090775936911399999) * t;

  // [21,31]: 14,2,30,12,32,
  tf =
    CONSTANT(0.097749909977199997) * f[14] +
    CONSTANT(0.24057124674499999) * f[2] +
    CONSTANT(0.053152946072499999) * f[30] +
    CONSTANT(0.11508946712400001) * f[12] +
    CONSTANT(0.090775936912099994) * f[32];
  tg =
    CONSTANT(0.097749909977199997) * g[14] +
    CONSTANT(0.24057124674499999) * g[2] +
    CONSTANT(0.053152946072499999) * g[30] +
    CONSTANT(0.11508946712400001) * g[12] +
    CONSTANT(0.090775936912099994) * g[32];
  y[21] += tf * g[31] + tg * f[31];
  y[31] += tf * g[21] + tg * f[21];
  t = f[21] * g[31] + f[31] * g[21];
  y[14] += CONSTANT(0.097749909977199997) * t;
  y[2] += CONSTANT(0.24057124674499999) * t;
  y[30] += CONSTANT(0.053152946072499999) * t;
  y[12] += CONSTANT(0.11508946712400001) * t;
  y[32] += CONSTANT(0.090775936912099994) * t;

  // [21,33]: 32,14,
  tf = CONSTANT(0.084042186967699994) * f[32] + CONSTANT(0.025339672793899998) * f[14];
  tg = CONSTANT(0.084042186967699994) * g[32] + CONSTANT(0.025339672793899998) * g[14];
  y[21] += tf * g[33] + tg * f[33];
  y[33] += tf * g[21] + tg * f[21];
  t = f[21] * g[33] + f[33] * g[21];
  y[32] += CONSTANT(0.084042186967699994) * t;
  y[14] += CONSTANT(0.025339672793899998) * t;

  // [21,34]: 35,
  tf = CONSTANT(-0.13019759620599999) * f[35];
  tg = CONSTANT(-0.13019759620599999) * g[35];
  y[21] += tf * g[34] + tg * f[34];
  y[34] += tf * g[21] + tg * f[21];
  t = f[21] * g[34] + f[34] * g[21];
  y[35] += CONSTANT(-0.13019759620599999) * t;

  // [22,22]: 6,20,0,24,
  tf =
    CONSTANT(0.065535909662600006) * f[6] +
    CONSTANT(-0.083698454702400005) * f[20] +
    CONSTANT(0.28209479177199998) * f[0] +
    CONSTANT(0.135045473384) * f[24];
  tg =
    CONSTANT(0.065535909662600006) * g[6] +
    CONSTANT(-0.083698454702400005) * g[20] +
    CONSTANT(0.28209479177199998) * g[0] +
    CONSTANT(0.135045473384) * g[24];
  y[22] += tf * g[22] + tg * f[22];
  t = f[22] * g[22];
  y[6] += CONSTANT(0.065535909662600006) * t;
  y[20] += CONSTANT(-0.083698454702400005) * t;
  y[0] += CONSTANT(0.28209479177199998) * t;
  y[24] += CONSTANT(0.135045473384) * t;

  // [22,26]: 10,28,
  tf = CONSTANT(0.101358691174) * f[10] + CONSTANT(0.084042186965900004) * f[28];
  tg = CONSTANT(0.101358691174) * g[10] + CONSTANT(0.084042186965900004) * g[28];
  y[22] += tf * g[26] + tg * f[26];
  y[26] += tf * g[22] + tg * f[22];
  t = f[22] * g[26] + f[26] * g[22];
  y[10] += CONSTANT(0.101358691174) * t;
  y[28] += CONSTANT(0.084042186965900004) * t;

  // [22,27]: 1,11,25,
  tf =
    CONSTANT(0.18373932470400001) * f[1] +
    CONSTANT(0.101990215611) * f[11] +
    CONSTANT(0.13019759620099999) * f[25];
  tg =
    CONSTANT(0.18373932470400001) * g[1] +
    CONSTANT(0.101990215611) * g[11] +
    CONSTANT(0.13019759620099999) * g[25];
  y[22] += tf * g[27] + tg * f[27];
  y[27] += tf * g[22] + tg * f[22];
  t = f[22] * g[27] + f[27] * g[22];
  y[1] += CONSTANT(0.18373932470400001) * t;
  y[11] += CONSTANT(0.101990215611) * t;
  y[25] += CONSTANT(0.13019759620099999) * t;

  // [22,32]: 2,30,12,34,
  tf =
    CONSTANT(0.22503379560600001) * f[2] +
    CONSTANT(-0.099440056651100006) * f[30] +
    CONSTANT(0.022664492358099999) * f[12] +
    CONSTANT(0.084042186968800003) * f[34];
  tg =
    CONSTANT(0.22503379560600001) * g[2] +
    CONSTANT(-0.099440056651100006) * g[30] +
    CONSTANT(0.022664492358099999) * g[12] +
    CONSTANT(0.084042186968800003) * g[34];
  y[22] += tf * g[32] + tg * f[32];
  y[32] += tf * g[22] + tg * f[22];
  t = f[22] * g[32] + f[32] * g[22];
  y[2] += CONSTANT(0.22503379560600001) * t;
  y[30] += CONSTANT(-0.099440056651100006) * t;
  y[12] += CONSTANT(0.022664492358099999) * t;
  y[34] += CONSTANT(0.084042186968800003) * t;

  // [22,33]: 3,13,35,
  tf =
    CONSTANT(0.18373932470400001) * f[3] +
    CONSTANT(0.101990215611) * f[13] +
    CONSTANT(0.13019759620099999) * f[35];
  tg =
    CONSTANT(0.18373932470400001) * g[3] +
    CONSTANT(0.101990215611) * g[13] +
    CONSTANT(0.13019759620099999) * g[35];
  y[22] += tf * g[33] + tg * f[33];
  y[33] += tf * g[22] + tg * f[22];
  t = f[22] * g[33] + f[33] * g[22];
  y[3] += CONSTANT(0.18373932470400001) * t;
  y[13] += CONSTANT(0.101990215611) * t;
  y[35] += CONSTANT(0.13019759620099999) * t;

  // [23,23]: 6,20,0,
  tf =
    CONSTANT(-0.057343920955899998) * f[6] +
    CONSTANT(-0.159787958979) * f[20] +
    CONSTANT(0.28209479176899999) * f[0];
  tg =
    CONSTANT(-0.057343920955899998) * g[6] +
    CONSTANT(-0.159787958979) * g[20] +
    CONSTANT(0.28209479176899999) * g[0];
  y[23] += tf * g[23] + tg * f[23];
  t = f[23] * g[23];
  y[6] += CONSTANT(-0.057343920955899998) * t;
  y[20] += CONSTANT(-0.159787958979) * t;
  y[0] += CONSTANT(0.28209479176899999) * t;

  // [23,26]: 1,11,29,
  tf =
    CONSTANT(0.208340811096) * f[1] +
    CONSTANT(0.029982305185199998) * f[11] +
    CONSTANT(-0.11885360062399999) * f[29];
  tg =
    CONSTANT(0.208340811096) * g[1] +
    CONSTANT(0.029982305185199998) * g[11] +
    CONSTANT(-0.11885360062399999) * g[29];
  y[23] += tf * g[26] + tg * f[26];
  y[26] += tf * g[23] + tg * f[23];
  t = f[23] * g[26] + f[26] * g[23];
  y[1] += CONSTANT(0.208340811096) * t;
  y[11] += CONSTANT(0.029982305185199998) * t;
  y[29] += CONSTANT(-0.11885360062399999) * t;

  // [23,28]: 25,11,1,29,
  tf =
    CONSTANT(-0.099440056652200001) * f[25] +
    CONSTANT(-0.121172043789) * f[11] +
    CONSTANT(0.0601428116865) * f[1] +
    CONSTANT(-0.0343100791567) * f[29];
  tg =
    CONSTANT(-0.099440056652200001) * g[25] +
    CONSTANT(-0.121172043789) * g[11] +
    CONSTANT(0.0601428116865) * g[1] +
    CONSTANT(-0.0343100791567) * g[29];
  y[23] += tf * g[28] + tg * f[28];
  y[28] += tf * g[23] + tg * f[23];
  t = f[23] * g[28] + f[28] * g[23];
  y[25] += CONSTANT(-0.099440056652200001) * t;
  y[11] += CONSTANT(-0.121172043789) * t;
  y[1] += CONSTANT(0.0601428116865) * t;
  y[29] += CONSTANT(-0.0343100791567) * t;

  // [23,32]: 31,13,3,35,
  tf =
    CONSTANT(0.034310079156599997) * f[31] +
    CONSTANT(0.12117204378800001) * f[13] +
    CONSTANT(-0.0601428116869) * f[3] +
    CONSTANT(-0.099440056652700004) * f[35];
  tg =
    CONSTANT(0.034310079156599997) * g[31] +
    CONSTANT(0.12117204378800001) * g[13] +
    CONSTANT(-0.0601428116869) * g[3] +
    CONSTANT(-0.099440056652700004) * g[35];
  y[23] += tf * g[32] + tg * f[32];
  y[32] += tf * g[23] + tg * f[23];
  t = f[23] * g[32] + f[32] * g[23];
  y[31] += CONSTANT(0.034310079156599997) * t;
  y[13] += CONSTANT(0.12117204378800001) * t;
  y[3] += CONSTANT(-0.0601428116869) * t;
  y[35] += CONSTANT(-0.099440056652700004) * t;

  // [23,33]: 2,30,12,
  tf =
    CONSTANT(0.196425600433) * f[2] +
    CONSTANT(-0.13019759620499999) * f[30] +
    CONSTANT(-0.10386175182100001) * f[12];
  tg =
    CONSTANT(0.196425600433) * g[2] +
    CONSTANT(-0.13019759620499999) * g[30] +
    CONSTANT(-0.10386175182100001) * g[12];
  y[23] += tf * g[33] + tg * f[33];
  y[33] += tf * g[23] + tg * f[23];
  t = f[23] * g[33] + f[33] * g[23];
  y[2] += CONSTANT(0.196425600433) * t;
  y[30] += CONSTANT(-0.13019759620499999) * t;
  y[12] += CONSTANT(-0.10386175182100001) * t;

  // [23,34]: 3,13,31,
  tf =
    CONSTANT(0.2083408111) * f[3] +
    CONSTANT(0.029982305185400002) * f[13] +
    CONSTANT(-0.118853600623) * f[31];
  tg =
    CONSTANT(0.2083408111) * g[3] +
    CONSTANT(0.029982305185400002) * g[13] +
    CONSTANT(-0.118853600623) * g[31];
  y[23] += tf * g[34] + tg * f[34];
  y[34] += tf * g[23] + tg * f[23];
  t = f[23] * g[34] + f[34] * g[23];
  y[3] += CONSTANT(0.2083408111) * t;
  y[13] += CONSTANT(0.029982305185400002) * t;
  y[31] += CONSTANT(-0.118853600623) * t;

  // [24,24]: 6,0,20,
  tf =
    CONSTANT(-0.229375683829) * f[6] +
    CONSTANT(0.28209479176399999) * f[0] +
    CONSTANT(0.106525305981) * f[20];
  tg =
    CONSTANT(-0.229375683829) * g[6] +
    CONSTANT(0.28209479176399999) * g[0] +
    CONSTANT(0.106525305981) * g[20];
  y[24] += tf * g[24] + tg * f[24];
  t = f[24] * g[24];
  y[6] += CONSTANT(-0.229375683829) * t;
  y[0] += CONSTANT(0.28209479176399999) * t;
  y[20] += CONSTANT(0.106525305981) * t;

  // [24,29]: 9,27,25,
  tf =
    CONSTANT(-0.0358357089314) * f[9] +
    CONSTANT(0.118853600623) * f[27] +
    CONSTANT(0.053152946071199997) * f[25];
  tg =
    CONSTANT(-0.0358357089314) * g[9] +
    CONSTANT(0.118853600623) * g[27] +
    CONSTANT(0.053152946071199997) * g[25];
  y[24] += tf * g[29] + tg * f[29];
  y[29] += tf * g[24] + tg * f[24];
  t = f[24] * g[29] + f[29] * g[24];
  y[9] += CONSTANT(-0.0358357089314) * t;
  y[27] += CONSTANT(0.118853600623) * t;
  y[25] += CONSTANT(0.053152946071199997) * t;

  // [24,31]: 15,33,35,
  tf =
    CONSTANT(0.0358357089314) * f[15] +
    CONSTANT(-0.118853600623) * f[33] +
    CONSTANT(0.053152946071199997) * f[35];
  tg =
    CONSTANT(0.0358357089314) * g[15] +
    CONSTANT(-0.118853600623) * g[33] +
    CONSTANT(0.053152946071199997) * g[35];
  y[24] += tf * g[31] + tg * f[31];
  y[31] += tf * g[24] + tg * f[24];
  t = f[24] * g[31] + f[31] * g[24];
  y[15] += CONSTANT(0.0358357089314) * t;
  y[33] += CONSTANT(-0.118853600623) * t;
  y[35] += CONSTANT(0.053152946071199997) * t;

  // [24,34]: 12,30,2,
  tf =
    CONSTANT(-0.207723503645) * f[12] +
    CONSTANT(0.13019759619999999) * f[30] +
    CONSTANT(0.14731920032500001) * f[2];
  tg =
    CONSTANT(-0.207723503645) * g[12] +
    CONSTANT(0.13019759619999999) * g[30] +
    CONSTANT(0.14731920032500001) * g[2];
  y[24] += tf * g[34] + tg * f[34];
  y[34] += tf * g[24] + tg * f[24];
  t = f[24] * g[34] + f[34] * g[24];
  y[12] += CONSTANT(-0.207723503645) * t;
  y[30] += CONSTANT(0.13019759619999999) * t;
  y[2] += CONSTANT(0.14731920032500001) * t;

  // [25,25]: 0,6,20,
  tf =
    CONSTANT(0.28209479176199997) * f[0] +
    CONSTANT(-0.24260889635899999) * f[6] +
    CONSTANT(0.130197596198) * f[20];
  tg =
    CONSTANT(0.28209479176199997) * g[0] +
    CONSTANT(-0.24260889635899999) * g[6] +
    CONSTANT(0.130197596198) * g[20];
  y[25] += tf * g[25] + tg * f[25];
  t = f[25] * g[25];
  y[0] += CONSTANT(0.28209479176199997) * t;
  y[6] += CONSTANT(-0.24260889635899999) * t;
  y[20] += CONSTANT(0.130197596198) * t;

  // [26,26]: 6,20,0,
  tf =
    CONSTANT(-0.097043558542400002) * f[6] +
    CONSTANT(-0.130197596207) * f[20] +
    CONSTANT(0.282094791766) * f[0];
  tg =
    CONSTANT(-0.097043558542400002) * g[6] +
    CONSTANT(-0.130197596207) * g[20] +
    CONSTANT(0.282094791766) * g[0];
  y[26] += tf * g[26] + tg * f[26];
  t = f[26] * g[26];
  y[6] += CONSTANT(-0.097043558542400002) * t;
  y[20] += CONSTANT(-0.130197596207) * t;
  y[0] += CONSTANT(0.282094791766) * t;

  // [27,27]: 0,20,6,
  tf =
    CONSTANT(0.28209479177000002) * f[0] +
    CONSTANT(-0.13019759620499999) * f[20] +
    CONSTANT(0.016173926423100001) * f[6];
  tg =
    CONSTANT(0.28209479177000002) * g[0] +
    CONSTANT(-0.13019759620499999) * g[20] +
    CONSTANT(0.016173926423100001) * g[6];
  y[27] += tf * g[27] + tg * f[27];
  t = f[27] * g[27];
  y[0] += CONSTANT(0.28209479177000002) * t;
  y[20] += CONSTANT(-0.13019759620499999) * t;
  y[6] += CONSTANT(0.016173926423100001) * t;

  // [28,28]: 6,0,20,24,
  tf =
    CONSTANT(0.097043558538800007) * f[6] +
    CONSTANT(0.28209479177199998) * f[0] +
    CONSTANT(-0.021699599367299999) * f[20] +
    CONSTANT(-0.128376561118) * f[24];
  tg =
    CONSTANT(0.097043558538800007) * g[6] +
    CONSTANT(0.28209479177199998) * g[0] +
    CONSTANT(-0.021699599367299999) * g[20] +
    CONSTANT(-0.128376561118) * g[24];
  y[28] += tf * g[28] + tg * f[28];
  t = f[28] * g[28];
  y[6] += CONSTANT(0.097043558538800007) * t;
  y[0] += CONSTANT(0.28209479177199998) * t;
  y[20] += CONSTANT(-0.021699599367299999) * t;
  y[24] += CONSTANT(-0.128376561118) * t;

  // [29,29]: 20,6,0,22,8,
  tf =
    CONSTANT(0.086798397468799998) * f[20] +
    CONSTANT(0.14556533780899999) * f[6] +
    CONSTANT(0.28209479177399999) * f[0] +
    CONSTANT(-0.097043558539500002) * f[22] +
    CONSTANT(-0.140070311615) * f[8];
  tg =
    CONSTANT(0.086798397468799998) * g[20] +
    CONSTANT(0.14556533780899999) * g[6] +
    CONSTANT(0.28209479177399999) * g[0] +
    CONSTANT(-0.097043558539500002) * g[22] +
    CONSTANT(-0.140070311615) * g[8];
  y[29] += tf * g[29] + tg * f[29];
  t = f[29] * g[29];
  y[20] += CONSTANT(0.086798397468799998) * t;
  y[6] += CONSTANT(0.14556533780899999) * t;
  y[0] += CONSTANT(0.28209479177399999) * t;
  y[22] += CONSTANT(-0.097043558539500002) * t;
  y[8] += CONSTANT(-0.140070311615) * t;

  // [30,30]: 0,20,6,
  tf =
    CONSTANT(0.282094804531) * f[0] + CONSTANT(0.130197634486) * f[20] + CONSTANT(0.16173929276900001) * f[6];
  tg =
    CONSTANT(0.282094804531) * g[0] + CONSTANT(0.130197634486) * g[20] + CONSTANT(0.16173929276900001) * g[6];
  y[30] += tf * g[30] + tg * f[30];
  t = f[30] * g[30];
  y[0] += CONSTANT(0.282094804531) * t;
  y[20] += CONSTANT(0.130197634486) * t;
  y[6] += CONSTANT(0.16173929276900001) * t;

  // [31,31]: 6,8,20,22,0,
  tf =
    CONSTANT(0.14556533780899999) * f[6] +
    CONSTANT(0.140070311615) * f[8] +
    CONSTANT(0.086798397468799998) * f[20] +
    CONSTANT(0.097043558539500002) * f[22] +
    CONSTANT(0.28209479177399999) * f[0];
  tg =
    CONSTANT(0.14556533780899999) * g[6] +
    CONSTANT(0.140070311615) * g[8] +
    CONSTANT(0.086798397468799998) * g[20] +
    CONSTANT(0.097043558539500002) * g[22] +
    CONSTANT(0.28209479177399999) * g[0];
  y[31] += tf * g[31] + tg * f[31];
  t = f[31] * g[31];
  y[6] += CONSTANT(0.14556533780899999) * t;
  y[8] += CONSTANT(0.140070311615) * t;
  y[20] += CONSTANT(0.086798397468799998) * t;
  y[22] += CONSTANT(0.097043558539500002) * t;
  y[0] += CONSTANT(0.28209479177399999) * t;

  // [32,32]: 0,24,20,6,
  tf =
    CONSTANT(0.28209479177199998) * f[0] +
    CONSTANT(0.128376561118) * f[24] +
    CONSTANT(-0.021699599367299999) * f[20] +
    CONSTANT(0.097043558538800007) * f[6];
  tg =
    CONSTANT(0.28209479177199998) * g[0] +
    CONSTANT(0.128376561118) * g[24] +
    CONSTANT(-0.021699599367299999) * g[20] +
    CONSTANT(0.097043558538800007) * g[6];
  y[32] += tf * g[32] + tg * f[32];
  t = f[32] * g[32];
  y[0] += CONSTANT(0.28209479177199998) * t;
  y[24] += CONSTANT(0.128376561118) * t;
  y[20] += CONSTANT(-0.021699599367299999) * t;
  y[6] += CONSTANT(0.097043558538800007) * t;

  // [33,33]: 6,20,0,
  tf =
    CONSTANT(0.016173926423100001) * f[6] +
    CONSTANT(-0.13019759620499999) * f[20] +
    CONSTANT(0.28209479177000002) * f[0];
  tg =
    CONSTANT(0.016173926423100001) * g[6] +
    CONSTANT(-0.13019759620499999) * g[20] +
    CONSTANT(0.28209479177000002) * g[0];
  y[33] += tf * g[33] + tg * f[33];
  t = f[33] * g[33];
  y[6] += CONSTANT(0.016173926423100001) * t;
  y[20] += CONSTANT(-0.13019759620499999) * t;
  y[0] += CONSTANT(0.28209479177000002) * t;

  // [34,34]: 20,6,0,
  tf =
    CONSTANT(-0.130197596207) * f[20] +
    CONSTANT(-0.097043558542400002) * f[6] +
    CONSTANT(0.282094791766) * f[0];
  tg =
    CONSTANT(-0.130197596207) * g[20] +
    CONSTANT(-0.097043558542400002) * g[6] +
    CONSTANT(0.282094791766) * g[0];
  y[34] += tf * g[34] + tg * f[34];
  t = f[34] * g[34];
  y[20] += CONSTANT(-0.130197596207) * t;
  y[6] += CONSTANT(-0.097043558542400002) * t;
  y[0] += CONSTANT(0.282094791766) * t;

  // [35,35]: 6,0,20,
  tf =
    CONSTANT(-0.24260889635899999) * f[6] +
    CONSTANT(0.28209479176199997) * f[0] +
    CONSTANT(0.130197596198) * f[20];
  tg =
    CONSTANT(-0.24260889635899999) * g[6] +
    CONSTANT(0.28209479176199997) * g[0] +
    CONSTANT(0.130197596198) * g[20];
  y[35] += tf * g[35] + tg * f[35];
  t = f[35] * g[35];
  y[6] += CONSTANT(-0.24260889635899999) * t;
  y[0] += CONSTANT(0.28209479176199997) * t;
  y[20] += CONSTANT(0.130197596198) * t;

  // multiply count=2527

  return y;
}

//-------------------------------------------------------------------------------------
// Evaluates a directional light and returns spectral SH data.  The output
// vector is computed so that if the intensity of R/G/B is unit the resulting
// exit radiance of a point directly under the light on a diffuse object with
// an albedo of 1 would be 1.0.  This will compute 3 spectral samples, resultR
// has to be specified, while resultG and resultB are optional.
//
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb204988.aspx
//-------------------------------------------------------------------------------------
/** @internal */
export function XMSHEvalDirectionalLight(
  order: number,
  dir: Vector3,
  color: Vector3,
  resultR: Float32Array,
  resultG: Float32Array,
  resultB: Float32Array
): boolean {
  if (!resultR) return false;

  if (order < SH_MINORDER || order > SH_MAXORDER) return false;

  const clr = color;
  const fTmp = new Float32Array(SH_MAXORDER * SH_MAXORDER);

  XMSHEvalDirection(fTmp, order, dir); // evaluate the BF in this direction...

  // now compute "normalization" and scale vector for each valid spectral band
  const fNorm = XM_PI / CosWtInt(order);

  const numcoeff = order * order;

  const fRScale = fNorm * clr.x;

  for (let i = 0; i < numcoeff; ++i) {
    resultR[i] = fTmp[i] * fRScale;
  }

  if (resultG) {
    const fGScale = fNorm * clr.y;

    for (let i = 0; i < numcoeff; ++i) {
      resultG[i] = fTmp[i] * fGScale;
    }
  }

  if (resultB) {
    const fBScale = fNorm * clr.z;

    for (let i = 0; i < numcoeff; ++i) {
      resultB[i] = fTmp[i] * fBScale;
    }
  }

  return true;
}

//------------------------------------------------------------------------------------
// Evaluates a spherical light and returns spectral SH data.  There is no
// normalization of the intensity of the light like there is for directional
// lights, care has to be taken when specifiying the intensities.  This will
// compute 3 spectral samples, resultR has to be specified, while resultG and
// resultB are optional.
//
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb205451.aspx
//-------------------------------------------------------------------------------------
/** @internal */
export function XMSHEvalSphericalLight(
  order: number,
  pos: Vector3,
  radius: number,
  color: Vector4,
  resultR: Float32Array,
  resultG: Float32Array,
  resultB: Float32Array
): boolean {
  if (!resultR) return false;

  if (radius < 0) return false;

  const fDist = pos.magnitude;

  // WARNING: fDist should not be < radius - otherwise light contains origin

  //const float fSinConeAngle = (fDist <= radius) ? 0.99999f : radius/fDist;
  const fConeAngle = fDist <= radius ? XM_PIDIV2 : asinf(radius / fDist);

  const dir = Vector3.normalize(pos);
  const fTmpDir = new Float32Array(SH_MAXORDER * SH_MAXORDER);
  const fTmpL0 = new Float32Array(SH_MAXORDER);

  //
  // Sphere at distance fDist, the cone angle is determined by looking at the
  // right triangle with one side (the hypotenuse) beind the vector from the
  // origin to the center of the sphere, another side is from the origin to
  // a point on the sphere whose normal is perpendicular to the given side (this
  // is one of the points on the cone that is defined by the projection of the sphere
  // through the origin - we want to find the angle of this cone) and the final
  // side being from the center of the sphere to the point of tagency (the two
  // sides conected to this are at a right angle by construction.)
  // From trig we know that sin(theta) = ||opposite||/||hypotenuse||, where
  // ||opposite|| = Radius, ||hypotenuse|| = fDist
  // theta is the angle of the cone that subtends the sphere from the origin
  //

  // no default normalization is done for this case, have to be careful how
  // you represent the coefficients...

  const fNewNorm = 1.0; ///(fSinConeAngle*fSinConeAngle);

  ComputeCapInt(order, fConeAngle, fTmpL0);

  const vd = new Vector3(dir);

  const fX = vd.x;
  const fY = vd.y;
  const fZ = vd.z;

  switch (order) {
    case 2:
      sh_eval_basis_1(fX, fY, fZ, fTmpDir);
      break;

    case 3:
      sh_eval_basis_2(fX, fY, fZ, fTmpDir);
      break;

    case 4:
      sh_eval_basis_3(fX, fY, fZ, fTmpDir);
      break;

    case 5:
      sh_eval_basis_4(fX, fY, fZ, fTmpDir);
      break;

    case 6:
      sh_eval_basis_5(fX, fY, fZ, fTmpDir);
      break;

    default:
      return false;
  }

  const clr = color;

  for (let i = 0; i < order; ++i) {
    const cNumCoefs = 2 * i + 1;
    const cStart = i * i;
    const fValUse = fTmpL0[i] * clr.x * fNewNorm * fExtraNormFac[i];
    for (let j = 0; j < cNumCoefs; ++j) resultR[cStart + j] = fTmpDir[cStart + j] * fValUse;
  }

  if (resultG) {
    for (let i = 0; i < order; ++i) {
      const cNumCoefs = 2 * i + 1;
      const cStart = i * i;
      const fValUse = fTmpL0[i] * clr.y * fNewNorm * fExtraNormFac[i];
      for (let j = 0; j < cNumCoefs; ++j) resultG[cStart + j] = fTmpDir[cStart + j] * fValUse;
    }
  }

  if (resultB) {
    for (let i = 0; i < order; ++i) {
      const cNumCoefs = 2 * i + 1;
      const cStart = i * i;
      const fValUse = fTmpL0[i] * clr.z * fNewNorm * fExtraNormFac[i];
      for (let j = 0; j < cNumCoefs; ++j) resultB[cStart + j] = fTmpDir[cStart + j] * fValUse;
    }
  }

  return true;
}

//-------------------------------------------------------------------------------------
// Evaluates a light that is a cone of constant intensity and returns spectral
// SH data.  The output vector is computed so that if the intensity of R/G/B is
// unit the resulting exit radiance of a point directly under the light oriented
// in the cone direction on a diffuse object with an albedo of 1 would be 1.0.
// This will compute 3 spectral samples, resultR has to be specified, while resultG
// and resultB are optional.
//
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb204986.aspx
//-------------------------------------------------------------------------------------
/** @internal */
export function XMSHEvalConeLight(
  order: number,
  dir: Vector3,
  radius: number,
  color: Vector3,
  resultR: Float32Array,
  resultG: Float32Array,
  resultB: Float32Array
): boolean {
  if (!resultR) return false;

  if (radius < 0 || radius > XM_PI * 1.00001) return false;

  if (radius < 0.0001) {
    // turn it into a pure directional light...
    return XMSHEvalDirectionalLight(order, dir, color, resultR, resultG, resultB);
  } else {
    const fTmpL0 = new Float32Array(SH_MAXORDER);
    const fTmpDir = new Float32Array(SH_MAXORDER * SH_MAXORDER);

    const fConeAngle = radius;
    const fAngCheck = fConeAngle > XM_PIDIV2 ? XM_PIDIV2 : fConeAngle;

    const fNewNorm = 1.0 / (sinf(fAngCheck) * sinf(fAngCheck));

    ComputeCapInt(order, fConeAngle, fTmpL0);

    const vd = dir;

    const fX = vd.x;
    const fY = vd.y;
    const fZ = vd.z;

    switch (order) {
      case 2:
        sh_eval_basis_1(fX, fY, fZ, fTmpDir);
        break;

      case 3:
        sh_eval_basis_2(fX, fY, fZ, fTmpDir);
        break;

      case 4:
        sh_eval_basis_3(fX, fY, fZ, fTmpDir);
        break;

      case 5:
        sh_eval_basis_4(fX, fY, fZ, fTmpDir);
        break;

      case 6:
        sh_eval_basis_5(fX, fY, fZ, fTmpDir);
        break;

      default:
        return false;
    }

    const clr = color;

    for (let i = 0; i < order; ++i) {
      const cNumCoefs = 2 * i + 1;
      const cStart = i * i;
      const fValUse = fTmpL0[i] * clr.x * fNewNorm * fExtraNormFac[i];
      for (let j = 0; j < cNumCoefs; ++j) resultR[cStart + j] = fTmpDir[cStart + j] * fValUse;
    }

    if (resultG) {
      for (let i = 0; i < order; ++i) {
        const cNumCoefs = 2 * i + 1;
        const cStart = i * i;
        const fValUse = fTmpL0[i] * clr.y * fNewNorm * fExtraNormFac[i];
        for (let j = 0; j < cNumCoefs; ++j) resultG[cStart + j] = fTmpDir[cStart + j] * fValUse;
      }
    }

    if (resultB) {
      for (let i = 0; i < order; ++i) {
        const cNumCoefs = 2 * i + 1;
        const cStart = i * i;
        const fValUse = fTmpL0[i] * clr.z * fNewNorm * fExtraNormFac[i];
        for (let j = 0; j < cNumCoefs; ++j) resultB[cStart + j] = fTmpDir[cStart + j] * fValUse;
      }
    }
  }

  return true;
}

//------------------------------------------------------------------------------------
// Evaluates a light that is a linear interpolant between two colors over the
// sphere.  The interpolant is linear along the axis of the two points, not
// over the surface of the sphere (ie: if the axis was (0,0,1) it is linear in
// Z, not in the azimuthal angle.)  The resulting spherical lighting function
// is normalized so that a point on a perfectly diffuse surface with no
// shadowing and a normal pointed in the direction pDir would result in exit
// radiance with a value of 1 if the top color was white and the bottom color
// was black.  This is a very simple model where topColor represents the intensity
// of the "sky" and bottomColor represents the intensity of the "ground".
//
// http://msdn.microsoft.com/en-us/library/windows/desktop/bb204989.aspx
//-------------------------------------------------------------------------------------
/** @internal */
export function XMSHEvalHemisphereLight(
  order: number,
  dir: Vector3,
  topColor: Vector3,
  bottomColor: Vector3,
  resultR: Float32Array,
  resultG: Float32Array,
  resultB: Float32Array
): boolean {
  if (!resultR) return false;

  if (order < SH_MINORDER || order > SH_MAXORDER) return false;

  // seperate "R/G/B colors...

  const fTmpDir = new Float32Array(SH_MAXORDER * SH_MAXORDER); // rotation "vector"
  const fTmpL0 = new Float32Array(SH_MAXORDER);

  const fNewNorm = 3.0 / 2.0; // normalizes things for 1 sky color, 0 ground color...

  const vd = dir;

  const fX = vd.x;
  const fY = vd.y;
  const fZ = vd.z;

  sh_eval_basis_1(fX, fY, fZ, fTmpDir);

  const clrTop = topColor;

  const clrBottom = bottomColor;

  let fA = clrTop.x;
  let fAvrg = (clrTop.x + clrBottom.x) * 0.5;

  fTmpL0[0] = fAvrg * 2.0 * SHEvalHemisphereLight_fSqrtPi;
  fTmpL0[1] = (fA - fAvrg) * 2.0 * SHEvalHemisphereLight_fSqrtPi3;

  let i = 0;
  for (; i < 2; ++i) {
    const cNumCoefs = 2 * i + 1;
    const cStart = i * i;
    const fValUse = fTmpL0[i] * fNewNorm * fExtraNormFac[i];
    for (let j = 0; j < cNumCoefs; ++j) resultR[cStart + j] = fTmpDir[cStart + j] * fValUse;
  }

  for (; i < order; ++i) {
    const cNumCoefs = 2 * i + 1;
    const cStart = i * i;
    for (let j = 0; j < cNumCoefs; ++j) resultR[cStart + j] = 0.0;
  }

  if (resultG) {
    fA = clrTop.y;
    fAvrg = (clrTop.y + clrBottom.y) * 0.5;

    fTmpL0[0] = fAvrg * 2.0 * SHEvalHemisphereLight_fSqrtPi;
    fTmpL0[1] = (fA - fAvrg) * 2.0 * SHEvalHemisphereLight_fSqrtPi3;

    for (i = 0; i < 2; ++i) {
      const cNumCoefs = 2 * i + 1;
      const cStart = i * i;
      const fValUse = fTmpL0[i] * fNewNorm * fExtraNormFac[i];
      for (let j = 0; j < cNumCoefs; ++j) resultG[cStart + j] = fTmpDir[cStart + j] * fValUse;
    }

    for (; i < order; ++i) {
      const cNumCoefs = 2 * i + 1;
      const cStart = i * i;
      for (let j = 0; j < cNumCoefs; ++j) resultG[cStart + j] = 0.0;
    }
  }

  if (resultB) {
    fA = clrTop.z;
    fAvrg = (clrTop.z + clrBottom.z) * 0.5;

    fTmpL0[0] = fAvrg * 2.0 * SHEvalHemisphereLight_fSqrtPi;
    fTmpL0[1] = (fA - fAvrg) * 2.0 * SHEvalHemisphereLight_fSqrtPi3;

    for (i = 0; i < 2; ++i) {
      const cNumCoefs = 2 * i + 1;
      const cStart = i * i;
      const fValUse = fTmpL0[i] * fNewNorm * fExtraNormFac[i];
      for (let j = 0; j < cNumCoefs; ++j) resultB[cStart + j] = fTmpDir[cStart + j] * fValUse;
    }

    for (; i < order; ++i) {
      const cNumCoefs = 2 * i + 1;
      const cStart = i * i;
      for (let j = 0; j < cNumCoefs; ++j) resultB[cStart + j] = 0.0;
    }
  }

  return true;
}
