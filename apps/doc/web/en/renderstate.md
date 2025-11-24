# Rendering states

We use the [RenderStateSet](/doc/markdown/./device.renderstateset) interface to manage rendering states. 

```javascript

// Creates an object that manage rendering states
const renderStateSet = device.createRenderStateSet();

// Customize the AlphaBlending state, if not called, The default value will be used.
const blendingState = renderStateSet.useBlendingState();
blendingState.enable(true).setBlendFunc('one', 'one');

// Customize the depth state.
const depthState = renderStateSet.useDepthState();
depthState.enableTest(false).enableWrite(false);

// Set to the current render state before rendering.
device.setRenderStates(renderStateSet);

```

Note: We do not support setting the vertex winding order (CW/CCW) state. If reversal is needed, call [Device.reverseVertexWindingOrder()](/doc/markdown/./device.abstractdevice.reversevertexwindingorder).
