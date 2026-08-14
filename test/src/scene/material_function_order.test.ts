import { MemoryFS } from '@zephyr3d/base';
import { FunctionCallNode, FunctionInputNode, FunctionOutputNode, ResourceManager } from '@zephyr3d/scene';

describe('Material function interface order', () => {
  test('legacy interfaces sort by name without changing saved slot connections', async () => {
    const vfs = new MemoryFS();
    const manager = new ResourceManager(vfs);
    const functionPath = '/functions/legacy.zmf';
    const callerPath = '/functions/caller.zmf';

    await vfs.writeFile(
      functionPath,
      JSON.stringify({
        type: 'MaterialFunction',
        state: {
          func: {
            nodes: [
              functionInput(10, 'beta', 'float'),
              functionInput(20, 'alpha', 'vec3'),
              functionOutput(30, 'zeta'),
              functionOutput(40, 'alphaOut')
            ],
            links: [link(10, 1, 30, 1), link(20, 1, 40, 1)]
          }
        }
      }),
      { encoding: 'utf8', create: true }
    );
    await vfs.writeFile(
      callerPath,
      JSON.stringify({
        type: 'MaterialFunction',
        state: {
          func: {
            nodes: [
              functionInput(1, 'sourceBeta', 'float'),
              functionInput(2, 'sourceAlpha', 'vec3'),
              {
                id: 3,
                title: '',
                locked: false,
                node: { ClassName: 'FunctionCallNode', Init: functionPath, Object: {} }
              },
              functionOutput(4, 'resultZeta'),
              functionOutput(5, 'resultAlpha')
            ],
            links: [link(1, 1, 3, 1), link(2, 1, 3, 2), link(3, 1, 4, 1), link(3, 2, 5, 1)]
          }
        }
      }),
      { encoding: 'utf8', create: true }
    );

    const blueprint = await manager.loadBluePrint(callerPath);
    const call = blueprint!.func.DAG.nodeMap[3] as FunctionCallNode;

    expect(call.inputs.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 2, name: 'alpha' },
      { id: 1, name: 'beta' }
    ]);
    expect(call.inputs[0].inputNode).toBe(blueprint!.func.DAG.nodeMap[2]);
    expect(call.inputs[1].inputNode).toBe(blueprint!.func.DAG.nodeMap[1]);
    expect(call.outputs.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 2, name: 'alphaOut' },
      { id: 1, name: 'zeta' }
    ]);
    expect(call.getOutputType(1)).toBe('float');
    expect(call.getOutputType(2)).toBe('vec3');
  });

  test('explicit order is serialized and takes precedence over name order', async () => {
    const vfs = new MemoryFS();
    const manager = new ResourceManager(vfs);
    const functionPath = '/functions/ordered.zmf';
    const input = new FunctionInputNode();
    const output = new FunctionOutputNode();
    input.order = 7;
    output.order = 3;

    const serializedInput = await manager.serializeObject(input);
    const serializedOutput = await manager.serializeObject(output);
    const restoredInput = await manager.deserializeObject<FunctionInputNode>(null, serializedInput);
    const restoredOutput = await manager.deserializeObject<FunctionOutputNode>(null, serializedOutput);

    expect(serializedInput.Object.order).toBe(7);
    expect(serializedOutput.Object.order).toBe(3);
    expect(restoredInput!.order).toBe(7);
    expect(restoredOutput!.order).toBe(3);

    const legacyInput = await manager.deserializeObject<FunctionInputNode>(null, {
      ClassName: 'FunctionInputNode',
      Object: { type: 'float', name: 'legacy' }
    });
    expect(legacyInput!.order).toBe(-1);

    await vfs.writeFile(
      functionPath,
      JSON.stringify({
        type: 'MaterialFunction',
        state: {
          func: {
            nodes: [
              functionInput(10, 'alpha', 'float', 5),
              functionInput(20, 'beta', 'vec3', 0),
              functionOutput(30, 'alphaOut', 5),
              functionOutput(40, 'betaOut', 0)
            ],
            links: [link(10, 1, 30, 1), link(20, 1, 40, 1)]
          }
        }
      }),
      { encoding: 'utf8', create: true }
    );
    const blueprint = await manager.loadBluePrint(functionPath);
    const call = new FunctionCallNode(functionPath, 'ordered', blueprint!.func);

    expect(call.inputs.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 2, name: 'beta' },
      { id: 1, name: 'alpha' }
    ]);
    expect(call.outputs.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 2, name: 'betaOut' },
      { id: 1, name: 'alphaOut' }
    ]);
  });
});

function functionInput(id: number, name: string, type: string, order?: number) {
  return {
    id,
    title: '',
    locked: false,
    node: {
      ClassName: 'FunctionInputNode',
      Object: { type, name, ...(order === undefined ? {} : { order }) }
    }
  };
}

function functionOutput(id: number, name: string, order?: number) {
  return {
    id,
    title: '',
    locked: false,
    node: {
      ClassName: 'FunctionOutputNode',
      Object: { name, ...(order === undefined ? {} : { order }) }
    }
  };
}

function link(startNodeId: number, startSlotId: number, endNodeId: number, endSlotId: number) {
  return { startNodeId, startSlotId, endNodeId, endSlotId };
}
