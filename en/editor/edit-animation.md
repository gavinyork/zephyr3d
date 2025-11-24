
# Editing Animation

This chapter introduces how to create, manage, and edit animations for nodes in the Zephyr3D editor.
Before starting with specific steps, let's first understand several core objects related to animation in Zephyr3D.

---

## 1. Animation Data Structure Overview

In Zephyr3D, each node has an AnimationSet container object that manages all animation resources related to that node.

- `AnimationSet`

    - Mounted on a single node;
    - Serves as a collection container for all animations of that node.

- `AnimationClip`

    - Represents a complete animation segment, such as: Door_Open, Camera_Move_01;
    - Each `AnimationClip` can contain multiple tracks.

- `AnimationTrack`

    - Represents an animation track for a specific property, such as:

        - Position track
        - Rotation track
        - Scale track
        - Custom numeric/color property tracks, etc.

    - Each track consists of multiple keyframes that describe how the property changes over time.

The relationship can be summarized as:

- Each node → has one AnimationSet
- AnimationSet → contains multiple AnimationClips
- Each AnimationClip → contains one or more AnimationTracks
- Each AnimationTrack → binds to an animatable property on that node

---

## 2. Basic Workflow for Creating Animation Tracks

In the editor, animations are created starting from "properties":
You first select a node, then create a corresponding AnimationTrack for a field that supports animation in the Properties panel.

Below is the complete operation process.

**Step 1: Select the node to bind animation to**

  1. In the scene hierarchy/view, select the node you want to add animation to.
  2. The Properties panel will display all editable properties of that node (such as position, rotation, scale, light parameters, etc.).

  > Note: Animations are bound to the AnimationSet of that node, so make sure you have selected the target node itself

---

**Step 2: Find animatable properties in the Properties panel**

In the Properties panel, all property fields that support generating animation tracks will have a button titled `A` on the left side:

- This button indicates:
  > "This property can create an animation track (`AnimationTrack`)"
- Properties without the `A` button do not currently support creating animation tracks directly.

Operation method:

  1. In the Properties panel, locate the property you want to add animation to.
  2. Confirm that the `A` button exists on the left side of that property.

---

**Step 3: Click the A button to create a track**

  1. Click the `A` button on the left side of the property.
  2. The editor will pop up the Create Track dialog box for configuring the animation track corresponding to this property.

In the Create Track dialog box, you can:

- Select an existing animation (`AnimationClip`) bound to this node
    - Choose from the dropdown list one of the existing Clips in the node's AnimationSet;
    - The new track will be added to that existing Clip.
- Or create a new animation (`AnimationClip`)
    - Enter the name of the new animation clip (e.g., Door_Open, Light_Flicker, etc.);
    - The editor will create a new AnimationClip in the node's AnimationSet.

At the same time, you need to:

- Enter the name of this track
    - Used to identify the track in the animation/properties panel;
    - Recommended to use descriptive naming, such as:
        - PosY_MoveUp
        - Intensity_Pulse
        - Door_RotateY, etc.

After confirming everything is correct, click the [Confirm] button:

- A new AnimationTrack will be created in the selected AnimationClip;
- This track will be bound to the current property.

---

**Step 4: Select the track in the Properties panel and open the editor**

After the track is created successfully:

1. In the animation property section of the Properties panel, you can see one or more animation tracks associated with that property.
2. Select the track you just created here.
3. Click the [Edit] button (an edit icon).

After performing the above operations, the Track Editor window will pop up.

> The Track Editor is a tool interface specifically designed for editing the timeline and keyframes of that AnimationTrack.

---

**Step 5: Create / Edit / Delete keyframes in the Track Editor**

In the Track Editor, you can perform complete keyframe editing operations on this `AnimationTrack`, including:

- Adjust curve properties (for non-color tracks)

    - Expand the `Curve Settings` panel
    - Adjust the property value range (minimum value, maximum value), which affects the curve display
    - Adjust the curve interpolation type (`Linear`, `Step`, `CubicSpline`), which affects the curve interpolation calculation

- Create keyframes

    - Click on the timeline window to create a keyframe at that moment
    - The property value at the current time point will be recorded in the AnimationTrack, forming a new keyframe.

- Edit keyframes

    - Select a keyframe on the track timeline:
    - Drag the keyframe left or right to adjust its time;
    - Adjust the current value of the property in the main editing interface (e.g., moving the node) or modify the specific value of the keyframe in the property/value panel;

- Delete keyframes

    - Right-click on a keyframe to delete it

- Animation effect preview

    - Drag the red vertical line in the Track Editor to preview the animation effect

---

**Step 6: Play the created animation**

You can play animations in two ways:

- In the Properties Editor panel, set the animation to auto-play when selected, so that when the node finishes loading, it will automatically loop the specified animation.
- Manually play in code:
```ts
node.animationSet.playAnimation('Transform');
```

---

<video src="https://cdn.zephyr3d.org/doc/assets/videos/create-animation.mp4" controls width="640">
  Your browser does not support the video tag.
</video>
