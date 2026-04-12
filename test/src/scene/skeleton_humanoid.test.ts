import { HumanoidBodyRig, HumanoidHandRig, SceneNode, Skeleton } from '@zephyr3d/scene';

function appendNode(parent: SceneNode, name: string) {
  const node = new SceneNode(null);
  node.name = name;
  node.reparent(parent);
  return node;
}

function appendFingerChain(hand: SceneNode, names: [string, string, string], out: Record<string, SceneNode>) {
  const proximal = appendNode(hand, names[0]);
  const intermediate = appendNode(proximal, names[1]);
  const distal = appendNode(intermediate, names[2]);
  out[names[0]] = proximal;
  out[names[1]] = intermediate;
  out[names[2]] = distal;
}

function buildMixamoSkeleton() {
  const nodes: Record<string, SceneNode> = {};
  const root = new SceneNode(null);
  root.name = 'Armature';
  nodes.Armature = root;

  const hips = appendNode(root, 'mixamorig:Hips');
  const spine = appendNode(hips, 'mixamorig:Spine');
  const chest = appendNode(spine, 'mixamorig:Spine1');
  const upperChest = appendNode(chest, 'mixamorig:Spine2');
  const neck = appendNode(upperChest, 'mixamorig:Neck');
  const head = appendNode(neck, 'mixamorig:Head');
  nodes['mixamorig:Hips'] = hips;
  nodes['mixamorig:Spine'] = spine;
  nodes['mixamorig:Spine1'] = chest;
  nodes['mixamorig:Spine2'] = upperChest;
  nodes['mixamorig:Neck'] = neck;
  nodes['mixamorig:Head'] = head;

  for (const side of ['Left', 'Right'] as const) {
    const shoulder = appendNode(upperChest, `mixamorig:${side}Shoulder`);
    const upperArm = appendNode(shoulder, `mixamorig:${side}Arm`);
    const lowerArm = appendNode(upperArm, `mixamorig:${side}ForeArm`);
    const hand = appendNode(lowerArm, `mixamorig:${side}Hand`);
    const upperLeg = appendNode(hips, `mixamorig:${side}UpLeg`);
    const lowerLeg = appendNode(upperLeg, `mixamorig:${side}Leg`);
    const foot = appendNode(lowerLeg, `mixamorig:${side}Foot`);
    const toes = appendNode(foot, `mixamorig:${side}ToeBase`);

    nodes[`mixamorig:${side}Shoulder`] = shoulder;
    nodes[`mixamorig:${side}Arm`] = upperArm;
    nodes[`mixamorig:${side}ForeArm`] = lowerArm;
    nodes[`mixamorig:${side}Hand`] = hand;
    nodes[`mixamorig:${side}UpLeg`] = upperLeg;
    nodes[`mixamorig:${side}Leg`] = lowerLeg;
    nodes[`mixamorig:${side}Foot`] = foot;
    nodes[`mixamorig:${side}ToeBase`] = toes;

    appendFingerChain(
      hand,
      [`mixamorig:${side}HandThumb1`, `mixamorig:${side}HandThumb2`, `mixamorig:${side}HandThumb3`],
      nodes
    );
    appendFingerChain(
      hand,
      [`mixamorig:${side}HandIndex1`, `mixamorig:${side}HandIndex2`, `mixamorig:${side}HandIndex3`],
      nodes
    );
    appendFingerChain(
      hand,
      [`mixamorig:${side}HandMiddle1`, `mixamorig:${side}HandMiddle2`, `mixamorig:${side}HandMiddle3`],
      nodes
    );
    appendFingerChain(
      hand,
      [`mixamorig:${side}HandRing1`, `mixamorig:${side}HandRing2`, `mixamorig:${side}HandRing3`],
      nodes
    );
    appendFingerChain(
      hand,
      [`mixamorig:${side}HandPinky1`, `mixamorig:${side}HandPinky2`, `mixamorig:${side}HandPinky3`],
      nodes
    );
  }

  return { root, nodes };
}

