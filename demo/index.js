import { Application, getEngine } from '@zephyr3d/scene';

let backend = null;
backend = backend || (await import('@zephyr3d/backend-webgpu')).backendWebGPU;
if (!(await backend.supported())) {
    backend = null;
}
backend = backend || (await import('@zephyr3d/backend-webgl')).backendWebGL2;
if (!(await backend.supported())) {
    backend = null;
}
backend = backend || (await import('@zephyr3d/backend-webgl')).backendWebGL1;
if (!(await backend.supported())) {
    backend = null;
}
if (!backend) {
    throw new Error('No supported rendering device found');
}
const application = new Application({
    backend,
    canvas: document.querySelector('#canvas'),
    enableMSAA: false,
    pixelRatio: 1,
    runtimeOptions: {
        scriptsRoot: '/assets'
    }
});
application.ready().then(async () => {
    getEngine().startup('/assets/test/abc/takeOff.zscn', '', '');
    application.run();
});
