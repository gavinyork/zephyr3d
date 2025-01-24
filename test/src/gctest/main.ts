import { Vector4 } from '@zephyr3d/base';
import { Application, isRef, makeRef, Ref } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

class GCTestObject {
  static _numObjects = 0;
  constructor() {
    GCTestObject._numObjects++;
  }
  dispose() {
    GCTestObject._numObjects--;
  }
}

class GCTestObjectContainer {
  private _object: Ref<GCTestObject>;
  constructor() {
    this._object = null;
  }
  get object(): Ref<GCTestObject> {
    return this._object;
  }
  set object(val: GCTestObject | Ref<GCTestObject>) {
    const obj = makeRef(val);
    if (obj !== this._object) {
      if (obj) {
        obj.ref();
      }
      if (this._object) {
        this._object.unref();
      }
      this._object = obj;
    }
  }
}

const container = new GCTestObjectContainer();

function testGC() {
  const obj = new GCTestObject();
  container.object = obj;
}

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#canvas')
});

myApp.ready().then(async function () {
  myApp.on('tick', function () {
    testGC();
    myApp.device.clearFrameBuffer(new Vector4(0, 0, 0, 1), 1, 0);
    myApp.device.drawText(`${GCTestObject._numObjects} objects`, 20, 20, '#ffffff');
  });
  myApp.run();
});