function buildVRMSkeleton() {
  const nodes: Record<string, SceneNode> = {};
  const root = new SceneNode(null);
  root.name = 'VRMRoot';
  nodes.VRMRoot = root;

  const hips = appendNode(root, 'J_Bip_C_Hips');
  const spine = appendNode(hips, 'J_Bip_C_Spine');
  const chest = appendNode(spine, 'J_Bip_C_Chest');
  const upperChest = appendNode(chest, 'J_Bip_C_UpperChest');
  const neck = appendNode(upperChest, 'J_Bip_C_Neck');
  const head = appendNode(neck, 'J_Bip_C_Head');
  nodes.J_Bip_C_Hips = hips;
  nodes.J_Bip_C_Spine = spine;
  nodes.J_Bip_C_Chest = chest;
  nodes.J_Bip_C_UpperChest = upperChest;
  nodes.J_Bip_C_Neck = neck;
  nodes.J_Bip_C_Head = head;

  for (const side of ['L', 'R'] as const) {
    const shoulder = appendNode(upperChest, `J_Bip_${side}_Shoulder`);
    const upperArm = appendNode(shoulder, `J_Bip_${side}_UpperArm`);
    const lowerArm = appendNode(upperArm, `J_Bip_${side}_LowerArm`);
    const hand = appendNode(lowerArm, `J_Bip_${side}_Hand`);
    const upperLeg = appendNode(hips, `J_Bip_${side}_UpperLeg`);
    const lowerLeg = appendNode(upperLeg, `J_Bip_${side}_LowerLeg`);
    const foot = appendNode(lowerLeg, `J_Bip_${side}_Foot`);
    const toes = appendNode(foot, `J_Bip_${side}_ToeBase`);

    nodes[`J_Bip_${side}_Shoulder`] = shoulder;
    nodes[`J_Bip_${side}_UpperArm`] = upperArm;
    nodes[`J_Bip_${side}_LowerArm`] = lowerArm;
    nodes[`J_Bip_${side}_Hand`] = hand;
    nodes[`J_Bip_${side}_UpperLeg`] = upperLeg;
    nodes[`J_Bip_${side}_LowerLeg`] = lowerLeg;
    nodes[`J_Bip_${side}_Foot`] = foot;
    nodes[`J_Bip_${side}_ToeBase`] = toes;

    appendFingerChain(hand, [`J_Bip_${side}_Thumb1`, `J_Bip_${side}_Thumb2`, `J_Bip_${side}_Thumb3`], nodes);
    appendFingerChain(hand, [`J_Bip_${side}_Index1`, `J_Bip_${side}_Index2`, `J_Bip_${side}_Index3`], nodes);
    appendFingerChain(
      hand,
      [`J_Bip_${side}_Middle1`, `J_Bip_${side}_Middle2`, `J_Bip_${side}_Middle3`],
      nodes
    );
    appendFingerChain(hand, [`J_Bip_${side}_Ring1`, `J_Bip_${side}_Ring2`, `J_Bip_${side}_Ring3`], nodes);
    appendFingerChain(
      hand,
      [`J_Bip_${side}_Little1`, `J_Bip_${side}_Little2`, `J_Bip_${side}_Little3`],
      nodes
    );
  }

  return { root, nodes };
}

