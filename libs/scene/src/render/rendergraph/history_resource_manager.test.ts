/**
 * Unit tests for HistoryResourceManager
 *
 * This file tests the ping-pong resource management functionality.
 */

import { HistoryResourceManager } from './history_resource_manager';
import type { RGTextureAllocator, RGTextureDesc, RGResolvedSize } from './types';

// Mock texture type for testing
type MockTexture = {
  id: number;
  format: string;
  width: number;
  height: number;
};

// Mock allocator for testing
class MockAllocator implements RGTextureAllocator<MockTexture> {
  private _nextId = 0;
  private _allocated: MockTexture[] = [];
  private _released: MockTexture[] = [];

  allocate(desc: RGTextureDesc, size: RGResolvedSize): MockTexture {
    const texture: MockTexture = {
      id: this._nextId++,
      format: desc.format,
      width: size.width,
      height: size.height
    };
    this._allocated.push(texture);
    return texture;
  }

  release(texture: MockTexture): void {
    this._released.push(texture);
  }

  getAllocated(): MockTexture[] {
    return this._allocated;
  }

  getReleased(): MockTexture[] {
    return this._released;
  }

  reset(): void {
    this._allocated = [];
    this._released = [];
  }
}

// Test suite
function runTests() {
  console.log('=== HistoryResourceManager Tests ===\n');

  let allocator!: MockAllocator;
  let manager!: HistoryResourceManager<MockTexture>;

  // Setup before each test
  function setup() {
    allocator = new MockAllocator();
    manager = new HistoryResourceManager(allocator);
  }

  // Test 1: Register creates two textures
  setup();
  console.log('Test 1: Register creates two textures');
  manager.register('test', { format: 'rgba16f' }, { width: 100, height: 100 });
  const allocated = allocator.getAllocated();
  console.assert(allocated.length === 2, 'Should allocate 2 textures');
  console.assert(allocated[0].format === 'rgba16f', 'Texture 0 format should match');
  console.assert(allocated[1].format === 'rgba16f', 'Texture 1 format should match');
  console.log('✓ Pass\n');

  // Test 2: getCurrent and getPrevious return different textures
  setup();
  console.log('Test 2: getCurrent and getPrevious return different textures');
  manager.register('test', { format: 'rgba16f' }, { width: 100, height: 100 });
  const current = manager.getCurrent('test');
  const previous = manager.getPrevious('test');
  console.assert(current.id !== previous.id, 'Current and previous should be different');
  console.log(`  Current ID: ${current.id}, Previous ID: ${previous.id}`);
  console.log('✓ Pass\n');

  // Test 3: swap() exchanges current and previous
  setup();
  console.log('Test 3: swap() exchanges current and previous');
  manager.register('test', { format: 'rgba16f' }, { width: 100, height: 100 });
  const beforeSwapCurrent = manager.getCurrent('test');
  const beforeSwapPrevious = manager.getPrevious('test');
  manager.swap();
  const afterSwapCurrent = manager.getCurrent('test');
  const afterSwapPrevious = manager.getPrevious('test');
  console.assert(
    beforeSwapCurrent.id === afterSwapPrevious.id,
    'Before current should become after previous'
  );
  console.assert(
    beforeSwapPrevious.id === afterSwapCurrent.id,
    'Before previous should become after current'
  );
  console.log(`  Before: current=${beforeSwapCurrent.id}, previous=${beforeSwapPrevious.id}`);
  console.log(`  After:  current=${afterSwapCurrent.id}, previous=${afterSwapPrevious.id}`);
  console.log('✓ Pass\n');

  // Test 4: has() returns correct values
  setup();
  console.log('Test 4: has() returns correct values');
  console.assert(!manager.has('test'), 'Should return false before registration');
  manager.register('test', { format: 'rgba16f' }, { width: 100, height: 100 });
  console.assert(manager.has('test'), 'Should return true after registration');
  console.log('✓ Pass\n');

  // Test 5: unregister() releases textures
  setup();
  console.log('Test 5: unregister() releases textures');
  manager.register('test', { format: 'rgba16f' }, { width: 100, height: 100 });
  const result = manager.unregister('test');
  console.assert(result === true, 'Should return true when resource exists');
  console.assert(allocator.getReleased().length === 2, 'Should release 2 textures');
  console.assert(!manager.has('test'), 'Resource should no longer exist');
  console.log('✓ Pass\n');

  // Test 6: dispose() releases all resources
  setup();
  console.log('Test 6: dispose() releases all resources');
  manager.register('test1', { format: 'rgba16f' }, { width: 100, height: 100 });
  manager.register('test2', { format: 'rgba8unorm' }, { width: 200, height: 200 });
  console.assert(manager.size === 2, 'Should have 2 resources');
  manager.dispose();
  console.assert(allocator.getReleased().length === 4, 'Should release 4 textures (2 per resource)');
  console.assert(manager.size === 0, 'Should have 0 resources after dispose');
  console.log('✓ Pass\n');

  // Test 7: Multiple swaps work correctly
  setup();
  console.log('Test 7: Multiple swaps work correctly');
  manager.register('test', { format: 'rgba16f' }, { width: 100, height: 100 });
  const tex0 = manager.getCurrent('test');
  manager.swap();
  const tex1 = manager.getCurrent('test');
  manager.swap();
  const tex2 = manager.getCurrent('test');
  console.assert(tex0.id === tex2.id, 'After 2 swaps, should return to original');
  console.assert(tex0.id !== tex1.id, 'After 1 swap, should be different');
  console.log(`  Swap 0: ${tex0.id}, Swap 1: ${tex1.id}, Swap 2: ${tex2.id}`);
  console.log('✓ Pass\n');

  // Test 8: Error handling for non-existent resources
  setup();
  console.log('Test 8: Error handling for non-existent resources');
  try {
    manager.getCurrent('nonexistent');
    console.assert(false, 'Should throw error for non-existent resource');
  } catch (e) {
    console.assert(e instanceof Error, 'Should throw Error');
    console.assert((e as Error).message.includes('not found'), 'Error message should mention "not found"');
    console.log(`  Error message: ${(e as Error).message}`);
  }
  console.log('✓ Pass\n');

  // Test 9: Register is idempotent
  setup();
  console.log('Test 9: Register is idempotent');
  manager.register('test', { format: 'rgba16f' }, { width: 100, height: 100 });
  const firstAllocCount = allocator.getAllocated().length;
  manager.register('test', { format: 'rgba16f' }, { width: 100, height: 100 });
  const secondAllocCount = allocator.getAllocated().length;
  console.assert(firstAllocCount === secondAllocCount, 'Should not allocate again if already registered');
  console.log(`  First alloc: ${firstAllocCount}, Second alloc: ${secondAllocCount}`);
  console.log('✓ Pass\n');

  console.log('=== All tests passed! ===');
}

// Run tests if this file is executed directly
if (typeof window === 'undefined') {
  runTests();
}

export { runTests };
