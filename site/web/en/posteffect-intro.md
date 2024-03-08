# Post Processing

Post-processing allows you to add 2D effects to images after the scene has been rendered.

We manage post-processing effects using the [Compositor](/doc/markdown/./scene.compositor) object. The Compositor can add multiple post-processing effects, each taking the rendering result of the previous one as input, forming a chain of calls. During rendering, simply use the Compositor object as the second argument in the Camera.render() function.

Our post-processing effects are divided into two groups: Opaque and Transparent. The Opaque group is called after rendering opaque objects but before rendering transparent objects. The Transparent group is called after both transparent and opaque objects have been rendered. Each post-processing effect is defaulted to either the Opaque or Transparent group based on its application. Within each group, the order of effect calls follows the order in which they were added.