function buildUnityHumanoidSkeleton() {
  const nodes: Record<string, SceneNode> = {};
  const root = new SceneNode(null);
  root.name = 'UnityRoot';
  nodes.UnityRoot = root;

  const hips = appendNode(root, 'Hips');
  const spine = appendNode(hips, 'Spine');
  const chest = appendNode(spine, 'Chest');
  const upperChest = appendNode(chest, 'UpperChest');
  const neck = appendNode(upperChest, 'Neck');
  const head = appendNode(neck, 'Head');
  nodes.Hips = hips;
  nodes.Spine = spine;
  nodes.Chest = chest;
  nodes.UpperChest = upperChest;
  nodes.Neck = neck;
  nodes.Head = head;

  for (const side of ['Left', 'Right'] as const) {
    const shoulder = appendNode(upperChest, `${side}Shoulder`);
    const upperArm = appendNode(shoulder, `${side}UpperArm`);
    const lowerArm = appendNode(upperArm, `${side}LowerArm`);
    const hand = appendNode(lowerArm, `${side}Hand`);
    const upperLeg = appendNode(hips, `${side}UpperLeg`);
    const lowerLeg = appendNode(upperLeg, `${side}LowerLeg`);
    const foot = appendNode(lowerLeg, `${side}Foot`);
    const toes = appendNode(foot, `${side}Toes`);

    nodes[`${side}Shoulder`] = shoulder;
    nodes[`${side}UpperArm`] = upperArm;
    nodes[`${side}LowerArm`] = lowerArm;
    nodes[`${side}Hand`] = hand;
    nodes[`${side}UpperLeg`] = upperLeg;
    nodes[`${side}LowerLeg`] = lowerLeg;
    nodes[`${side}Foot`] = foot;
    nodes[`${side}Toes`] = toes;

    appendFingerChain(
      hand,
      [`${side}ThumbProximal`, `${side}ThumbIntermediate`, `${side}ThumbDistal`],
      nodes
    );
    appendFingerChain(
      hand,
      [`${side}IndexProximal`, `${side}IndexIntermediate`, `${side}IndexDistal`],
      nodes
    );
    appendFingerChain(
      hand,
      [`${side}MiddleProximal`, `${side}MiddleIntermediate`, `${side}MiddleDistal`],
      nodes
    );
    appendFingerChain(hand, [`${side}RingProximal`, `${side}RingIntermediate`, `${side}RingDistal`], nodes);
    appendFingerChain(
      hand,
      [`${side}PinkyProximal`, `${side}PinkyIntermediate`, `${side}PinkyDistal`],
      nodes
    );
  }

  return { root, nodes };
}

function buildHumanoidSkeletonWithDecoyTorsoChain() {
  const root = new SceneNode(null);
  root.name = 'HumanoidRoot';

  const hips = appendNode(root, 'BodyHips');
  const spine = appendNode(hips, 'BodySpine');
  const chest = appendNode(spine, 'BodyChest');
  const upperChest = appendNode(chest, 'BodyUpperChest');
  const neck = appendNode(upperChest, 'BodyNeck');
  appendNode(neck, 'BodyHead');

  for (const side of ['Left', 'Right'] as const) {
    const shoulder = appendNode(upperChest, `Body${side}Shoulder`);
    const upperArm = appendNode(shoulder, `Body${side}UpperArm`);
    const lowerArm = appendNode(upperArm, `Body${side}LowerArm`);
    const hand = appendNode(lowerArm, `Body${side}Hand`);
    const upperLeg = appendNode(hips, `Body${side}UpperLeg`);
    const lowerLeg = appendNode(upperLeg, `Body${side}LowerLeg`);
    const foot = appendNode(lowerLeg, `Body${side}Foot`);
    appendNode(foot, `Body${side}Toes`);

    appendFingerChain(
      hand,
      [`Body${side}ThumbProximal`, `Body${side}ThumbIntermediate`, `Body${side}ThumbDistal`],
      {}
    );
    appendFingerChain(
      hand,
      [`Body${side}IndexProximal`, `Body${side}IndexIntermediate`, `Body${side}IndexDistal`],
      {}
    );
    appendFingerChain(
      hand,
      [`Body${side}MiddleProximal`, `Body${side}MiddleIntermediate`, `Body${side}MiddleDistal`],
      {}
    );
    appendFingerChain(
      hand,
      [`Body${side}RingProximal`, `Body${side}RingIntermediate`, `Body${side}RingDistal`],
      {}
    );
    appendFingerChain(
      hand,
      [`Body${side}PinkyProximal`, `Body${side}PinkyIntermediate`, `Body${side}PinkyDistal`],
      {}
    );
  }

  const decoySpine = appendNode(root, 'Spine');
  const decoyChest = appendNode(decoySpine, 'Chest');
  const decoyUpperChest = appendNode(decoyChest, 'UpperChest');
  const decoyNeck = appendNode(decoyUpperChest, 'Neck');
  appendNode(decoyNeck, 'Head');

  return root;
}

