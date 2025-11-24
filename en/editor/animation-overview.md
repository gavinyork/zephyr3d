
# Animation Overview

The Zephyr3D engine provides rich animation capabilities for objects in scenes, used to represent dynamic effects such as character actions, object deformations, and property changes over time. This chapter provides an overall introduction to Zephyr3D's animation types and basic concepts, and explains the functionality related to keyframe animation in the editor.

## Supported Animation Types

Zephyr3D currently supports the following three main animation types:

1. Skeletal Animation

Skeletal animation drives mesh vertices through "bones (skeleton)" to achieve complex character or deformable object action representation, such as:

  - Character walking, running, attacking
  - Full-body actions of monsters, animals, NPCs
  - Deformable models that require joint movement (robotic arms, wings, etc.)

**Characteristics**:

  - Animation data is stored in bone joint transformations (position, rotation, scale)
  - The same skeleton can drive multiple models sharing the same bone structure, enabling animation reuse
  - Suitable for complex character animations and scenarios requiring masking/blending (e.g., upper body attacking while lower body running)

2. Vertex Animation

Vertex animation directly records the deformation results of mesh vertices at each frame, used to represent deformations that are difficult or inefficient to achieve with skeletons, such as:

  - Dynamic deformations of soft objects (jelly, cloth)
  - Complex surface fluctuations (e.g., specific forms of water surfaces, viscous fluids)
  - Pre-baked effect model deformations

**Characteristics**:

  - Each frame records vertex positions (sometimes including normal information)
  - During playback, interpolation or switching occurs directly at the vertex level
  - CPU-friendly, suitable for batch instanced playback of pre-baked animations on GPU
  - Not suitable for drastically modifying action logic of the same model at runtime (actions are pre-baked)

3. Keyframe Animation

Keyframe animation creates continuous animation effects by setting "keyframes" on a timeline, recording property values at certain time points, with the system interpolating between keyframes.
In Zephyr3D, keyframe animation is typically used for:

  - Node position/rotation/scale changing over time (e.g., door opening/closing, camera movement)
  - Custom property changes over time (e.g., light intensity, lens parameters, depending on actual implementation)

**Characteristics**:

  - Uses keyframe editor for direct visual manipulation on timeline
  - Easy to create simple object movements, camera trajectories, and cutscene animations
  - Can be used together with skeletal and vertex animations to add additional dynamic effects to objects and cameras in the scene

## Binding Relationship Between Animations and Nodes

In Zephyr3D, animations are managed and played by binding to nodes.

- All visible/controllable objects in the scene (e.g., models, lights, cameras, empty nodes, etc.) exist in the scene tree as "nodes."
- Animation resources (skeletal animation, vertex animation, keyframe animation) are associated with a node:
- Skeletal Animation: Usually bound to model nodes containing skeletons;
- Vertex Animation: Bound to mesh nodes with corresponding vertex animation data;
- Keyframe Animation: Can be bound to any node to drive that node's transformation or custom properties.

Examples of behavior after binding:

- Playing skeletal animation on a character node → The character model deforms along with the bone actions;
- Playing keyframe animation on a scene object node → The object's position/rotation/scale changes according to the timeline;
- Playing keyframe animation on a camera node → The camera moves along the set path, achieving cutscene shots or flythrough effects.