function buildBipedSkeleton() {
  const nodes: Record<string, SceneNode> = {};
  const root = new SceneNode(null);
  root.name = 'BipedRoot';
  nodes.BipedRoot = root;

  const hips = appendNode(root, 'Bip001 Pelvis');
  const spine = appendNode(hips, 'Bip001 Spine');
  const chest = appendNode(spine, 'Bip001 Spine1');
  const upperChest = appendNode(chest, 'Bip001 Spine2');
  const neck = appendNode(upperChest, 'Bip001 Neck');
  const head = appendNode(neck, 'Bip001 Head');
  nodes['Bip001 Pelvis'] = hips;
  nodes['Bip001 Spine'] = spine;
  nodes['Bip001 Spine1'] = chest;
  nodes['Bip001 Spine2'] = upperChest;
  nodes['Bip001 Neck'] = neck;
  nodes['Bip001 Head'] = head;

  for (const side of ['L', 'R'] as const) {
    const shoulder = appendNode(upperChest, `Bip001 ${side} Clavicle`);
    const upperArm = appendNode(shoulder, `Bip001 ${side} UpperArm`);
    const lowerArm = appendNode(upperArm, `Bip001 ${side} Forearm`);
    const hand = appendNode(lowerArm, `Bip001 ${side} Hand`);
    const upperLeg = appendNode(hips, `Bip001 ${side} Thigh`);
    const lowerLeg = appendNode(upperLeg, `Bip001 ${side} Calf`);
    const foot = appendNode(lowerLeg, `Bip001 ${side} Foot`);
    const toes = appendNode(foot, `Bip001 ${side} Toe0`);

    nodes[`Bip001 ${side} Clavicle`] = shoulder;
    nodes[`Bip001 ${side} UpperArm`] = upperArm;
    nodes[`Bip001 ${side} Forearm`] = lowerArm;
    nodes[`Bip001 ${side} Hand`] = hand;
    nodes[`Bip001 ${side} Thigh`] = upperLeg;
    nodes[`Bip001 ${side} Calf`] = lowerLeg;
    nodes[`Bip001 ${side} Foot`] = foot;
    nodes[`Bip001 ${side} Toe0`] = toes;

    appendFingerChain(
      hand,
      [`Bip001 ${side} Finger0`, `Bip001 ${side} Finger01`, `Bip001 ${side} Finger02`],
      nodes
    );
    appendFingerChain(
      hand,
      [`Bip001 ${side} Finger1`, `Bip001 ${side} Finger11`, `Bip001 ${side} Finger12`],
      nodes
    );
    appendFingerChain(
      hand,
      [`Bip001 ${side} Finger2`, `Bip001 ${side} Finger21`, `Bip001 ${side} Finger22`],
      nodes
    );
    appendFingerChain(
      hand,
      [`Bip001 ${side} Finger3`, `Bip001 ${side} Finger31`, `Bip001 ${side} Finger32`],
      nodes
    );
    appendFingerChain(
      hand,
      [`Bip001 ${side} Finger4`, `Bip001 ${side} Finger41`, `Bip001 ${side} Finger42`],
      nodes
    );
  }

  return { root, nodes };
}

function buildBipedSuffixSkeleton() {
  const nodes: Record<string, SceneNode> = {};
  const root = new SceneNode(null);
  root.name = 'Bip001_01';
  nodes['Bip001_01'] = root;

  const hips = appendNode(root, 'Bip001 Pelvis_02');
  const spine = appendNode(hips, 'Bip001 Spine_03');
  const neck = appendNode(spine, 'Bip001 Neck_04');
  const head = appendNode(neck, 'Bip001 Head_05');
  nodes['Bip001 Pelvis_02'] = hips;
  nodes['Bip001 Spine_03'] = spine;
  nodes['Bip001 Neck_04'] = neck;
  nodes['Bip001 Head_05'] = head;

  for (const side of ['L', 'R'] as const) {
    const upperLeg = appendNode(hips, `Bip001 ${side} Thigh_10`);
    const lowerLeg = appendNode(upperLeg, `Bip001 ${side} Calf_11`);
    const foot = appendNode(lowerLeg, `Bip001 ${side} Foot_12`);
    const toes = appendNode(foot, `Bip001 ${side} Toe0_13`);
    const shoulder = appendNode(spine, `Bip001 ${side} Clavicle_20`);
    const upperArm = appendNode(shoulder, `Bip001 ${side} UpperArm_21`);
    const lowerArm = appendNode(upperArm, `Bip001 ${side} Forearm_22`);
    const hand = appendNode(lowerArm, `Bip001 ${side} Hand_23`);

    nodes[`Bip001 ${side} Thigh_10`] = upperLeg;
    nodes[`Bip001 ${side} Calf_11`] = lowerLeg;
    nodes[`Bip001 ${side} Foot_12`] = foot;
    nodes[`Bip001 ${side} Toe0_13`] = toes;
    nodes[`Bip001 ${side} Clavicle_20`] = shoulder;
    nodes[`Bip001 ${side} UpperArm_21`] = upperArm;
    nodes[`Bip001 ${side} Forearm_22`] = lowerArm;
    nodes[`Bip001 ${side} Hand_23`] = hand;

    appendFingerChain(
      hand,
      [`Bip001 ${side} Finger0_30`, `Bip001 ${side} Finger01_31`, `Bip001 ${side} Finger02_32`],
      nodes
    );
    appendFingerChain(
      hand,
      [`Bip001 ${side} Finger1_33`, `Bip001 ${side} Finger11_34`, `Bip001 ${side} Finger12_35`],
      nodes
    );
    appendFingerChain(
      hand,
      [`Bip001 ${side} Finger2_36`, `Bip001 ${side} Finger21_37`, `Bip001 ${side} Finger22_38`],
      nodes
    );
    appendFingerChain(
      hand,
      [`Bip001 ${side} Finger3_39`, `Bip001 ${side} Finger31_40`, `Bip001 ${side} Finger32_41`],
      nodes
    );
    appendFingerChain(
      hand,
      [`Bip001 ${side} Finger4_42`, `Bip001 ${side} Finger41_43`, `Bip001 ${side} Finger42_44`],
      nodes
    );
  }

  return { root, nodes };
}

function buildBipedBodyOnlySkeleton() {
  const root = new SceneNode(null);
  root.name = 'Bip001_01';

  const hips = appendNode(root, 'Bip001 Pelvis_02');
  const spine = appendNode(hips, 'Bip001 Spine_03');
  const neck = appendNode(spine, 'Bip001 Neck_04');
  appendNode(neck, 'Bip001 Head_05');

  for (const side of ['L', 'R'] as const) {
    const upperLeg = appendNode(hips, `Bip001 ${side} Thigh_10`);
    const lowerLeg = appendNode(upperLeg, `Bip001 ${side} Calf_11`);
    const foot = appendNode(lowerLeg, `Bip001 ${side} Foot_12`);
    appendNode(foot, `Bip001 ${side} Toe0_13`);
    const shoulder = appendNode(spine, `Bip001 ${side} Clavicle_20`);
    const upperArm = appendNode(shoulder, `Bip001 ${side} UpperArm_21`);
    const lowerArm = appendNode(upperArm, `Bip001 ${side} Forearm_22`);
    appendNode(lowerArm, `Bip001 ${side} Hand_23`);
  }

  return root;
}

function expectHumanoidExtraction(
  root: SceneNode,
  expected: {
    body: Partial<Record<HumanoidBodyRig, string>>;
    leftHand: Partial<Record<HumanoidHandRig, string>>;
    rightHand: Partial<Record<HumanoidHandRig, string>>;
  }
) {
  const result = Skeleton.tryExtractHumanoidJoints(root);
  expect(result).not.toBeNull();
  for (const [bone, name] of Object.entries(expected.body)) {
    expect(result!.body[bone as HumanoidBodyRig].name).toBe(name);
  }
  for (const [bone, name] of Object.entries(expected.leftHand)) {
    expect(result!.leftHand[bone as HumanoidHandRig].name).toBe(name);
  }
  for (const [bone, name] of Object.entries(expected.rightHand)) {
    expect(result!.rightHand[bone as HumanoidHandRig].name).toBe(name);
  }
}

describe('Skeleton.tryExtractHumanoidBones', () => {
  test('extracts Mixamo humanoid bones', () => {
    const { root } = buildMixamoSkeleton();
    expectHumanoidExtraction(root, {
      body: {
        [HumanoidBodyRig.Hips]: 'mixamorig:Hips',
        [HumanoidBodyRig.Chest]: 'mixamorig:Spine1',
        [HumanoidBodyRig.UpperChest]: 'mixamorig:Spine2',
        [HumanoidBodyRig.LeftUpperArm]: 'mixamorig:LeftArm',
        [HumanoidBodyRig.RightLowerLeg]: 'mixamorig:RightLeg'
      },
      leftHand: {
        [HumanoidHandRig.ThumbProximal]: 'mixamorig:LeftHandThumb1',
        [HumanoidHandRig.IndexIntermediate]: 'mixamorig:LeftHandIndex2',
        [HumanoidHandRig.PinkyDistal]: 'mixamorig:LeftHandPinky3'
      },
      rightHand: {
        [HumanoidHandRig.ThumbProximal]: 'mixamorig:RightHandThumb1',
        [HumanoidHandRig.MiddleIntermediate]: 'mixamorig:RightHandMiddle2',
        [HumanoidHandRig.RingDistal]: 'mixamorig:RightHandRing3'
      }
    });
  });

  test('extracts VRM humanoid bones', () => {
    const { root } = buildVRMSkeleton();
    expectHumanoidExtraction(root, {
      body: {
        [HumanoidBodyRig.Hips]: 'J_Bip_C_Hips',
        [HumanoidBodyRig.UpperChest]: 'J_Bip_C_UpperChest',
        [HumanoidBodyRig.LeftHand]: 'J_Bip_L_Hand',
        [HumanoidBodyRig.RightToes]: 'J_Bip_R_ToeBase'
      },
      leftHand: {
        [HumanoidHandRig.ThumbProximal]: 'J_Bip_L_Thumb1',
        [HumanoidHandRig.MiddleIntermediate]: 'J_Bip_L_Middle2',
        [HumanoidHandRig.PinkyDistal]: 'J_Bip_L_Little3'
      },
      rightHand: {
        [HumanoidHandRig.IndexProximal]: 'J_Bip_R_Index1',
        [HumanoidHandRig.RingIntermediate]: 'J_Bip_R_Ring2',
        [HumanoidHandRig.PinkyDistal]: 'J_Bip_R_Little3'
      }
    });
  });

  test('extracts Unity humanoid bones', () => {
    const { root } = buildUnityHumanoidSkeleton();
    expectHumanoidExtraction(root, {
      body: {
        [HumanoidBodyRig.Hips]: 'Hips',
        [HumanoidBodyRig.Chest]: 'Chest',
        [HumanoidBodyRig.LeftFoot]: 'LeftFoot',
        [HumanoidBodyRig.RightUpperArm]: 'RightUpperArm'
      },
      leftHand: {
        [HumanoidHandRig.ThumbProximal]: 'LeftThumbProximal',
        [HumanoidHandRig.IndexIntermediate]: 'LeftIndexIntermediate',
        [HumanoidHandRig.RingDistal]: 'LeftRingDistal'
      },
      rightHand: {
        [HumanoidHandRig.MiddleProximal]: 'RightMiddleProximal',
        [HumanoidHandRig.PinkyIntermediate]: 'RightPinkyIntermediate',
        [HumanoidHandRig.ThumbDistal]: 'RightThumbDistal'
      }
    });
  });

  test('extracts Biped humanoid bones', () => {
    const { root } = buildBipedSkeleton();
    expectHumanoidExtraction(root, {
      body: {
        [HumanoidBodyRig.Hips]: 'Bip001 Pelvis',
        [HumanoidBodyRig.UpperChest]: 'Bip001 Spine2',
        [HumanoidBodyRig.LeftShoulder]: 'Bip001 L Clavicle',
        [HumanoidBodyRig.RightToes]: 'Bip001 R Toe0'
      },
      leftHand: {
        [HumanoidHandRig.ThumbProximal]: 'Bip001 L Finger0',
        [HumanoidHandRig.IndexIntermediate]: 'Bip001 L Finger11',
        [HumanoidHandRig.PinkyDistal]: 'Bip001 L Finger42'
      },
      rightHand: {
        [HumanoidHandRig.ThumbIntermediate]: 'Bip001 R Finger01',
        [HumanoidHandRig.MiddleDistal]: 'Bip001 R Finger22',
        [HumanoidHandRig.RingProximal]: 'Bip001 R Finger3'
      }
    });
  });

  test('extracts Biped humanoid bones with numeric suffixes', () => {
    const { root } = buildBipedSuffixSkeleton();
    expectHumanoidExtraction(root, {
      body: {
        [HumanoidBodyRig.Hips]: 'Bip001 Pelvis_02',
        [HumanoidBodyRig.Spine]: 'Bip001 Spine_03',
        [HumanoidBodyRig.Chest]: 'Bip001 Spine_03',
        [HumanoidBodyRig.UpperChest]: 'Bip001 Spine_03',
        [HumanoidBodyRig.LeftUpperLeg]: 'Bip001 L Thigh_10',
        [HumanoidBodyRig.RightHand]: 'Bip001 R Hand_23'
      },
      leftHand: {
        [HumanoidHandRig.ThumbProximal]: 'Bip001 L Finger0_30',
        [HumanoidHandRig.IndexIntermediate]: 'Bip001 L Finger11_34',
        [HumanoidHandRig.PinkyDistal]: 'Bip001 L Finger42_44'
      },
      rightHand: {
        [HumanoidHandRig.ThumbIntermediate]: 'Bip001 R Finger01_31',
        [HumanoidHandRig.MiddleDistal]: 'Bip001 R Finger22_38',
        [HumanoidHandRig.RingProximal]: 'Bip001 R Finger3_39'
      }
    });
  });

  test('extracts body when hand bones are missing', () => {
    const root = buildBipedBodyOnlySkeleton();
    const result = Skeleton.tryExtractHumanoidJoints(root);
    expect(result).not.toBeNull();
    expect(result!.body[HumanoidBodyRig.Hips].name).toBe('Bip001 Pelvis_02');
    expect(result!.body[HumanoidBodyRig.LeftHand].name).toBe('Bip001 L Hand_23');
    expect(result!.body[HumanoidBodyRig.RightHand].name).toBe('Bip001 R Hand_23');
    expect(result!.leftHand).toBeUndefined();
    expect(result!.rightHand).toBeUndefined();
  });

  test('prefers the torso chain that is hierarchy-consistent with the limbs', () => {
    const root = buildHumanoidSkeletonWithDecoyTorsoChain();
    const result = Skeleton.tryExtractHumanoidJoints(root);
    expect(result).not.toBeNull();
    expect(result!.body[HumanoidBodyRig.Hips].name).toBe('BodyHips');
    expect(result!.body[HumanoidBodyRig.Spine].name).toBe('BodySpine');
    expect(result!.body[HumanoidBodyRig.Chest].name).toBe('BodyChest');
    expect(result!.body[HumanoidBodyRig.UpperChest].name).toBe('BodyUpperChest');
    expect(result!.body[HumanoidBodyRig.Neck].name).toBe('BodyNeck');
    expect(result!.body[HumanoidBodyRig.Head].name).toBe('BodyHead');
  });
});
