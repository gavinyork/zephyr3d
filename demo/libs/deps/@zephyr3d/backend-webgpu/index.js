import { genDefaultName, GPUResourceUsageFlags, PBPrimitiveTypeInfo, PBPrimitiveType, StructuredBufferData, isSRGBTextureFormat, isFloatTextureFormat, isIntegerTextureFormat, isSignedTextureFormat, isCompressedTextureFormat, hasDepthChannel, getTextureFormatBlockWidth, getTextureFormatBlockHeight, getTextureFormatBlockSize, linearTextureFormatToSRGB, VertexData, getVertexAttribFormat, getVertexAttribName, ShaderType, hasStencilChannel, BaseDevice } from '@zephyr3d/device';
import { Disposable, Vector4, CubeFace, makeObservable } from '@zephyr3d/base';

let _uniqueId = 0;
class WebGPUObject extends Disposable {
    _device;
    _object;
    _uid;
    _cid;
    _name;
    _queueState;
    _restoreHandler;
    constructor(device){
        super();
        this._device = device;
        this._object = null;
        this._uid = ++_uniqueId;
        this._cid = 1;
        this._name = genDefaultName(this);
        this._queueState = 0;
        this._restoreHandler = null;
        this._device.addGPUObject(this);
    }
    get device() {
        return this._device;
    }
    get object() {
        return this._object;
    }
    get uid() {
        return this._uid;
    }
    get cid() {
        return this._cid;
    }
    get restoreHandler() {
        return this._restoreHandler;
    }
    set restoreHandler(handler) {
        this._restoreHandler = handler;
    }
    get name() {
        return this._name;
    }
    set name(val) {
        if (val !== this._name) {
            const lastName = this._name;
            this._name = val;
            this._device.dispatchEvent('gpuobject_rename', this, lastName);
        }
    }
    get queueState() {
        return this._queueState;
    }
    set queueState(val) {
        this._queueState = val;
    }
    isVertexLayout() {
        return false;
    }
    isFramebuffer() {
        return false;
    }
    isSampler() {
        return false;
    }
    isTexture() {
        return false;
    }
    isTexture2D() {
        return false;
    }
    isTexture2DArray() {
        return false;
    }
    isTexture3D() {
        return false;
    }
    isTextureCube() {
        return false;
    }
    isTextureVideo() {
        return false;
    }
    isProgram() {
        return false;
    }
    isBuffer() {
        return false;
    }
    isBindGroup() {
        return false;
    }
    reload() {
        if (this.disposed) {
            this._device.restoreObject(this);
            this._cid++;
        }
    }
    destroy() {
        throw new Error('Abstract function call: dispose()');
    }
    restore() {
        throw new Error('Abstract function call: restore()');
    }
    onDispose() {
        super.onDispose();
        this._device.disposeObject(this, true);
    }
}

class WebGPUProgram extends WebGPUObject {
    static _hashCounter = 0;
    _type;
    _vs;
    _fs;
    _cs;
    _label;
    _hash;
    _error;
    _bindGroupLayouts;
    _vertexAttributes;
    _csModule;
    _vsModule;
    _fsModule;
    _pipelineLayout;
    constructor(device, params){
        super(device);
        this._type = params.type;
        this._label = params.label ?? `Program ${this.uid}`;
        this._bindGroupLayouts = [
            ...params.params.bindGroupLayouts
        ];
        this._error = '';
        if (params.type === 'render') {
            const renderParams = params.params;
            this._vs = renderParams.vs;
            this._fs = renderParams.fs;
            this._vertexAttributes = renderParams.vertexAttributes ? renderParams.vertexAttributes.join(':') : '';
        } else {
            const computeParams = params.params;
            this._cs = computeParams.source;
        }
        this._load();
        this._hash = String(++WebGPUProgram._hashCounter);
    }
    get type() {
        return this._type;
    }
    get label() {
        return this._label;
    }
    getCompileError() {
        return this._error;
    }
    getShaderSource(kin) {
        switch(kin){
            case 'vertex':
                return this._vs;
            case 'fragment':
                return this._fs;
            case 'compute':
                return this._cs;
            default:
                return null;
        }
    }
    getBindingInfo(name) {
        for(let group = 0; group < this._bindGroupLayouts.length; group++){
            const layout = this._bindGroupLayouts[group];
            const bindName = layout.nameMap?.[name] ?? name;
            for(let binding = 0; binding < layout.entries.length; binding++){
                const bindingPoint = layout.entries[binding];
                if (bindingPoint.name === bindName) {
                    return {
                        group: group,
                        binding: binding,
                        type: bindingPoint.type
                    };
                }
            }
        }
        return null;
    }
    get bindGroupLayouts() {
        return this._bindGroupLayouts;
    }
    get vertexAttributes() {
        return this._vertexAttributes;
    }
    get hash() {
        return this._hash;
    }
    getPipelineLayout() {
        return this._pipelineLayout;
    }
    getShaderModule() {
        return {
            vsModule: this._vsModule,
            fsModule: this._fsModule,
            csModule: this._csModule,
            pipelineLayout: this._pipelineLayout
        };
    }
    get fsModule() {
        return this._fsModule;
    }
    destroy() {
        this._object = null;
    }
    restore() {
        if (!this._object) {
            this._load();
        }
    }
    isProgram() {
        return true;
    }
    createUniformBuffer(uniform) {
        const type = this.getBindingInfo(uniform)?.type;
        return type ? this.device.createStructuredBuffer(type, {
            usage: 'uniform'
        }) : null;
    }
    _load() {
        if (this._type === 'render') {
            this._vsModule = this.createShaderModule(this._vs);
            this._fsModule = this.createShaderModule(this._fs);
        } else {
            this._csModule = this.createShaderModule(this._cs);
        }
        this._pipelineLayout = this.createPipelineLayout(this._bindGroupLayouts);
        this._object = {};
    }
    createPipelineLayout(bindGroupLayouts) {
        const layouts = [];
        bindGroupLayouts.forEach((val)=>{
            layouts.push(this._device.fetchBindGroupLayout(val)[1]);
        });
        return this._device.device.createPipelineLayout({
            bindGroupLayouts: layouts
        });
    }
    createShaderModule(code) {
        let sm = this._device.device.createShaderModule({
            label: this._label,
            code
        });
        if (sm) {
            const func = sm.compilationInfo || sm.getCompilationInfo;
            if (!func) {
                return sm;
            }
            func.call(sm).then((compilationInfo)=>{
                let err = false;
                if (compilationInfo?.messages?.length > 0) {
                    let msg = '';
                    for (const message of compilationInfo.messages){
                        if (message.type === 'error') {
                            err = true;
                        }
                        msg += `Line ${message.lineNum}:${message.linePos} - ${code.slice(message.offset, message.offset + message.length)}\n`;
                        msg += `${message.message}\n`;
                        if (message.type === 'error') {
                            err = true;
                            console.error(msg);
                        } else if (message.type === 'warning') {
                            console.warn(msg);
                        } else {
                            console.info(msg);
                        }
                        this._error += msg;
                    }
                }
                if (err) {
                    sm = null;
                }
            });
        }
        return sm;
    }
    use() {
        this._device.setProgram(this);
    }
}

class UploadRingBuffer {
    _device;
    _bufferList;
    _defaultSize;
    _unmappedBufferList;
    constructor(device, defaultSize = 64 * 1024){
        this._device = device;
        this._bufferList = [];
        this._defaultSize = defaultSize;
        this._unmappedBufferList = [];
    }
    uploadBuffer(src, dst, srcOffset, dstOffset, uploadSize, allowOverlap) {
        const size = uploadSize + 3 & -4;
        const mappedBuffer = this.fetchBufferMapped(size, !!allowOverlap);
        if (src) {
            const mappedRange = mappedBuffer.mappedRange; //mappedBuffer.buffer.getMappedRange(mappedBuffer.offset, size);
            new Uint8Array(mappedRange, mappedBuffer.offset, size).set(new Uint8Array(src, srcOffset, uploadSize));
        }
        const upload = {
            mappedBuffer: {
                ...mappedBuffer
            },
            uploadSize: size,
            uploadBuffer: dst,
            uploadOffset: dstOffset
        };
        mappedBuffer.offset += size;
        mappedBuffer.offset = mappedBuffer.offset + 7 & -8;
        return upload;
    }
    beginUploads() {
        for(let i = this._bufferList.length - 1; i >= 0; i--){
            const buffer = this._bufferList[i];
            if (buffer.used) {
                buffer.buffer.unmap();
                this._unmappedBufferList.push(buffer);
                this._bufferList.splice(i, 1);
                buffer.mappedRange = null;
            }
        }
        return this._unmappedBufferList.length;
    }
    endUploads() {
        for (const buffer of this._unmappedBufferList){
            buffer.buffer.mapAsync(GPUMapMode.WRITE).then(()=>{
                buffer.offset = 0;
                buffer.used = false;
                buffer.mappedRange = buffer.buffer.getMappedRange();
                this._bufferList.push(buffer);
            });
        }
        this._unmappedBufferList = [];
    }
    purge() {
        for(let i = this._bufferList.length - 1; i >= 0; i--){
            const buffer = this._bufferList[i];
            if (buffer.mappedRange) {
                buffer.buffer.unmap();
                buffer.buffer.destroy();
            }
        }
        this._bufferList = [];
        for (const buffer of this._unmappedBufferList){
            buffer.buffer.destroy();
        }
        this._unmappedBufferList = [];
    }
    fetchBufferMapped(size, allowOverlap) {
        for (const buffer of this._bufferList){
            if (allowOverlap || buffer.size - buffer.offset >= size) {
                buffer.used = true;
                return buffer;
            }
        }
        const bufferSize = Math.max(size, this._defaultSize) + 3 & -4;
        const buf = this._device.device.createBuffer({
            label: `StagingRingBuffer${this._bufferList.length}:${bufferSize}`,
            size: bufferSize,
            usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true
        });
        this._bufferList.push({
            buffer: buf,
            size: bufferSize,
            offset: 0,
            used: true,
            mappedRange: buf.getMappedRange()
        });
        return this._bufferList[this._bufferList.length - 1];
    }
}

class WebGPUBuffer extends WebGPUObject {
    _size;
    _usage;
    _gpuUsage;
    _memCost;
    _ringBuffer;
    _pendingUploads;
    constructor(device, usage, data){
        super(device);
        this._object = null;
        this._memCost = 0;
        this._usage = usage;
        this._gpuUsage = 0;
        this._size = typeof data === 'number' ? data : data.byteLength;
        if (this._size <= 0) {
            throw new Error('can not create buffer with zero size');
        }
        this._ringBuffer = new UploadRingBuffer(device, this._size + 15 & -16);
        this._pendingUploads = [];
        this.load(typeof data === 'number' ? null : data);
    }
    get hash() {
        return this._object ? this._device.gpuGetObjectHash(this._object) : 0;
    }
    get byteLength() {
        return this._size;
    }
    get usage() {
        return this._usage;
    }
    get gpuUsage() {
        return this._gpuUsage;
    }
    searchInsertPosition(dstByteOffset) {
        let left = 0;
        let right = this._pendingUploads.length - 1;
        let insertIndex = this._pendingUploads.length;
        while(left <= right){
            const mid = Math.floor((left + right) / 2);
            const upload = this._pendingUploads[mid];
            if (upload.uploadOffset < dstByteOffset) {
                left = mid + 1;
            } else {
                insertIndex = mid;
                right = mid - 1;
            }
        }
        return insertIndex;
    }
    bufferSubData(dstByteOffset, data, srcOffset, srcLength) {
        srcOffset = Number(srcOffset) || 0;
        dstByteOffset = Number(dstByteOffset) || 0;
        srcLength = Number(srcLength) || data.length - srcOffset;
        if (srcOffset + srcLength > data.length) {
            throw new Error('bufferSubData() failed: source buffer is too small');
        }
        if (dstByteOffset + srcLength * data.BYTES_PER_ELEMENT > this.byteLength) {
            throw new Error('bufferSubData() failed: dest buffer is too small');
        }
        const uploadSize = srcLength * data.BYTES_PER_ELEMENT;
        if ((dstByteOffset & 3) !== 0 || (uploadSize & 3) !== 0) {
            throw new Error('bufferSubData() failed: destination byte offset or upload size must be 4 bytes aligned');
        }
        const uploadOffset = data.byteOffset + srcOffset * data.BYTES_PER_ELEMENT;
        const insertIndex = this.searchInsertPosition(dstByteOffset);
        if (insertIndex < this._pendingUploads.length) {
            const upload = this._pendingUploads[insertIndex];
            if (upload.uploadOffset < dstByteOffset + uploadSize && upload.uploadOffset + upload.uploadSize > dstByteOffset) {
                // Flush if overlapped
                this._device.bufferUpload(this);
            }
        }
        let commit = false;
        if (this._pendingUploads.length === 0) {
            this.pushUpload(dstByteOffset, uploadSize, 0);
            commit = true;
        } else {
            let start = dstByteOffset;
            let end = dstByteOffset + uploadSize;
            while(insertIndex < this._pendingUploads.length){
                const upload = this._pendingUploads[insertIndex];
                const uploadStart = upload.uploadOffset;
                const uploadEnd = uploadStart + upload.uploadSize;
                if (uploadStart < end && uploadEnd > start) {
                    start = Math.min(start, uploadStart);
                    end = Math.max(end, uploadEnd);
                    this._pendingUploads.splice(insertIndex, 1);
                } else {
                    break;
                }
            }
            this.pushUpload(start, end - start, insertIndex);
        }
        new Uint8Array(this._pendingUploads[0].mappedBuffer.mappedRange, dstByteOffset, uploadSize).set(new Uint8Array(data.buffer, uploadOffset, uploadSize));
        if (commit) {
            this._device.bufferUpload(this);
        }
    }
    async getBufferSubData(dstBuffer, offsetInBytes, sizeInBytes) {
        let sourceBuffer = this;
        offsetInBytes = Number(offsetInBytes) || 0;
        sizeInBytes = Number(sizeInBytes) || this.byteLength - offsetInBytes;
        if (offsetInBytes < 0 || offsetInBytes + sizeInBytes > this.byteLength) {
            throw new Error('data query range out of bounds');
        }
        if (dstBuffer && dstBuffer.byteLength < sizeInBytes) {
            throw new Error('no enough space for querying buffer data');
        }
        if (!(this._usage & (GPUResourceUsageFlags.BF_READ | GPUResourceUsageFlags.BF_PACK_PIXEL))) {
            if (this._gpuUsage & GPUBufferUsage.COPY_SRC) {
                sourceBuffer = this._device.createBuffer(sizeInBytes, {
                    usage: 'read'
                });
                this.sync();
                this._device.copyBuffer(this, sourceBuffer, offsetInBytes, 0, sizeInBytes);
            } else {
                throw new Error('getBufferSubData() failed: buffer does not have BF_READ or BF_PACK_PIXEL flag set');
            }
        } else {
            this.sync();
        }
        const buffer = sourceBuffer.object;
        await buffer.mapAsync(GPUMapMode.READ);
        const range = buffer.getMappedRange();
        dstBuffer = dstBuffer || new Uint8Array(sizeInBytes);
        dstBuffer.set(new Uint8Array(range, offsetInBytes, sizeInBytes));
        buffer.unmap();
        if (sourceBuffer !== this) {
            sourceBuffer.dispose();
        }
        return dstBuffer;
    }
    restore() {
        if (!this._device.isContextLost()) {
            this.load();
        }
    }
    destroy() {
        if (this._object) {
            this._object.destroy();
            this._object = null;
            this._gpuUsage = 0;
            this._memCost = 0;
        }
    }
    isBuffer() {
        return true;
    }
    beginSyncChanges(encoder) {
        if (this._pendingUploads.length > 0) {
            const cmdEncoder = encoder || this._device.device.createCommandEncoder();
            for (const upload of this._pendingUploads){
                cmdEncoder.copyBufferToBuffer(upload.mappedBuffer.buffer, upload.mappedBuffer.offset, this._object, upload.uploadOffset, upload.uploadSize);
            }
            if (!encoder) {
                this._device.device.queue.submit([
                    cmdEncoder.finish()
                ]);
            }
            this._pendingUploads.length = 0;
            this._ringBuffer.beginUploads();
        }
    }
    endSyncChanges() {
        if (this._usage & GPUResourceUsageFlags.DYNAMIC) {
            this._ringBuffer.endUploads();
        } else {
            this._ringBuffer.purge();
        }
    }
    load(data) {
        if (this._device.isContextLost()) {
            return;
        }
        this._memCost = 0;
        if (!this._device.isContextLost()) {
            if (!this._object) {
                this._gpuUsage = 0;
                let label = '';
                if (this._usage & GPUResourceUsageFlags.BF_VERTEX) {
                    this._gpuUsage |= GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
                    label += '[vertex]';
                }
                if (this._usage & GPUResourceUsageFlags.BF_INDEX) {
                    this._gpuUsage |= GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
                    label += '[index]';
                }
                if (this._usage & GPUResourceUsageFlags.BF_UNIFORM) {
                    this._gpuUsage |= GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
                    label += '[uniform]';
                }
                if (this._usage & GPUResourceUsageFlags.BF_STORAGE) {
                    this._gpuUsage |= GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
                    label += '[storage]';
                }
                if (this._usage & (GPUResourceUsageFlags.BF_READ | GPUResourceUsageFlags.BF_PACK_PIXEL)) {
                    this._gpuUsage |= GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ;
                    label += '[mapRead]';
                }
                if (this._usage & (GPUResourceUsageFlags.BF_WRITE | GPUResourceUsageFlags.BF_UNPACK_PIXEL)) {
                    this._gpuUsage |= GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE;
                    label += '[mapWrite]';
                }
                if (data) {
                    this._object = this._device.gpuCreateBuffer({
                        label: label,
                        size: data.byteLength + 15 & -16,
                        usage: this._gpuUsage,
                        mappedAtCreation: true
                    });
                    const range = this._object.getMappedRange();
                    new data.constructor(range).set(data);
                    this._object.unmap();
                } else {
                    this._object = this._device.gpuCreateBuffer({
                        label: label,
                        size: this.byteLength + 15 & -16,
                        usage: this._gpuUsage
                    });
                }
                const memCost = this.byteLength;
                this._device.updateVideoMemoryCost(memCost - this._memCost);
                this._memCost = memCost;
            }
        }
    }
    sync() {
        if (this._pendingUploads) {
            this._device.flushUploads();
        }
    }
    pushUpload(dstByteOffset, byteSize, insertIndex) {
        const bufferMapped = this._ringBuffer.fetchBufferMapped(byteSize, true);
        this._pendingUploads.splice(insertIndex, 0, {
            mappedBuffer: {
                buffer: bufferMapped.buffer,
                size: bufferMapped.size,
                offset: dstByteOffset,
                used: bufferMapped.used,
                mappedRange: bufferMapped.mappedRange
            },
            uploadSize: byteSize,
            uploadOffset: dstByteOffset,
            uploadBuffer: this._object
        });
    }
}

const typeU8Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC2_NORM);
const typeU8Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC4_NORM);
const typeI8Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC2_NORM);
const typeI8Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC4_NORM);
const typeU16Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC2);
const typeU16Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC4);
const typeI16Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC2);
const typeI16Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC4);
const typeU16Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC2_NORM);
const typeU16Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC4_NORM);
const typeI16Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC2_NORM);
const typeI16Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC4_NORM);
const typeF16Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16VEC2);
const typeF16Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16VEC4);
const typeF32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32);
const typeF32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC2);
const typeF32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC3);
const typeF32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC4);
const typeU32$1 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32);
const typeU32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC2);
const typeU32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC3);
const typeU32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC4);
const typeI32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32);
const typeI32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC2);
const typeI32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC3);
const typeI32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC4);
const vertexFormatTable = {
    [typeU8Vec2_Norm.typeId]: 'unorm8x2',
    [typeU8Vec4_Norm.typeId]: 'unorm8x4',
    [typeI8Vec2_Norm.typeId]: 'snorm8x2',
    [typeI8Vec4_Norm.typeId]: 'snorm8x4',
    [typeU16Vec2.typeId]: 'uint16x2',
    [typeU16Vec4.typeId]: 'uint16x4',
    [typeI16Vec2.typeId]: 'sint16x2',
    [typeI16Vec4.typeId]: 'sint16x4',
    [typeU16Vec2_Norm.typeId]: 'unorm16x2',
    [typeU16Vec4_Norm.typeId]: 'unorm16x4',
    [typeI16Vec2_Norm.typeId]: 'snorm16x2',
    [typeI16Vec4_Norm.typeId]: 'snorm16x4',
    [typeF16Vec2.typeId]: 'float16x2',
    [typeF16Vec4.typeId]: 'float16x4',
    [typeF32.typeId]: 'float32',
    [typeF32Vec2.typeId]: 'float32x2',
    [typeF32Vec3.typeId]: 'float32x3',
    [typeF32Vec4.typeId]: 'float32x4',
    [typeU32$1.typeId]: 'uint32',
    [typeU32Vec2.typeId]: 'uint32x2',
    [typeU32Vec3.typeId]: 'uint32x3',
    [typeU32Vec4.typeId]: 'uint32x4',
    [typeI32.typeId]: 'sint32',
    [typeI32Vec2.typeId]: 'sint32x2',
    [typeI32Vec3.typeId]: 'sint32x3',
    [typeI32Vec4.typeId]: 'sint32x4'
};
class WebGPUStructuredBuffer extends WebGPUBuffer {
    _structure;
    _data;
    constructor(device, structure, usage, source){
        if (!structure?.isStructType()) {
            throw new Error('invalid structure type');
        }
        if (usage & GPUResourceUsageFlags.BF_INDEX) {
            throw new Error('structured buffer must not have Index usage flag');
        }
        if (usage & (GPUResourceUsageFlags.BF_READ | GPUResourceUsageFlags.BF_WRITE | GPUResourceUsageFlags.BF_PACK_PIXEL | GPUResourceUsageFlags.BF_UNPACK_PIXEL)) {
            throw new Error('structured buffer must not have Read or Write usage flags');
        }
        if (usage & GPUResourceUsageFlags.BF_VERTEX) {
            if (structure.structMembers.length !== 1 || !structure.structMembers[0].type.isArrayType()) {
                throw new Error('structured buffer for vertex usage must have only one array member');
            }
        }
        if (usage & GPUResourceUsageFlags.BF_UNIFORM || usage & GPUResourceUsageFlags.BF_STORAGE) {
            usage |= GPUResourceUsageFlags.DYNAMIC;
        }
        const layout = structure.toBufferLayout(0, structure.layout);
        if (source && layout.byteSize !== source.byteLength) {
            throw new Error(`create structured buffer failed: invalid source size: ${source.byteLength}, should be ${layout.byteSize}`);
        }
        super(device, usage, source || layout.byteSize);
        this._data = new StructuredBufferData(layout, this);
        this._structure = structure;
    }
    set(name, value) {
        this._data.set(name, value);
    }
    get structure() {
        return this._structure;
    }
    set structure(st) {
        if (st && !st.isCompatibleType(this._structure)) {
            const layout = st.toBufferLayout(0, st.layout);
            if (layout.byteSize > this.byteLength) {
                throw new Error(`set structure type failed: new structure type is too large: ${layout.byteSize}`);
            }
            this._data = new StructuredBufferData(layout, this);
            this._structure = st;
        }
    }
    static getGPUVertexFormat(type) {
        return vertexFormatTable[type.typeId];
    }
}

class WebGPUBindGroup extends WebGPUObject {
    _layout;
    _layoutDesc;
    _entries;
    _bindGroup;
    _buffers;
    _textures;
    _createdBuffers;
    _gpuId;
    _videoTextures;
    _dynamicOffsets;
    _resources;
    constructor(device, layout){
        super(device);
        this._device = device;
        this._layout = layout;
        this._layoutDesc = null;
        this._entries = null;
        this._bindGroup = null;
        this._dynamicOffsets = null;
        this._gpuId = 0;
        this._resources = {};
        this._buffers = [];
        this._textures = [];
        this._createdBuffers = [];
        this._videoTextures = null;
        for (const entry of this._layout.entries){
            if (entry.buffer && entry.buffer.hasDynamicOffset) {
                if (!this._dynamicOffsets) {
                    this._dynamicOffsets = [];
                }
                this._dynamicOffsets[entry.buffer.dynamicOffsetIndex] = 0;
            }
        }
    }
    get bindGroup() {
        if (!this._bindGroup) {
            this._bindGroup = this._create();
        }
        return this._bindGroup;
    }
    get layoutDescriptor() {
        if (!this._bindGroup) {
            this._bindGroup = this._create();
        }
        return this._layoutDesc;
    }
    get entries() {
        if (!this._bindGroup) {
            this._bindGroup = this._create();
        }
        return this._entries;
    }
    getGPUId() {
        return `${this._uid}:${this._gpuId}`;
    }
    get bufferList() {
        return this._buffers;
    }
    get textureList() {
        return this._textures;
    }
    invalidate() {
        this._bindGroup = null;
        this._gpuId++;
    }
    getLayout() {
        return this._layout;
    }
    getDynamicOffsets() {
        return this._dynamicOffsets;
    }
    getBuffer(name, nocreate = true) {
        return this._getBuffer(name, GPUResourceUsageFlags.BF_UNIFORM | GPUResourceUsageFlags.BF_STORAGE, nocreate);
    }
    setBuffer(name, buffer, offset, bindOffset, bindSize) {
        const bindName = this._layout.nameMap?.[name] ?? name;
        for (const entry of this._layout.entries){
            if (entry.name === bindName) {
                if (!entry.buffer) {
                    console.error(`setBuffer() failed: resource '${name}' is not buffer`);
                } else {
                    bindOffset = bindOffset ?? 0;
                    bindSize = bindSize ?? (buffer ? Math.max(0, buffer.byteLength - bindOffset) : 0);
                    const info = this._resources[entry.name];
                    const bufferUsage = entry.buffer.type === 'uniform' ? GPUResourceUsageFlags.BF_UNIFORM : GPUResourceUsageFlags.BF_STORAGE;
                    if (!buffer || !(buffer.usage & bufferUsage)) {
                        console.error(`setBuffer() failed: buffer resource '${name}' must be type '${entry.buffer.type}'`);
                    } else if (buffer !== info?.[0] || bindOffset !== info?.[1] || bindSize !== info?.[2]) {
                        this._resources[entry.name] = [
                            buffer,
                            bindOffset,
                            bindSize
                        ];
                        this.invalidate();
                    }
                    if (entry.buffer.hasDynamicOffset) {
                        this._dynamicOffsets[entry.buffer.dynamicOffsetIndex] = offset ?? 0;
                    }
                }
                return;
            }
        }
        console.error(`setBuffer() failed: no buffer resource named '${name}'`);
    }
    setValue(name, value) {
        const mappedName = this._layout.nameMap?.[name];
        if (mappedName) {
            this.setValue(mappedName, {
                [name]: value
            });
        } else {
            const buffer = this._getBuffer(name, GPUResourceUsageFlags.BF_UNIFORM | GPUResourceUsageFlags.BF_STORAGE, false);
            if (buffer) {
                if (!(buffer instanceof WebGPUStructuredBuffer)) {
                    throw new Error(`BindGroup.setValue() failed: '${name}' is not structured buffer`);
                }
                if (typeof value === 'number') {
                    throw new Error(`BindGroup.setValue() failed: cannot set ${value} to '${name}'`);
                }
                if ('BYTES_PER_ELEMENT' in value) {
                    buffer.bufferSubData(0, value);
                } else {
                    for(const k in value){
                        buffer.set(k, value[k]);
                    }
                }
            } else {
                console.error(`setValue() failed: no uniform buffer named '${name}'`);
            }
        }
    }
    setRawData(name, byteOffset, data, srcPos, srcLength) {
        const mappedName = this._layout.nameMap?.[name];
        if (mappedName) {
            this.setRawData(mappedName, byteOffset, data, srcPos, srcLength);
        } else {
            const buffer = this._getBuffer(name, GPUResourceUsageFlags.BF_UNIFORM | GPUResourceUsageFlags.BF_STORAGE, false);
            if (buffer) {
                buffer.bufferSubData(byteOffset, data, srcPos, srcLength);
            } else {
                console.error(`set(): no uniform buffer named '${name}'`);
            }
        }
    }
    getTexture(name) {
        const entry = this._findTextureLayout(name);
        if (entry) {
            const t = this._resources[name];
            return t ? t[0] : null;
        } else {
            throw new Error(`getTexture() failed:${name} is not a texture`);
        }
    }
    setTextureView(name, value, level, face, mipCount, sampler) {
        if (!value) {
            throw new Error(`WebGPUBindGroup.setTextureView() failed: invalid texture uniform value: ${value}`);
        } else {
            const entry = this._findTextureLayout(name);
            if (entry) {
                if (entry.externalTexture) {
                    throw new Error(`WebGPUBindGroup.setTextureView() failed: video texture does not have view`);
                } else if (value.isTextureVideo()) {
                    throw new Error(`WebGPUBindGroup.setTextureView() failed: invalid texture type`);
                }
                const t = this._resources[name];
                const view = value.getView(level, face, mipCount);
                if (!t || t[1] !== view) {
                    this._resources[name] = [
                        value,
                        view
                    ];
                    this.invalidate();
                }
                if (entry.texture?.autoBindSampler) {
                    const samplerEntry = this._findSamplerLayout(entry.texture.autoBindSampler);
                    if (!samplerEntry || !samplerEntry.sampler) {
                        throw new Error(`WebGPUBindGroup.setTextureView() failed: sampler entry not found: ${entry.texture.autoBindSampler}`);
                    }
                    const s = !sampler || sampler.compare ? value.getDefaultSampler(false) : sampler;
                    if (s.object !== this._resources[entry.texture.autoBindSampler]) {
                        this._resources[entry.texture.autoBindSampler] = s.object;
                        this.invalidate();
                    }
                }
                if (entry.texture?.autoBindSamplerComparison) {
                    const samplerEntry = this._findSamplerLayout(entry.texture.autoBindSamplerComparison);
                    if (!samplerEntry || !samplerEntry.sampler) {
                        throw new Error(`WebGPUBindGroup.setTextureView() failed: sampler entry not found: ${entry.texture.autoBindSamplerComparison}`);
                    }
                    const s = !sampler || !sampler.compare ? value.getDefaultSampler(true) : sampler;
                    if (s.object !== this._resources[entry.texture.autoBindSamplerComparison]) {
                        this._resources[entry.texture.autoBindSamplerComparison] = s.object;
                        this.invalidate();
                    }
                }
            } else {
                throw new Error(`WebGPUBindGroup.setView() failed: no texture uniform named '${name}'`);
            }
        }
    }
    setTexture(name, value, sampler) {
        if (!value) {
            throw new Error(`WebGPUBindGroup.setTexture() failed: invalid texture uniform value: ${value}`);
        } else {
            const entry = this._findTextureLayout(name);
            if (entry) {
                const t = this._resources[name];
                if (entry.externalTexture) {
                    if (!value.isTextureVideo()) {
                        throw new Error(`WebGPUBindGroup.setTexture() failed: invalid texture type of resource '${name}'`);
                    }
                    if (!t || t !== value) {
                        if (t) {
                            t.removeBindGroupReference(this);
                        }
                        if (value) {
                            value.addBindGroupReference(this);
                        }
                        this._resources[name] = value;
                        this.invalidate();
                        this._videoTextures = [];
                        for (const entry of this._layout.entries){
                            if (entry.externalTexture) {
                                const tex = this._resources[entry.name];
                                if (tex && this._videoTextures.indexOf(tex) < 0) {
                                    this._videoTextures.push(tex);
                                }
                            }
                        }
                    }
                } else {
                    if (value.isTextureVideo()) {
                        throw new Error(`WebGPUBindGroup.setTexture() failed: invalid texture type of resource '${name}'`);
                    }
                    const view = value.getDefaultView();
                    if (!entry.externalTexture && !view) {
                        throw new Error('WebGPUBindGroup.setTexture() failed: create texture view failed');
                    }
                    if (!t || t[0] !== value) {
                        this._resources[name] = [
                            value,
                            view
                        ];
                        this.invalidate();
                    }
                }
                const autoBindSampler = entry.texture?.autoBindSampler || entry.externalTexture?.autoBindSampler;
                if (autoBindSampler) {
                    const samplerEntry = this._findSamplerLayout(autoBindSampler);
                    if (!samplerEntry || !samplerEntry.sampler) {
                        throw new Error(`WebGPUBindGroup.setTexture() failed: sampler entry not found: ${autoBindSampler}`);
                    }
                    const s = !sampler || sampler.compare ? value.getDefaultSampler(false) : sampler;
                    if (s.object !== this._resources[autoBindSampler]) {
                        this._resources[autoBindSampler] = s.object;
                        this.invalidate();
                    }
                }
                const autoBindSamplerComparison = entry.texture?.autoBindSamplerComparison;
                if (autoBindSamplerComparison) {
                    const samplerEntry = this._findSamplerLayout(autoBindSamplerComparison);
                    if (!samplerEntry || !samplerEntry.sampler) {
                        throw new Error(`WebGPUBindGroup.setTexture() failed: sampler entry not found: ${autoBindSamplerComparison}`);
                    }
                    const s = !sampler || !sampler.compare ? value.getDefaultSampler(true) : sampler;
                    if (s.object !== this._resources[autoBindSamplerComparison]) {
                        this._resources[autoBindSamplerComparison] = s.object;
                        this.invalidate();
                    }
                }
            } else {
                throw new Error(`WebGPUBindGroup.setTexture() failed: no texture uniform named '${name}'`);
            }
        }
    }
    setSampler(name, value) {
        const sampler = value?.object;
        if (!sampler) {
            console.error(`WebGPUBindGroup.setSampler() failed: invalid sampler uniform value: ${value}`);
        } else if (this._resources[name] !== sampler) {
            if (!this._findSamplerLayout(name)) {
                console.error(`WebGPUBindGroup.setSampler() failed: no sampler uniform named '${name}'`);
            } else {
                this._resources[name] = sampler;
                this.invalidate();
            }
        }
    }
    destroy() {
        this.invalidate();
        this._resources = {};
        this._buffers = [];
        this._textures = [];
        this._videoTextures = null;
        this._object = null;
        for (const buffer of this._createdBuffers){
            buffer.dispose();
        }
        this._createdBuffers = [];
    }
    restore() {
        this.invalidate();
        this._object = {};
    }
    isBindGroup() {
        return true;
    }
    /** @internal */ updateVideoTextures() {
        this._videoTextures?.forEach((t)=>{
            if (t.updateVideoFrame()) {
                this.invalidate();
            }
        });
    }
    /** @internal */ _findTextureLayout(name) {
        for (const entry of this._layout.entries){
            if ((entry.texture || entry.storageTexture || entry.externalTexture) && entry.name === name) {
                return entry;
            }
        }
        return null;
    }
    /** @internal */ _findSamplerLayout(name) {
        for (const entry of this._layout.entries){
            if (entry.sampler && entry.name === name) {
                return entry;
            }
        }
        return null;
    }
    /** @internal */ _getBuffer(name, usage, nocreate = false) {
        const info = this._getBufferInfo(name, usage, nocreate);
        return info?.[0] ?? null;
    }
    /** @internal */ _getBufferInfo(name, usage, nocreate = false) {
        const bindName = this._layout.nameMap?.[name] ?? name;
        for (const entry of this._layout.entries){
            if (entry.buffer && entry.name === bindName) {
                const bufferUsage = entry.buffer.type === 'uniform' ? GPUResourceUsageFlags.BF_UNIFORM : GPUResourceUsageFlags.BF_STORAGE;
                if (!(usage & bufferUsage)) {
                    return null;
                }
                let buffer = this._resources[entry.name];
                if (!nocreate && buffer?.[0]?.disposed) {
                    buffer[0] = null;
                    this.invalidate();
                }
                if ((!buffer || !buffer[0]) && !nocreate) {
                    const options = {
                        usage: bufferUsage === GPUResourceUsageFlags.BF_UNIFORM ? 'uniform' : undefined,
                        storage: bufferUsage === GPUResourceUsageFlags.BF_STORAGE,
                        dynamic: true
                    };
                    const gpuBuffer = this._device.createStructuredBuffer(entry.type, options);
                    buffer = [
                        gpuBuffer,
                        0,
                        gpuBuffer.byteLength
                    ];
                    this._resources[entry.name] = buffer;
                    this._createdBuffers.push(gpuBuffer);
                }
                return buffer;
            }
        }
        return null;
    }
    /** @internal */ _create() {
        let bindGroup = null;
        this._layoutDesc = null;
        this._entries = null;
        this._textures = [];
        this._buffers = [];
        const entries = [];
        let resourceOk = true;
        for (const entry of this._layout.entries){
            const ge = {
                binding: entry.binding
            };
            if (entry.buffer) {
                const buffer = this._getBufferInfo(entry.name, entry.buffer.type === 'uniform' ? GPUResourceUsageFlags.BF_UNIFORM : GPUResourceUsageFlags.BF_STORAGE, true);
                if (!buffer) {
                    throw new Error(`Uniform buffer '${entry.name}' not exists, maybe you forgot settings some uniform values`);
                }
                if (this._buffers.indexOf(buffer[0]) < 0) {
                    this._buffers.push(buffer[0]);
                }
                ge.resource = {
                    buffer: buffer[0].object,
                    offset: buffer[1],
                    size: buffer[2]
                };
                resourceOk = resourceOk && !!buffer[0].object;
            } else if (entry.texture || entry.storageTexture) {
                const t = this._resources[entry.name];
                if (!t) {
                    console.error(`Missing texture in bind group: ${entry.name}`);
                    resourceOk = false;
                } else {
                    if (this._textures.indexOf(t[0]) < 0) {
                        this._textures.push(t[0]);
                    }
                    ge.resource = t[1];
                    resourceOk = resourceOk && !!t[1];
                }
            } else if (entry.externalTexture) {
                const t = this._resources[entry.name];
                ge.resource = t.object;
                resourceOk = resourceOk && !!t.object;
            } else if (entry.sampler) {
                const sampler = this._resources[entry.name];
                ge.resource = sampler;
                resourceOk = resourceOk && !!sampler;
            }
            entries.push(ge);
        }
        if (!resourceOk) {
            return null;
        }
        const [desc, layout] = this._device.fetchBindGroupLayout(this._layout);
        const descriptor = {
            layout: layout,
            entries
        };
        if (layout.label) {
            descriptor.label = `${layout.label}.bindgroup`;
        }
        bindGroup = this._device.gpuCreateBindGroup(descriptor);
        if (!bindGroup) {
            console.error('Create bindgroup failed');
        }
        this._layoutDesc = desc;
        this._entries = entries;
        return bindGroup;
    }
}

const textureWrappingMap = {
    repeat: 'repeat',
    'mirrored-repeat': 'mirror-repeat',
    clamp: 'clamp-to-edge'
};
const textureFilterMap = {
    nearest: 'nearest',
    linear: 'linear',
    none: undefined
};
const compareFuncMap = {
    always: 'always',
    le: 'less-equal',
    ge: 'greater-equal',
    lt: 'less',
    gt: 'greater',
    eq: 'equal',
    ne: 'not-equal',
    never: 'never'
};
const stencilOpMap = {
    keep: 'keep',
    replace: 'replace',
    zero: 'zero',
    invert: 'invert',
    incr: 'increment-clamp',
    decr: 'decrement-clamp',
    'incr-wrap': 'increment-wrap',
    'decr-wrap': 'decrement-wrap'
};
const primitiveTypeMap = {
    'triangle-list': 'triangle-list',
    'triangle-strip': 'triangle-strip',
    'triangle-fan': null,
    'line-list': 'line-list',
    'line-strip': 'line-strip',
    'point-list': 'point-list'
};
const faceModeMap = {
    back: 'back',
    front: 'front',
    none: 'none'
};
const blendEquationMap = {
    add: 'add',
    subtract: 'subtract',
    'reverse-subtract': 'reverse-subtract',
    min: 'min',
    max: 'max'
};
const blendFuncMap = {
    'const-color': 'constant',
    'const-alpha': 'constant',
    'dst-color': 'dst',
    'dst-alpha': 'dst-alpha',
    'inv-const-color': 'one-minus-constant',
    'inv-const-alpha': 'one-minus-constant',
    'inv-dst-color': 'one-minus-dst',
    'inv-dst-alpha': 'one-minus-dst-alpha',
    'src-color': 'src',
    'src-alpha': 'src-alpha',
    'inv-src-color': 'one-minus-src',
    'inv-src-alpha': 'one-minus-src-alpha',
    'src-alpha-saturate': 'src-alpha-saturated',
    one: 'one',
    zero: 'zero'
};
const vertexFormatToHash = {
    float32: '0',
    float32x2: '1',
    float32x3: '2',
    float32x4: '3',
    uint32: '4',
    uint32x2: '5',
    uint32x3: '6',
    uint32x4: '7',
    sint32: '8',
    sint32x2: '9',
    sint32x3: 'a',
    sint32x4: 'b',
    uint16x2: 'c',
    uint16x4: 'd',
    unorm16x2: 'e',
    unorm16x4: 'f',
    sint16x2: 'g',
    sint16x4: 'h',
    snorm16x2: 'i',
    snorm16x4: 'j',
    uint8x2: 'k',
    uint8x4: 'l',
    unorm8x2: 'm',
    unorm8x4: 'n',
    sint8x2: 'o',
    sint8x4: 'p',
    snorm8x2: 'q',
    snorm8x4: 'r'
};
const textureFormatMap = {
    ['rgba8unorm']: 'rgba8unorm',
    ['rgba8snorm']: 'rgba8snorm',
    ['bgra8unorm']: 'bgra8unorm',
    ['dxt1']: 'bc1-rgba-unorm',
    ['dxt3']: 'bc2-rgba-unorm',
    ['dxt5']: 'bc3-rgba-unorm',
    ['dxt1-srgb']: 'bc1-rgba-unorm-srgb',
    ['dxt3-srgb']: 'bc2-rgba-unorm-srgb',
    ['dxt5-srgb']: 'bc3-rgba-unorm-srgb',
    ['bc4']: 'bc4-r-unorm',
    ['bc4-signed']: 'bc4-r-snorm',
    ['bc5']: 'bc5-rg-unorm',
    ['bc5-signed']: 'bc5-rg-snorm',
    ['bc6h']: 'bc6h-rgb-ufloat',
    ['bc6h-signed']: 'bc6h-rgb-float',
    ['bc7']: 'bc7-rgba-unorm',
    ['bc7-srgb']: 'bc7-rgba-unorm-srgb',
    ['astc-4x4']: 'astc-4x4-unorm',
    ['astc-4x4-srgb']: 'astc-4x4-unorm-srgb',
    ['astc-5x4']: 'astc-5x4-unorm',
    ['astc-5x4-srgb']: 'astc-5x4-unorm-srgb',
    ['astc-5x5']: 'astc-5x5-unorm',
    ['astc-5x5-srgb']: 'astc-5x5-unorm-srgb',
    ['astc-6x5']: 'astc-6x5-unorm',
    ['astc-6x5-srgb']: 'astc-6x5-unorm-srgb',
    ['astc-6x6']: 'astc-6x6-unorm',
    ['astc-6x6-srgb']: 'astc-6x6-unorm-srgb',
    ['astc-8x5']: 'astc-8x5-unorm',
    ['astc-8x5-srgb']: 'astc-8x5-unorm-srgb',
    ['astc-8x6']: 'astc-8x6-unorm',
    ['astc-8x6-srgb']: 'astc-8x6-unorm-srgb',
    ['astc-8x8']: 'astc-8x8-unorm',
    ['astc-8x8-srgb']: 'astc-8x8-unorm-srgb',
    ['astc-10x5']: 'astc-10x5-unorm',
    ['astc-10x5-srgb']: 'astc-10x5-unorm-srgb',
    ['astc-10x6']: 'astc-10x6-unorm',
    ['astc-10x6-srgb']: 'astc-10x6-unorm-srgb',
    ['astc-10x8']: 'astc-10x8-unorm',
    ['astc-10x8-srgb']: 'astc-10x8-unorm-srgb',
    ['astc-10x10']: 'astc-10x10-unorm',
    ['astc-10x10-srgb']: 'astc-10x10-unorm-srgb',
    ['astc-12x10']: 'astc-12x10-unorm',
    ['astc-12x10-srgb']: 'astc-12x10-unorm-srgb',
    ['astc-12x12']: 'astc-12x12-unorm',
    ['astc-12x12-srgb']: 'astc-12x12-unorm-srgb',
    ['r8unorm']: 'r8unorm',
    ['r8snorm']: 'r8snorm',
    ['r16f']: 'r16float',
    ['r32f']: 'r32float',
    ['r8ui']: 'r8uint',
    ['r8i']: 'r8sint',
    ['r16ui']: 'r16uint',
    ['r16i']: 'r16sint',
    ['r32ui']: 'r32uint',
    ['r32i']: 'r32sint',
    ['rg8unorm']: 'rg8unorm',
    ['rg8snorm']: 'rg8snorm',
    ['rg16f']: 'rg16float',
    ['rg32f']: 'rg32float',
    ['rg8ui']: 'rg8uint',
    ['rg8i']: 'rg8sint',
    ['rg16ui']: 'rg16uint',
    ['rg16i']: 'rg16sint',
    ['rg32ui']: 'rg32uint',
    ['rg32i']: 'rg32sint',
    ['rgba8unorm-srgb']: 'rgba8unorm-srgb',
    ['bgra8unorm-srgb']: 'bgra8unorm-srgb',
    ['rgba16f']: 'rgba16float',
    ['rgba32f']: 'rgba32float',
    ['rgba8ui']: 'rgba8uint',
    ['rgba8i']: 'rgba8sint',
    ['rgba16ui']: 'rgba16uint',
    ['rgba16i']: 'rgba16sint',
    ['rgba32ui']: 'rgba32uint',
    ['rgba32i']: 'rgba32sint',
    ['rg11b10uf']: 'rg11b10ufloat',
    ['d16']: 'depth16unorm',
    ['d24']: 'depth24plus',
    ['d32f']: 'depth32float',
    ['d32fs8']: 'depth32float-stencil8',
    ['d24s8']: 'depth24plus-stencil8'
};
function zip(keys, values) {
    const ret = {};
    const len = keys.length;
    for(let i = 0; i < len; i++){
        ret[keys[i]] = values[i];
    }
    return ret;
}
const textureFormatInvMap = zip(Object.values(textureFormatMap), Object.keys(textureFormatMap));
const hashToVertexFormat = zip(Object.values(vertexFormatToHash), Object.keys(vertexFormatToHash));

class WebGPUClearQuad {
    static _clearPrograms = {};
    static _clearStateSet = null;
    static _defaultClearColor = new Vector4(0, 0, 0, 1);
    static drawClearQuad(renderPass, clearColor, clearDepth, clearStencil) {
        if (!this._clearStateSet) {
            this.initClearQuad(renderPass);
        }
        const hash = renderPass.getFrameBufferInfo().clearHash;
        const program = this.getClearProgram(renderPass.getDevice(), hash);
        const bClearColor = !!clearColor;
        const bClearDepth = !(clearDepth === null || clearDepth === undefined);
        const bClearStencil = !(clearStencil === null || clearStencil === undefined);
        program.bindGroup.setValue('clearDepth', clearDepth ?? 1);
        program.bindGroup.setValue('clearColor', clearColor ?? this._defaultClearColor);
        this._clearStateSet.useDepthState().enableWrite(bClearDepth);
        this._clearStateSet.useColorState().setColorMask(bClearColor, bClearColor, bClearColor, bClearColor);
        this._clearStateSet.useStencilState().enable(bClearStencil).setReference(bClearStencil ? clearStencil : 0);
        renderPass.getDevice().commandQueue.draw(program.program, null, this._clearStateSet, [
            program.bindGroup
        ], null, 'triangle-strip', 0, 4, 1);
    }
    static getClearProgram(device, hash) {
        let programInfo = this._clearPrograms[hash];
        if (!programInfo) {
            const colorAttachments = hash.split('');
            const program = device.buildRenderProgram({
                label: `ClearQuad-${hash}`,
                vertex (pb) {
                    this.clearDepth = pb.float().uniform(0);
                    this.coords = [
                        pb.vec2(-1, 1),
                        pb.vec2(1, 1),
                        pb.vec2(-1, -1),
                        pb.vec2(1, -1)
                    ];
                    pb.main(function() {
                        this.$builtins.position = pb.vec4(this.coords.at(this.$builtins.vertexIndex), this.clearDepth, 1);
                    });
                },
                fragment (pb) {
                    this.clearColor = pb.vec4().uniform(0);
                    if (colorAttachments.length === 0) {
                        this.$outputs.outColor = pb.vec4();
                        pb.main(function() {
                            this.$outputs.outColor = this.clearColor;
                        });
                    } else {
                        for(let i = 0; i < colorAttachments.length; i++){
                            this.$outputs[`outColor${i}`] = colorAttachments[i] === 'f' ? pb.vec4() : colorAttachments[i] === 'i' ? pb.ivec4() : pb.uvec4();
                        }
                        pb.main(function() {
                            for(let i = 0; i < colorAttachments.length; i++){
                                this.$outputs[`outColor${i}`] = colorAttachments[i] === 'f' ? this.clearColor : colorAttachments[i] === 'i' ? pb.ivec4(this.clearColor) : pb.uvec4(this.clearColor);
                            }
                        });
                    }
                }
            });
            const bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
            programInfo = {
                program,
                bindGroup
            };
            this._clearPrograms[hash] = programInfo;
        }
        return programInfo;
    }
    static initClearQuad(renderPass) {
        this._clearStateSet = renderPass.getDevice().createRenderStateSet();
        this._clearStateSet.useDepthState().enableTest(false);
        this._clearStateSet.useRasterizerState().setCullMode('none');
        this._clearStateSet.useStencilState().enable(true).setFrontOp('replace', 'replace', 'replace').setBackOp('replace', 'replace', 'replace').setFrontCompareFunc('always').setBackCompareFunc('always');
    }
}
class WebGPUMipmapGenerator {
    static _frameBufferInfo = null;
    static _mipmapGenerationProgram = null;
    static _mipmapGenerationStateSet = null;
    static getMipmapGenerationBindGroupLayout(device) {
        if (!this._mipmapGenerationProgram) {
            this.initMipmapGeneration(device);
        }
        return this._mipmapGenerationProgram.bindGroupLayouts[0];
    }
    static generateMipmap(device, tex, cmdEncoder) {
        if (!tex.isRenderable()) {
            return;
        }
        if (!this._mipmapGenerationProgram) {
            this.initMipmapGeneration(device);
        }
        const encoder = cmdEncoder ?? device.device.createCommandEncoder();
        const miplevels = tex.mipLevelCount;
        const numLayers = tex.isTextureCube() ? 6 : tex.isTexture2DArray() ? tex.depth : 1;
        tex.setMipmapDirty(false);
        for(let face = 0; face < numLayers; face++){
            for(let level = 1; level < miplevels; level++){
                this.generateMiplevel(device, encoder, tex, tex.object, tex.gpuFormat, level, level, face);
            }
        }
        if (!cmdEncoder) {
            device.device.queue.submit([
                encoder.finish()
            ]);
        }
    }
    static generateMipmapsForBindGroups(device, bindGroups) {
        for (const bindGroup of bindGroups){
            if (bindGroup) {
                for (const tex of bindGroup.textureList){
                    if (!tex.disposed && tex.isMipmapDirty()) {
                        WebGPUMipmapGenerator.generateMipmap(device, tex);
                    }
                }
            }
        }
    }
    static generateMiplevel(device, commandEncoder, srcTex, dstTex, format, dstLevel, srcLevel, face) {
        const renderPassEncoder = this.beginMipmapGenerationPass(commandEncoder, dstTex, format, dstLevel, face);
        renderPassEncoder.setBindGroup(0, srcTex.getMipmapGenerationBindGroup(srcLevel, face).bindGroup);
        const pipeline = device.pipelineCache.fetchRenderPipeline(this._mipmapGenerationProgram, null, this._mipmapGenerationStateSet, 'triangle-strip', this._frameBufferInfo);
        if (pipeline) {
            renderPassEncoder.setPipeline(pipeline);
            renderPassEncoder.draw(4, 1, 0);
        }
        renderPassEncoder.end();
    }
    static beginMipmapGenerationPass(encoder, texture, format, level, face) {
        const passDesc = {
            colorAttachments: [
                {
                    view: texture.createView({
                        dimension: '2d',
                        baseMipLevel: level || 0,
                        mipLevelCount: 1,
                        baseArrayLayer: face || 0,
                        arrayLayerCount: 1
                    }),
                    loadOp: 'clear',
                    clearValue: [
                        0,
                        0,
                        0,
                        0
                    ],
                    storeOp: 'store'
                }
            ]
        };
        this._frameBufferInfo = {
            frameBuffer: null,
            colorFormats: [
                format
            ],
            depthFormat: null,
            sampleCount: 1,
            hash: null,
            clearHash: null
        };
        this._frameBufferInfo.hash = `${this._frameBufferInfo.colorFormats.join('-')}:${this._frameBufferInfo.depthFormat}:${this._frameBufferInfo.sampleCount}`;
        const renderPassEncoder = encoder.beginRenderPass(passDesc);
        renderPassEncoder.insertDebugMarker('MipmapGeneration');
        return renderPassEncoder;
    }
    static initMipmapGeneration(device) {
        this._mipmapGenerationProgram = device.buildRenderProgram({
            label: 'MipmapGeneration',
            vertex (pb) {
                this.$outputs.outUV = pb.vec2();
                this.coords = [
                    pb.vec2(-1, 1),
                    pb.vec2(1, 1),
                    pb.vec2(-1, -1),
                    pb.vec2(1, -1)
                ];
                this.uv = [
                    pb.vec2(0, 0),
                    pb.vec2(1, 0),
                    pb.vec2(0, 1),
                    pb.vec2(1, 1)
                ];
                pb.main(function() {
                    this.$builtins.position = pb.vec4(this.coords.at(this.$builtins.vertexIndex), 0, 1);
                    this.$outputs.outUV = this.uv.at(this.$builtins.vertexIndex);
                });
            },
            fragment (pb) {
                this.$outputs.color = pb.vec4();
                this.tex = pb.tex2D().uniform(0);
                pb.main(function() {
                    this.$outputs.color = pb.textureSampleLevel(this.tex, this.$inputs.outUV, 0);
                });
            }
        });
        this._mipmapGenerationStateSet = device.createRenderStateSet();
        this._mipmapGenerationStateSet.useDepthState().enableTest(false).enableWrite(false);
        this._mipmapGenerationStateSet.useRasterizerState().setCullMode('none');
    }
}

class WebGPUBaseTexture extends WebGPUObject {
    _target;
    _memCost;
    _views;
    _defaultView;
    _mipmapDirty;
    _flags;
    _width;
    _height;
    _depth;
    _format;
    _renderable;
    _fb;
    _gpuFormat;
    _mipLevelCount;
    _samplerOptions;
    _ringBuffer;
    _mipBindGroups;
    _pendingUploads;
    constructor(device, target){
        super(device);
        this._target = target;
        this._flags = 0;
        this._width = 0;
        this._height = 0;
        this._depth = 0;
        this._renderable = false;
        this._fb = false;
        this._format = null;
        this._gpuFormat = null;
        this._mipLevelCount = 0;
        this._samplerOptions = null;
        this._memCost = 0;
        this._mipmapDirty = false;
        this._mipBindGroups = [];
        this._views = [];
        this._defaultView = null;
        this._ringBuffer = new UploadRingBuffer(device);
        this._pendingUploads = [];
    }
    get hash() {
        return this._object ? this._device.gpuGetObjectHash(this._object) : 0;
    }
    get target() {
        return this._target;
    }
    get width() {
        return this._width;
    }
    get height() {
        return this._height;
    }
    get depth() {
        return this._depth;
    }
    get memCost() {
        return this._memCost;
    }
    get format() {
        return this._format;
    }
    get mipLevelCount() {
        return this._mipLevelCount;
    }
    get gpuFormat() {
        return this._gpuFormat;
    }
    get samplerOptions() {
        return this._samplerOptions;
    }
    set samplerOptions(options) {
        if (this._format) {
            const params = this.getTextureCaps().getTextureFormatInfo(this._format);
            this._samplerOptions = options ? Object.assign({}, this._getSamplerOptions(params, !!options.compare), options) : null;
        } else {
            console.error('Set sampler options failed: texture not initialized');
        }
    }
    isTexture() {
        return true;
    }
    isFilterable() {
        if (!this._format || !this.getTextureCaps().getTextureFormatInfo(this._format)?.filterable) {
            return false;
        }
        return true;
    }
    /** @internal */ clearPendingUploads() {
        if (this._pendingUploads.length > 0) {
            this._pendingUploads = [];
            this.beginSyncChanges(null);
            this.endSyncChanges();
        }
    }
    isMipmapDirty() {
        return this._mipmapDirty;
    }
    setMipmapDirty(b) {
        this._mipmapDirty = b;
    }
    destroy() {
        if (this._object) {
            if (!this.isTextureVideo()) {
                this._object.destroy();
            }
            this._object = null;
            this._device.updateVideoMemoryCost(-this._memCost);
            this._memCost = 0;
            this._ringBuffer.purge();
            this._views = [];
            for (const face of this._mipBindGroups){
                for (const level of face){
                    level?.dispose();
                }
            }
            this._mipBindGroups = [];
        }
    }
    restore() {
        if (!this._object && !this._device.isContextLost()) {
            this.init();
        }
    }
    getTextureCaps() {
        return this._device.getDeviceCaps().textureCaps;
    }
    isSRGBFormat() {
        return !!this._format && isSRGBTextureFormat(this._format);
    }
    isFloatFormat() {
        return !!this._format && isFloatTextureFormat(this._format);
    }
    isIntegerFormat() {
        return !!this._format && isIntegerTextureFormat(this._format);
    }
    isSignedFormat() {
        return !!this._format && isSignedTextureFormat(this._format);
    }
    isCompressedFormat() {
        return !!this._format && isCompressedTextureFormat(this._format);
    }
    isDepth() {
        return !!this._format && hasDepthChannel(this._format);
    }
    isRenderable() {
        return this._renderable;
    }
    getView(level, face, mipCount) {
        level = Number(level) || 0;
        face = Number(face) || 0;
        mipCount = Number(mipCount) || 0;
        if (!this._views[face]) {
            this._views[face] = [];
        }
        if (!this._views[face][level]) {
            this._views[face][level] = [];
        }
        if (!this._views[face][level][mipCount]) {
            this._views[face][level][mipCount] = this.createView(level, face, mipCount);
        }
        return this._views[face][level][mipCount];
    }
    getDefaultView() {
        if (!this._defaultView && this._object && !this.isTextureVideo()) {
            this._defaultView = this._device.gpuCreateTextureView(this._object, {
                dimension: this.isTextureCube() ? 'cube' : this.isTexture3D() ? '3d' : this.isTexture2DArray() ? '2d-array' : '2d',
                arrayLayerCount: this.isTextureCube() ? 6 : this.isTexture2DArray() ? this._depth : 1,
                aspect: hasDepthChannel(this.format) ? 'depth-only' : 'all'
            });
        }
        return this._defaultView;
    }
    copyPixelDataToBuffer(x, y, w, h, layer, level, buffer) {
        if (this.isTextureVideo()) {
            throw new Error('copyPixelDataToBuffer() failed: can not copy pixel data of video texture');
        }
        this.sync();
        WebGPUBaseTexture.copyTexturePixelsToBuffer(this._device.device, this.object, this.format, x, y, w, h, layer, level, buffer);
    }
    generateMipmaps() {
        this._mipmapDirty = true;
        this._device.textureUpload(this);
    }
    beginSyncChanges(encoder) {
        if (!this.isTextureVideo() && this._pendingUploads.length > 0 && this._object) {
            const cmdEncoder = encoder || this._device.device.createCommandEncoder();
            for (const u of this._pendingUploads){
                if (u.mappedBuffer) {
                    const upload = u;
                    cmdEncoder.copyBufferToTexture({
                        buffer: upload.mappedBuffer.buffer,
                        offset: upload.mappedBuffer.offset,
                        bytesPerRow: upload.bufferStride,
                        rowsPerImage: upload.uploadHeight
                    }, {
                        texture: this._object,
                        origin: {
                            x: upload.uploadOffsetX,
                            y: upload.uploadOffsetY,
                            z: upload.uploadOffsetZ
                        },
                        mipLevel: upload.mipLevel
                    }, {
                        width: upload.uploadWidth,
                        height: upload.uploadHeight,
                        depthOrArrayLayers: upload.uploadDepth
                    });
                } else if (u.image) {
                    const upload = u;
                    // FIXME: copy image cannot be queued into the command buffer
                    const copyView = {
                        texture: this._object,
                        origin: {
                            x: upload.offsetX,
                            y: upload.offsetY,
                            z: upload.offsetZ
                        },
                        mipLevel: upload.mipLevel,
                        premultipliedAlpha: false
                    };
                    this._device.device.queue.copyExternalImageToTexture({
                        source: upload.image,
                        origin: {
                            x: upload.srcX,
                            y: upload.srcY
                        }
                    }, copyView, {
                        width: upload.width,
                        height: upload.height,
                        depthOrArrayLayers: upload.depth
                    });
                }
            }
            this._pendingUploads.length = 0;
            if (!encoder) {
                this._device.device.queue.submit([
                    cmdEncoder.finish()
                ]);
            }
            this._ringBuffer.beginUploads();
        }
    }
    endSyncChanges() {
        if (this._flags & GPUResourceUsageFlags.DYNAMIC) {
            this._ringBuffer.endUploads();
        } else {
            this._ringBuffer.purge();
        }
    }
    getDefaultSampler(shadow) {
        const params = this.getTextureCaps().getTextureFormatInfo(this._format);
        return this._device.createSampler(!this._samplerOptions || !this._samplerOptions.compare !== !shadow ? this._getSamplerOptions(params, shadow) : this._samplerOptions);
    }
    /** @internal */ sync() {
        this._device.flush();
    /*
    if (this._pendingUploads) {
      if (this._device.isTextureUploading(this as WebGPUBaseTexture)) {
        this._device.currentPass.end();
      } else {
        this.beginSyncChanges(null);
        this.endSyncChanges();
      }
    }
    */ }
    /** @internal */ _calcMipLevelCount(format, width, height, _depth) {
        if (hasDepthChannel(format) || this.isTexture3D() || this.isTextureVideo()) {
            return 1;
        }
        if (this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP) {
            return 1;
        }
        const params = this.getTextureCaps().getTextureFormatInfo(format);
        if (!params || !params.renderable) {
            return 1;
        }
        return Math.floor(Math.log2(Math.max(width, height))) + 1;
    }
    /** @internal */ allocInternal(format, width, height, depth, numMipLevels) {
        if (this.isTextureVideo()) {
            return;
        }
        if (numMipLevels === 0) {
            numMipLevels = this._calcMipLevelCount(format, width, height, depth);
        } else if (numMipLevels !== 1) {
            let size = Math.max(width, height);
            if (this.isTexture3D()) {
                size = Math.max(size, depth);
            }
            const autoMipLevelCount = Math.floor(Math.log2(size)) + 1; //this._calcMipLevelCount(format, width, height, depth);
            //const autoMipLevelCount = this._calcMipLevelCount(format, width, height, depth);
            if (!Number.isInteger(numMipLevels) || numMipLevels < 0 || numMipLevels > autoMipLevelCount) {
                numMipLevels = autoMipLevelCount;
            }
        }
        if (this._object && (this._format !== format || this._width !== width || this._height !== height || this._depth !== depth, this._mipLevelCount !== numMipLevels)) {
            const obj = this._object;
            this._device.runNextFrame(()=>{
                obj.destroy();
            });
            this._object = null;
        }
        if (!this._object) {
            this._format = format;
            this._width = width;
            this._height = height;
            this._depth = depth;
            this._mipLevelCount = numMipLevels;
            if (!this._device.isContextLost()) {
                this._gpuFormat = textureFormatMap[this._format];
                const params = this.getTextureCaps().getTextureFormatInfo(this._format);
                this._renderable = params.renderable && !(this._flags & GPUResourceUsageFlags.TF_WRITABLE);
                this._object = this._device.gpuCreateTexture({
                    size: {
                        width: this._width,
                        height: this._height,
                        depthOrArrayLayers: this.isTextureCube() ? 6 : this._depth
                    },
                    format: this._gpuFormat,
                    mipLevelCount: this._mipLevelCount,
                    sampleCount: 1,
                    dimension: this.isTexture3D() ? '3d' : '2d',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | (this._renderable && !this.isTexture3D() ? GPUTextureUsage.RENDER_ATTACHMENT : 0) | (this._flags & GPUResourceUsageFlags.TF_WRITABLE ? GPUTextureUsage.STORAGE_BINDING : 0)
                });
                const memCost = this.getTextureCaps().calcMemoryUsage(this._format, this._width * this._height * (this.isTextureCube() ? 6 : this._depth));
                this._device.updateVideoMemoryCost(memCost - this._memCost);
                this._memCost = memCost;
            }
        }
    }
    static calculateBufferSizeForCopy(width, height, format) {
        const blockWidth = getTextureFormatBlockWidth(format);
        const blockHeight = getTextureFormatBlockHeight(format);
        const blockSize = getTextureFormatBlockSize(format);
        const blocksPerRow = Math.ceil(width / blockWidth);
        const blocksPerCol = Math.ceil(height / blockHeight);
        const rowStride = blocksPerRow * blockSize;
        const bufferStride = rowStride + 255 & -256;
        const size = blocksPerCol * rowStride;
        const sizeAligned = blocksPerCol * bufferStride;
        return {
            size,
            sizeAligned,
            strideAligned: bufferStride,
            stride: rowStride,
            numRows: blocksPerCol
        };
    }
    /** @internal */ static copyTexturePixelsToBuffer(device, texture, format, x, y, w, h, layer, level, buffer) {
        if (!(buffer.gpuUsage & GPUBufferUsage.COPY_DST)) {
            console.error('copyTexturePixelsToBuffer() failed: destination buffer does not have COPY_DST usage set');
            return;
        }
        const { size, sizeAligned, stride, strideAligned, numRows } = this.calculateBufferSizeForCopy(w, h, format);
        if (buffer.byteLength < size) {
            console.error(`copyTexturePixelsToBuffer() failed: destination buffer size is ${buffer.byteLength}, should be at least ${size}`);
            return;
        }
        const tmpBuffer = device.createBuffer({
            size: sizeAligned,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({
            texture: texture,
            mipLevel: level ?? 0,
            origin: {
                x: x,
                y: y,
                z: layer ?? 0
            }
        }, {
            buffer: tmpBuffer,
            offset: 0,
            bytesPerRow: strideAligned
        }, {
            width: w,
            height: h,
            depthOrArrayLayers: 1
        });
        if (size !== sizeAligned) {
            for(let i = 0; i < numRows; i++){
                encoder.copyBufferToBuffer(tmpBuffer, i * strideAligned, buffer.object, i * stride, stride);
            }
        } else {
            encoder.copyBufferToBuffer(tmpBuffer, 0, buffer.object, 0, size);
        }
        device.queue.submit([
            encoder.finish()
        ]);
        tmpBuffer.destroy();
    }
    /** @internal */ uploadRaw(pixels, width, height, depth, offsetX, offsetY, offsetZ, miplevel) {
        if (this.isTextureVideo()) {
            console.error('BaseTexture.uploadRaw(): Cannot upload to video texture');
            return;
        }
        const data = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
        const info = this.getTextureCaps().getTextureFormatInfo(this._format);
        const blockWidth = info.blockWidth || 1;
        const blockHeight = info.blockHeight || 1;
        const blocksPerRow = Math.ceil(width / blockWidth);
        const blocksPerCol = Math.ceil(height / blockHeight);
        const rowStride = blocksPerRow * info.size;
        if (rowStride * blocksPerCol * depth > data.byteLength) {
            throw new Error(`WebGPUTexture.update() invalid data size: ${data.byteLength}`);
        }
        if (!this._device.isTextureUploading(this)) {
            this.clearPendingUploads();
            //this._device.textureUpload(this as WebGPUBaseTexture);
            const destination = {
                texture: this._object,
                mipLevel: miplevel,
                origin: {
                    x: offsetX,
                    y: offsetY,
                    z: offsetZ
                }
            };
            const dataLayout = {
                bytesPerRow: rowStride,
                rowsPerImage: blockHeight * blocksPerCol
            };
            const size = {
                width: blockWidth * blocksPerRow,
                height: blockHeight * blocksPerCol,
                depthOrArrayLayers: depth
            };
            this._device.device.queue.writeTexture(destination, data, dataLayout, size);
        } else {
            const bufferStride = rowStride + 255 & -256; // align to 256 bytes
            const uploadSize = bufferStride * blocksPerCol * depth;
            const upload = this._ringBuffer.uploadBuffer(null, null, 0, 0, uploadSize);
            const mappedRange = upload.mappedBuffer.mappedRange;
            const src = new Uint8Array(data);
            const dst = new Uint8Array(mappedRange, upload.mappedBuffer.offset, uploadSize);
            if (uploadSize === data.byteLength) {
                dst.set(new Uint8Array(data));
            } else {
                for(let d = 0; d < depth; d++){
                    const srcLayerOffset = d * rowStride * blocksPerRow;
                    const dstLayerOffset = d * bufferStride * blocksPerCol;
                    for(let i = 0; i < blocksPerCol; i++){
                        dst.set(src.subarray(srcLayerOffset + i * rowStride, srcLayerOffset + (i + 1) * rowStride), dstLayerOffset + i * bufferStride);
                    }
                }
            }
            this._pendingUploads.push({
                mappedBuffer: upload.mappedBuffer,
                uploadOffsetX: offsetX,
                uploadOffsetY: offsetY,
                uploadOffsetZ: offsetZ,
                uploadWidth: blockWidth * blocksPerRow,
                uploadHeight: blockHeight * blocksPerCol,
                uploadDepth: depth,
                bufferStride: bufferStride,
                mipLevel: miplevel
            });
            this._device.textureUpload(this);
        }
    }
    /** @internal */ uploadImageData(data, srcX, srcY, width, height, destX, destY, miplevel, layer) {
        if (this.isTextureVideo()) {
            console.error('BaseTexture.uploadImageData(): Cannot upload to video texture');
            return;
        }
        if (!this._device.isTextureUploading(this) && this._device.device.queue.copyExternalImageToTexture) {
            this.clearPendingUploads();
            const copyView = {
                texture: this._object,
                origin: {
                    x: destX,
                    y: destY,
                    z: layer ?? 0
                },
                mipLevel: miplevel ?? 0,
                premultipliedAlpha: false
            };
            this._device.device.queue.copyExternalImageToTexture({
                source: data
            }, copyView, {
                width: width,
                height: height,
                depthOrArrayLayers: 1
            });
        } else {
            this._pendingUploads.push({
                image: data,
                offsetX: destX,
                offsetY: destY,
                offsetZ: layer ?? 0,
                srcX: srcX ?? 0,
                srcY: srcY ?? 0,
                srcZ: 0,
                width: width,
                height: height,
                depth: 1,
                mipLevel: miplevel ?? 0
            });
            this._device.textureUpload(this);
        }
    }
    getMipmapGenerationBindGroup(level, face) {
        const faceGroups = this._mipBindGroups;
        let levelGroups = faceGroups[face];
        if (!levelGroups) {
            levelGroups = [];
            faceGroups[face] = levelGroups;
        }
        let levelGroup = levelGroups[level];
        if (!levelGroup) {
            levelGroup = this._device.createBindGroup(WebGPUMipmapGenerator.getMipmapGenerationBindGroupLayout(this._device));
            levelGroup.setTextureView('tex', this, level - 1, face, 1);
            levelGroups[level] = levelGroup;
        }
        return levelGroup;
    }
    /** @internal */ _getSamplerOptions(params, shadow) {
        const comparison = this.isDepth() && shadow;
        const filterable = params.filterable || comparison;
        const magFilter = filterable ? 'linear' : 'nearest';
        const minFilter = params.filterable ? 'linear' : 'nearest';
        const mipFilter = this._mipLevelCount > 1 ? filterable ? 'linear' : 'nearest' : 'none';
        return {
            addressU: 'clamp',
            addressV: 'clamp',
            addressW: 'clamp',
            magFilter,
            minFilter,
            mipFilter,
            lodMin: 0,
            lodMax: 32,
            maxAnisotropy: 1,
            compare: comparison ? 'lt' : null
        };
    }
    /** @internal */ _markAsCurrentFB(b) {
        this._fb = b;
    }
    /** @internal */ _isMarkedAsCurrentFB() {
        return this._fb;
    }
}

class WebGPUTexture2D extends WebGPUBaseTexture {
    constructor(device){
        super(device, '2d');
    }
    isTexture2D() {
        return true;
    }
    init() {
        this.loadEmpty(this._format, this._width, this._height, this._mipLevelCount);
    }
    update(data, xOffset, yOffset, width, height) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, 1, this._mipLevelCount);
        }
        this.uploadRaw(data, width, height, 1, xOffset, yOffset, 0, 0);
        if (this._mipLevelCount > 1) {
            this.generateMipmaps();
        }
    }
    updateFromElement(data, destX, destY, srcX, srcY, width, height) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, 1, this._mipLevelCount);
        }
        if (data instanceof HTMLCanvasElement || this._device.isTextureUploading(this)) {
            // Copy the pixel values out in case the canvas content may be changed later
            const cvs = document.createElement('canvas');
            cvs.width = width;
            cvs.height = height;
            const ctx = cvs.getContext('2d');
            ctx.drawImage(data, srcX, srcY, width, height, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            this.update(imageData.data, destX, destY, width, height);
            cvs.width = 0;
            cvs.height = 0;
        } else {
            this.uploadImageData(data, srcX, srcY, width, height, destX, destY, 0, 0);
        }
    }
    async readPixels(x, y, w, h, faceOrLayer, mipLevel, buffer) {
        if (faceOrLayer !== 0) {
            throw new Error(`Texture2D.readPixels(): parameter faceOrLayer must be 0`);
        }
        if (mipLevel >= this.mipLevelCount || mipLevel < 0) {
            throw new Error(`Texture2D.readPixels(): invalid miplevel: ${mipLevel}`);
        }
        const { size } = WebGPUBaseTexture.calculateBufferSizeForCopy(w, h, this.format);
        if (buffer.byteLength < size) {
            throw new Error(`Texture2D.readPixels() failed: destination buffer size is ${buffer.byteLength}, should be at least ${size}`);
        }
        const tmpBuffer = this._device.createBuffer(size, {
            usage: 'read'
        });
        await this.copyPixelDataToBuffer(x, y, w, h, 0, mipLevel, tmpBuffer);
        await tmpBuffer.getBufferSubData(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), 0, size);
        tmpBuffer.dispose();
    }
    readPixelsToBuffer(x, y, w, h, faceOrLayer, mipLevel, buffer) {
        if (faceOrLayer !== 0) {
            throw new Error(`Texture2D.readPixels(): parameter faceOrLayer must be 0`);
        }
        if (mipLevel >= this.mipLevelCount || mipLevel < 0) {
            throw new Error(`Texture2D.readPixels(): invalid miplevel: ${mipLevel}`);
        }
        this.copyPixelDataToBuffer(x, y, w, h, 0, mipLevel, buffer);
    }
    loadFromElement(element, sRGB, creationFlags) {
        this._flags = Number(creationFlags) || 0;
        const format = sRGB ? 'rgba8unorm-srgb' : 'rgba8unorm';
        this.loadImage(element, format);
    }
    createEmpty(format, width, height, creationFlags) {
        this._flags = Number(creationFlags) || 0;
        this.loadEmpty(format, width, height, 0);
    }
    createView(level, face, mipCount) {
        return this._object ? this._device.gpuCreateTextureView(this._object, {
            dimension: '2d',
            baseMipLevel: level ?? 0,
            mipLevelCount: mipCount || this._mipLevelCount - (level ?? 0),
            baseArrayLayer: 0,
            arrayLayerCount: 1
        }) : null;
    }
    createWithMipmapData(data, sRGB, creationFlags) {
        if (data.isCubemap || data.isVolume) {
            console.error('loading 2d texture with mipmap data failed: data is not 2d texture');
        } else {
            this._flags = Number(creationFlags) || 0;
            if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
                console.error(new Error('webgl device does not support storage texture'));
            } else {
                this.loadLevels(data, sRGB);
            }
        }
    }
    /** @internal */ loadEmpty(format, width, height, numMipLevels) {
        this.allocInternal(format, width, height, 1, numMipLevels);
        if (this._mipLevelCount > 1 && !this._device.isContextLost()) {
            this.generateMipmaps();
        }
    }
    /** @internal */ loadLevels(levels, sRGB) {
        let format = sRGB ? linearTextureFormatToSRGB(levels.format) : levels.format;
        let swizzle = false;
        if (format === 'bgra8unorm') {
            format = 'rgba8unorm';
            swizzle = true;
        } else if (this._format === 'bgra8unorm-srgb') {
            format = 'rgba8unorm-srgb';
            swizzle = true;
        }
        const width = levels.width;
        const height = levels.height;
        const mipLevelCount = levels.mipLevels;
        if (levels.isCompressed) {
            if (!this.getTextureCaps().supportS3TCSRGB || !this.getTextureCaps().supportS3TC) {
                console.error('No s3tc compression format support');
                return;
            }
        }
        this.allocInternal(format, width, height, 1, mipLevelCount);
        if (!this._device.isContextLost()) {
            for(let i = 0; i < levels.mipDatas[0].length; i++){
                if (swizzle) {
                    // convert bgra to rgba
                    for(let j = 0; j < levels.mipDatas[0][i].width * levels.mipDatas[0][i].height; j++){
                        const t = levels.mipDatas[0][i].data[j * 4];
                        levels.mipDatas[0][i].data[j * 4] = levels.mipDatas[0][i].data[j * 4 + 2];
                        levels.mipDatas[0][i].data[j * 4 + 2] = t;
                    }
                }
                this.uploadRaw(levels.mipDatas[0][i].data, levels.mipDatas[0][i].width, levels.mipDatas[0][i].height, 1, 0, 0, 0, i);
            }
        }
    }
    /** @internal */ loadImage(element, format) {
        this.allocInternal(format, Number(element.width), Number(element.height), 1, 0);
        if (!this._device.isContextLost()) {
            this.updateFromElement(element, 0, 0, 0, 0, this._width, this._height);
            if (this._mipLevelCount > 1) {
                this.generateMipmaps();
            }
        }
    }
}

class WebGPUTexture2DArray extends WebGPUBaseTexture {
    constructor(device){
        super(device, '2darray');
    }
    isTexture2DArray() {
        return true;
    }
    init() {
        this.loadEmpty(this._format, this._width, this._height, this._depth, this._mipLevelCount);
    }
    update(data, xOffset, yOffset, zOffset, width, height, depth) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, this._depth, this._mipLevelCount);
        }
        this.uploadRaw(data, width, height, depth, xOffset, yOffset, zOffset, 0);
        if (this._mipLevelCount > 1) {
            this.generateMipmaps();
        }
    }
    updateFromElement(data, destX, destY, destZ, srcX, srcY, width, height) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, this._depth, this._mipLevelCount);
        }
        if (data instanceof HTMLCanvasElement || this._device.isTextureUploading(this)) {
            // Copy the pixel values out in case the canvas content may be changed later
            const cvs = document.createElement('canvas');
            cvs.width = width;
            cvs.height = height;
            const ctx = cvs.getContext('2d');
            ctx.drawImage(data, srcX, srcY, width, height, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            this.update(imageData.data, destX, destY, destZ, width, height, 1);
            cvs.width = 0;
            cvs.height = 0;
        } else {
            this.uploadImageData(data, srcX, srcY, width, height, destX, destY, 0, destZ);
        }
    }
    createEmpty(format, width, height, depth, creationFlags) {
        this._flags = Number(creationFlags) || 0;
        this.loadEmpty(format, width, height, depth, 0);
    }
    createWithMipmapData(data, creationFlags) {
        if (!data.arraySize) {
            console.error('Texture2DArray.createWithMipmapData() failed: Data is not texture array');
        } else {
            this._flags = Number(creationFlags) || 0;
            if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
                console.error('Texture2DArray.createWithMipmapData() failed: Webgl device does not support storage texture');
            } else {
                this.loadLevels(data);
            }
        }
    }
    createView(level, face, mipCount) {
        return this._object ? this._device.gpuCreateTextureView(this._object, {
            dimension: '2d',
            baseMipLevel: level ?? 0,
            mipLevelCount: mipCount || this._mipLevelCount - (level ?? 0),
            baseArrayLayer: face ?? 0,
            arrayLayerCount: 1
        }) : null;
    }
    async readPixels(x, y, w, h, layer, mipLevel, buffer) {
        if (layer < 0 || layer >= this._depth) {
            throw new Error(`Texture2DArray.readPixels(): invalid layer: ${layer}`);
        }
        if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
            throw new Error(`Texture2DArray.readPixels(): invalid miplevel: ${mipLevel}`);
        }
        const { size } = WebGPUBaseTexture.calculateBufferSizeForCopy(w, h, this.format);
        if (buffer.byteLength < size) {
            throw new Error(`Texture2D.readPixels() failed: destination buffer size is ${buffer.byteLength}, should be at least ${size}`);
        }
        const tmpBuffer = this._device.createBuffer(size, {
            usage: 'read'
        });
        await this.copyPixelDataToBuffer(x, y, w, h, layer, mipLevel, tmpBuffer);
        await tmpBuffer.getBufferSubData(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), 0, size);
        tmpBuffer.dispose();
    }
    readPixelsToBuffer(x, y, w, h, layer, mipLevel, buffer) {
        if (layer < 0 || layer >= this._depth) {
            throw new Error(`Texture2DArray.readPixelsToBuffer(): invalid layer: ${layer}`);
        }
        if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
            throw new Error(`Texture2DArray.readPixelsToBuffer(): invalid miplevel: ${mipLevel}`);
        }
        this.copyPixelDataToBuffer(x, y, w, h, layer, mipLevel, buffer);
    }
    loadEmpty(format, width, height, depth, numMipLevels) {
        this.allocInternal(format, width, height, depth, numMipLevels);
        if (this._mipLevelCount > 1 && !this._device.isContextLost()) {
            this.generateMipmaps();
        }
    }
    loadLevels(levels) {
        const format = levels.format;
        const width = levels.width;
        const height = levels.height;
        const depth = levels.arraySize;
        const mipLevelCount = levels.mipLevels === 1 && !(this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP) ? this._calcMipLevelCount(levels.format, width, height, depth) : levels.mipLevels;
        if (levels.isCompressed) {
            if (!this.getTextureCaps().supportS3TCSRGB || !this.getTextureCaps().supportS3TC) {
                console.error('Texture2DArray.loadLevels(): No s3tc compression format support');
                return;
            }
        }
        this.allocInternal(format, width, height, levels.arraySize, mipLevelCount);
        if (!this._device.isContextLost()) {
            for(let layer = 0; layer < levels.arraySize; layer++){
                if (levels.mipDatas[layer].length !== levels.mipLevels) {
                    console.error(`Texture2DArray.loadLevels() failed: Invalid texture data`);
                    return;
                }
                for(let i = 0; i < levels.mipLevels; i++){
                    this.uploadRaw(levels.mipDatas[layer][i].data, levels.mipDatas[layer][i].width, levels.mipDatas[layer][i].height, 1, 0, 0, layer, i);
                }
            }
            if (levels.mipLevels !== this.mipLevelCount) {
                this.generateMipmaps();
            }
        }
    }
}

class WebGPUTexture3D extends WebGPUBaseTexture {
    constructor(device){
        super(device, '3d');
    }
    isTexture3D() {
        return true;
    }
    init() {
        this.loadEmpty(this._format, this._width, this._height, this._depth, this._mipLevelCount);
    }
    update(data, xOffset, yOffset, zOffset, width, height, depth) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, this._depth, this._mipLevelCount);
        }
        this.uploadRaw(data, width, height, depth, xOffset, yOffset, zOffset, 0);
    }
    createEmpty(format, width, height, depth, creationFlags) {
        this._flags = Number(creationFlags) || 0;
        this.loadEmpty(format, width, height, depth, 0);
    }
    createView(_level, face, _mipCount) {
        return this._object ? this._device.gpuCreateTextureView(this._object, {
            dimension: '2d',
            baseMipLevel: 0,
            mipLevelCount: 1,
            baseArrayLayer: face,
            arrayLayerCount: 1
        }) : null;
    }
    async readPixels(x, y, w, h, layer, mipLevel, buffer) {
        if (mipLevel !== 0) {
            throw new Error(`Texture3D.readPixels(): parameter mipLevel must be 0`);
        }
        const { size } = WebGPUBaseTexture.calculateBufferSizeForCopy(w, h, this.format);
        if (buffer.byteLength < size) {
            throw new Error(`Texture2D.readPixels() failed: destination buffer size is ${buffer.byteLength}, should be at least ${size}`);
        }
        const tmpBuffer = this._device.createBuffer(size, {
            usage: 'read'
        });
        await this.copyPixelDataToBuffer(x, y, w, h, layer, 0, tmpBuffer);
        await tmpBuffer.getBufferSubData(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), 0, size);
        tmpBuffer.dispose();
    }
    readPixelsToBuffer(x, y, w, h, layer, mipLevel, buffer) {
        if (mipLevel !== 0) {
            throw new Error(`Texture3D.readPixelsToBuffer(): parameter mipLevel must be 0`);
        }
        this.copyPixelDataToBuffer(x, y, w, h, layer, 0, buffer);
    }
    createWithMipmapData(data, creationFlags) {
        if (!data.arraySize) {
            console.error('Texture2DArray.createWithMipmapData() failed: Data is not texture array');
        } else {
            this._flags = Number(creationFlags) || 0;
            if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
                console.error('Texture2DArray.createWithMipmapData() failed: Webgl device does not support storage texture');
            } else {
                this.loadLevels(data);
            }
        }
    }
    loadLevels(levels) {
        const format = levels.format;
        const width = levels.width;
        const height = levels.height;
        const depth = levels.depth;
        const mipLevelCount = levels.mipLevels === 1 && !(this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP) ? this._calcMipLevelCount(levels.format, width, height, depth) : levels.mipLevels;
        if (levels.isCompressed) {
            if (!this.getTextureCaps().supportS3TCSRGB || !this.getTextureCaps().supportS3TC) {
                console.error('Texture3D.loadLevels(): No s3tc compression format support');
                return;
            }
        }
        this.allocInternal(format, width, height, depth, mipLevelCount);
        if (!this._device.isContextLost()) {
            for(let layer = 0; layer < depth; layer++){
                if (levels.mipDatas[layer].length !== levels.mipLevels) {
                    console.error(`Texture3D.loadLevels() failed: Invalid texture data`);
                    return;
                }
                for(let i = 0; i < levels.mipLevels; i++){
                    this.uploadRaw(levels.mipDatas[layer][i].data, levels.mipDatas[layer][i].width, levels.mipDatas[layer][i].height, 1, 0, 0, layer, i);
                }
            }
            if (levels.mipLevels !== this.mipLevelCount) {
                this.generateMipmaps();
            }
        }
    }
    loadEmpty(format, width, height, depth, numMipLevels) {
        this.allocInternal(format, width, height, depth, numMipLevels);
        if (this._mipLevelCount > 1 && !this._device.isContextLost()) {
            this.generateMipmaps();
        }
    }
}

class WebGPUTextureCube extends WebGPUBaseTexture {
    constructor(device){
        super(device, 'cube');
    }
    init() {
        this.loadEmpty(this._format, this._width, this._mipLevelCount);
    }
    update(data, xOffset, yOffset, width, height, face) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, 1, this._mipLevelCount);
        }
        this.uploadRaw(data, width, height, 1, xOffset, yOffset, face, 0);
        if (this._mipLevelCount > 1) {
            this.generateMipmaps();
        }
    }
    updateFromElement(data, destX, destY, face, srcX, srcY, width, height) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, 1, this._mipLevelCount);
        }
        if (data instanceof HTMLCanvasElement || this._device.isTextureUploading(this)) {
            // Copy the pixel values out in case the canvas content may be changed later
            const cvs = document.createElement('canvas');
            cvs.width = width;
            cvs.height = height;
            const ctx = cvs.getContext('2d');
            ctx.drawImage(data, srcX, srcY, width, height, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            this.update(imageData.data, destX, destY, width, height, face);
            cvs.width = 0;
            cvs.height = 0;
        } else {
            this.uploadImageData(data, srcX, srcY, width, height, destX, destY, 0, face);
        }
    }
    createEmpty(format, size, creationFlags) {
        this._flags = Number(creationFlags) || 0;
        if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
            console.error(new Error('storage texture can not be cube texture'));
        } else {
            this.loadEmpty(format, size, 0);
        }
    }
    isTextureCube() {
        return true;
    }
    createView(level, face, mipCount) {
        return this._object ? this._device.gpuCreateTextureView(this._object, {
            format: this._gpuFormat,
            dimension: '2d',
            baseMipLevel: level ?? 0,
            mipLevelCount: mipCount || this._mipLevelCount - (level ?? 0),
            baseArrayLayer: face ?? 0,
            arrayLayerCount: 1,
            aspect: 'all'
        }) : null;
    }
    async readPixels(x, y, w, h, face, mipLevel, buffer) {
        if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
            throw new Error(`TextureCube.readPixels(): invalid miplevel: ${mipLevel}`);
        }
        const { size } = WebGPUBaseTexture.calculateBufferSizeForCopy(w, h, this.format);
        if (buffer.byteLength < size) {
            throw new Error(`Texture2D.readPixels() failed: destination buffer size is ${buffer.byteLength}, should be at least ${size}`);
        }
        const tmpBuffer = this._device.createBuffer(size, {
            usage: 'read'
        });
        await this.copyPixelDataToBuffer(x, y, w, h, face, mipLevel, tmpBuffer);
        await tmpBuffer.getBufferSubData(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), 0, size);
        tmpBuffer.dispose();
    }
    readPixelsToBuffer(x, y, w, h, face, mipLevel, buffer) {
        if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
            throw new Error(`TextureCube.readPixelsToBuffer(): invalid miplevel: ${mipLevel}`);
        }
        this.copyPixelDataToBuffer(x, y, w, h, face, mipLevel, buffer);
    }
    createWithMipmapData(data, sRGB, creationFlags) {
        if (!data.isCubemap) {
            console.error('loading cubmap with mipmap data failed: data is not cubemap');
        } else {
            this._flags = Number(creationFlags) || 0;
            if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
                console.error('webgl device does not support storage texture');
            } else {
                this.loadLevels(data, sRGB);
            }
        }
    }
    /** @internal */ loadEmpty(format, size, mipLevelCount) {
        this.allocInternal(format, size, size, 1, mipLevelCount);
        if (this._mipLevelCount > 1 && !this._device.isContextLost()) {
            this.generateMipmaps();
        }
    }
    /** @internal */ /*
  private loadImages(images: HTMLImageElement[], format: TextureFormat): void {
    const width = images[0].width;
    const height = images[0].height;
    if (images.length !== 6) {
      console.error(new Error('cubemap face list must have 6 images'));
      return;
    }
    for (let i = 1; i < 6; i++) {
      if (images[i].width !== width || images[i].height !== height) {
        console.error(new Error('cubemap face images must have identical sizes'));
        return;
      }
    }
    if (width === 0 || height === 0) {
      return;
    }
    this.allocInternal(format, width, height, 1, 0);
    if (!this._device.isContextLost()) {
      const w = this._width;
      const h = this._height;
      for (let face = 0; face < 6; face++) {
        createImageBitmap(images[face], {
          premultiplyAlpha: 'none'
        }).then((bmData) => {
          this.updateFromElement(bmData, 0, 0, face, 0, 0, w, h);
        });
      }
      if (this._mipLevelCount > 1) {
        this.generateMipmaps();
      }
    }
  }
  */ /** @internal */ loadLevels(levels, sRGB) {
        const format = sRGB ? linearTextureFormatToSRGB(levels.format) : levels.format;
        const width = levels.width;
        const height = levels.height;
        //const mipLevelCount = levels.mipLevels;
        const mipLevelCount = levels.mipLevels === 1 && !(this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP) ? this._calcMipLevelCount(levels.format, width, height, 1) : levels.mipLevels;
        if (levels.isCompressed) {
            if (!this.getTextureCaps().supportS3TCSRGB || !this.getTextureCaps().supportS3TC) {
                console.error('TextureCube.loadLevels(): No s3tc compression format support');
                return;
            }
        }
        this.allocInternal(format, width, height, 1, mipLevelCount);
        if (!this._device.isContextLost()) {
            for(let face = 0; face < 6; face++){
                if (levels.mipDatas[face].length !== levels.mipLevels) {
                    console.error(`TextureCube.loadLevels() failed: Invalid texture data`);
                    return;
                }
                for(let i = 0; i < levels.mipLevels; i++){
                    this.uploadRaw(levels.mipDatas[face][i].data, levels.mipDatas[face][i].width, levels.mipDatas[face][i].height, 1, 0, 0, face, i);
                }
            }
        }
        if (levels.mipLevels !== this.mipLevelCount) {
            this.generateMipmaps();
        }
    }
}

class WebGPUTextureVideo extends WebGPUBaseTexture {
    _source;
    _refBindGroups;
    constructor(device, element){
        super(device, '2d');
        this._source = element;
        this._width = 0;
        this._height = 0;
        this._refBindGroups = [];
        this.loadFromElement();
    }
    isTextureVideo() {
        return true;
    }
    addBindGroupReference(bindGroup) {
        this._refBindGroups.push(bindGroup);
    }
    removeBindGroupReference(bindGroup) {
        const index = this._refBindGroups.indexOf(bindGroup);
        if (index >= 0) {
            this._refBindGroups.splice(index, 1);
        }
    }
    get width() {
        return this._width;
    }
    get height() {
        return this._height;
    }
    get source() {
        return this._source;
    }
    restore() {
        if (!this._object && !this._device.isContextLost()) {
            this.loadElement(this._source);
        }
    }
    updateVideoFrame() {
        if (this._source.readyState > 2) {
            const videoFrame = new window.VideoFrame(this._source);
            videoFrame.close();
            this._object = this._device.gpuImportExternalTexture(this._source);
            return true;
        }
        return false;
    }
    createView(_level, _face, _mipCount) {
        return null;
    }
    init() {
        this.loadFromElement();
    }
    async readPixels(_x, _y, _w, _h, _faceOrLayer, _mipLevel, _buffer) {
        throw new Error(`Video texture does not support readPixels()`);
    }
    readPixelsToBuffer(_x, _y, _w, _h, _faceOrLayer, _mipLevel, _buffer) {
        throw new Error(`Video texture does not support readPixelsToBuffer()`);
    }
    /** @internal */ loadFromElement() {
        this.loadElement(this._source);
    }
    /** @internal */ loadElement(element) {
        this._format = 'rgba8unorm';
        this._width = element.videoWidth;
        this._height = element.videoHeight;
        this._depth = 1;
        this._mipLevelCount = 1;
        if (!this._device.isContextLost()) {
            if (element.readyState > 2) {
                this._object = this._device.gpuImportExternalTexture(element);
                const that = this;
                this._device.runNextFrame(function updateVideoFrame() {
                    if (!that.disposed) {
                        if (that._source.readyState > 2) {
                            const videoFrame = new window.VideoFrame(that._source);
                            videoFrame.close();
                            that._object = that._device.gpuImportExternalTexture(that._source);
                            for (const bindGroup of that._refBindGroups){
                                bindGroup.invalidate();
                            }
                        }
                        that._device.runNextFrame(updateVideoFrame);
                    }
                });
            }
        }
        return !!this._object;
    }
}

class WebGPUFramebufferCaps {
    maxDrawBuffers;
    maxColorAttachmentBytesPerSample;
    supportRenderMipmap;
    supportMultisampledFramebuffer;
    supportFloatBlending;
    supportDepth32float;
    supportDepth32floatStencil8;
    constructor(device){
        this.maxDrawBuffers = device.device.limits.maxColorAttachments;
        this.maxColorAttachmentBytesPerSample = device.device.limits.maxColorAttachmentBytesPerSample;
        this.supportRenderMipmap = true;
        this.supportMultisampledFramebuffer = true;
        this.supportFloatBlending = device.device.features.has('float32-blendable');
        this.supportDepth32float = true;
        this.supportDepth32floatStencil8 = device.device.features.has('depth32float-stencil8');
    }
}
class WebGPUMiscCaps {
    supportOversizedViewport;
    supportBlendMinMax;
    support32BitIndex;
    supportDepthClamp;
    maxBindGroups;
    maxTexCoordIndex;
    constructor(device){
        this.supportOversizedViewport = false;
        this.supportBlendMinMax = true;
        this.support32BitIndex = true;
        this.supportDepthClamp = device.device.features.has('depth-clip-control');
        this.maxBindGroups = 4;
        this.maxTexCoordIndex = 8;
    }
}
class WebGPUShaderCaps {
    supportFragmentDepth;
    supportStandardDerivatives;
    supportShaderTextureLod;
    supportHighPrecisionFloat;
    maxUniformBufferSize;
    uniformBufferOffsetAlignment;
    maxStorageBufferSize;
    storageBufferOffsetAlignment;
    constructor(device){
        this.supportFragmentDepth = true;
        this.supportStandardDerivatives = true;
        this.supportShaderTextureLod = true;
        this.supportHighPrecisionFloat = true;
        this.maxUniformBufferSize = device.device.limits.maxUniformBufferBindingSize || 65536;
        this.uniformBufferOffsetAlignment = device.device.limits.minUniformBufferOffsetAlignment || 256;
        this.maxStorageBufferSize = device.device.limits.maxStorageBufferBindingSize || 128 * 1024 * 1024;
        this.storageBufferOffsetAlignment = device.device.limits.minStorageBufferOffsetAlignment || 256;
    }
}
class WebGPUTextureCaps {
    _textureFormatInfos;
    maxTextureSize;
    maxCubeTextureSize;
    npo2Mipmapping;
    npo2Repeating;
    supportS3TC;
    supportS3TCSRGB;
    supportBPTC;
    supportRGTC;
    supportASTC;
    supportDepthTexture;
    support3DTexture;
    supportSRGBTexture;
    supportFloatTexture;
    supportLinearFloatTexture;
    supportHalfFloatTexture;
    supportLinearHalfFloatTexture;
    supportAnisotropicFiltering;
    supportFloatColorBuffer;
    supportHalfFloatColorBuffer;
    supportFloatBlending;
    constructor(device){
        this.supportAnisotropicFiltering = true;
        this.supportDepthTexture = true;
        this.support3DTexture = true;
        this.supportSRGBTexture = true;
        this.supportFloatTexture = true;
        this.supportFloatColorBuffer = true;
        this.supportHalfFloatColorBuffer = true;
        this.supportFloatBlending = true;
        this.supportS3TC = device.device.features.has('texture-compression-bc');
        this.supportS3TCSRGB = this.supportS3TC;
        this.supportBPTC = this.supportS3TC;
        this.supportRGTC = this.supportS3TC;
        this.supportASTC = device.device.features.has('texture-compression-astc');
        this.supportHalfFloatTexture = true;
        this.maxTextureSize = device.device.limits.maxTextureDimension2D;
        this.maxCubeTextureSize = device.device.limits.maxTextureDimension2D;
        this.npo2Mipmapping = true;
        this.npo2Repeating = true;
        this._textureFormatInfos = {
            ['rgba8unorm']: {
                gpuSampleType: 'float',
                filterable: true,
                renderable: true,
                compressed: false,
                writable: true,
                blockWidth: 1,
                blockHeight: 1,
                size: 4
            },
            ['rgba8snorm']: {
                gpuSampleType: 'float',
                filterable: true,
                renderable: false,
                compressed: false,
                writable: true,
                blockWidth: 1,
                blockHeight: 1,
                size: 4
            },
            ['bgra8unorm']: {
                gpuSampleType: 'float',
                filterable: true,
                renderable: true,
                compressed: false,
                writable: false,
                blockWidth: 1,
                blockHeight: 1,
                size: 4
            }
        };
        if (this.supportASTC) {
            for (const k of [
                '4x4',
                '5x4',
                '5x5',
                '6x5',
                '6x6',
                '8x5',
                '8x6',
                '8x8',
                '10x5',
                '10x6',
                '10x8',
                '10x10',
                '12x10',
                '12x12'
            ]){
                const [w, h] = k.split('x').map((val)=>Number(val));
                this._textureFormatInfos[`astc-${k}`] = {
                    gpuSampleType: 'float',
                    filterable: true,
                    renderable: false,
                    compressed: true,
                    writable: false,
                    size: 16,
                    blockWidth: w,
                    blockHeight: h
                };
                this._textureFormatInfos[`astc-${k}-srgb`] = {
                    gpuSampleType: 'float',
                    filterable: true,
                    renderable: false,
                    compressed: true,
                    size: 16,
                    writable: false,
                    blockWidth: w,
                    blockHeight: h
                };
            }
        }
        if (this.supportS3TC) {
            this._textureFormatInfos['dxt1'] = {
                gpuSampleType: 'float',
                filterable: true,
                renderable: false,
                compressed: true,
                writable: false,
                size: 8,
                blockWidth: 4,
                blockHeight: 4
            };
            this._textureFormatInfos['dxt3'] = {
                gpuSampleType: 'float',
                filterable: true,
                renderable: false,
                compressed: true,
                writable: false,
                size: 16,
                blockWidth: 4,
                blockHeight: 4
            };
            this._textureFormatInfos['dxt5'] = {
                gpuSampleType: 'float',
                filterable: true,
                renderable: false,
                compressed: true,
                writable: false,
                size: 16,
                blockWidth: 4,
                blockHeight: 4
            };
        }
        if (this.supportRGTC) {
            this._textureFormatInfos['bc4'] = {
                gpuSampleType: 'float',
                filterable: true,
                renderable: false,
                compressed: true,
                writable: false,
                size: 8,
                blockWidth: 4,
                blockHeight: 4
            };
            this._textureFormatInfos['bc4-signed'] = {
                gpuSampleType: 'float',
                filterable: true,
                renderable: false,
                compressed: true,
                writable: false,
                size: 8,
                blockWidth: 4,
                blockHeight: 4
            };
        }
        this._textureFormatInfos['bc5'] = {
            gpuSampleType: 'float',
            filterable: true,
            renderable: false,
            compressed: true,
            writable: false,
            size: 16,
            blockWidth: 4,
            blockHeight: 4
        };
        this._textureFormatInfos['bc5-signed'] = {
            gpuSampleType: 'float',
            filterable: true,
            renderable: false,
            compressed: true,
            writable: false,
            size: 16,
            blockWidth: 4,
            blockHeight: 4
        };
        if (this.supportBPTC) {
            this._textureFormatInfos['bc6h'] = {
                gpuSampleType: 'float',
                filterable: true,
                renderable: false,
                compressed: true,
                writable: false,
                size: 16,
                blockWidth: 4,
                blockHeight: 4
            };
            this._textureFormatInfos['bc6h-signed'] = {
                gpuSampleType: 'float',
                filterable: true,
                renderable: false,
                compressed: true,
                writable: false,
                size: 16,
                blockWidth: 4,
                blockHeight: 4
            };
            this._textureFormatInfos['bc7'] = {
                gpuSampleType: 'float',
                filterable: true,
                renderable: false,
                compressed: true,
                writable: false,
                size: 16,
                blockWidth: 4,
                blockHeight: 4
            };
            this._textureFormatInfos['bc7-srgb'] = {
                gpuSampleType: 'float',
                filterable: true,
                renderable: false,
                compressed: true,
                writable: false,
                size: 16,
                blockWidth: 4,
                blockHeight: 4
            };
        }
        if (this.supportS3TCSRGB) {
            this._textureFormatInfos['dxt1-srgb'] = {
                gpuSampleType: 'float',
                filterable: true,
                renderable: false,
                compressed: true,
                writable: false,
                size: 8,
                blockWidth: 4,
                blockHeight: 4
            };
            this._textureFormatInfos['dxt3-srgb'] = {
                gpuSampleType: 'float',
                filterable: true,
                renderable: false,
                compressed: true,
                writable: false,
                size: 16,
                blockWidth: 4,
                blockHeight: 4
            };
            this._textureFormatInfos['dxt5-srgb'] = {
                gpuSampleType: 'float',
                filterable: true,
                renderable: false,
                compressed: true,
                writable: false,
                size: 16,
                blockWidth: 4,
                blockHeight: 4
            };
        }
        this._textureFormatInfos['r8unorm'] = {
            gpuSampleType: 'float',
            filterable: true,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 1
        };
        this._textureFormatInfos['r8snorm'] = {
            gpuSampleType: 'float',
            filterable: true,
            renderable: false,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 1
        };
        this._textureFormatInfos['r16f'] = {
            gpuSampleType: 'float',
            filterable: true,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 2
        };
        this._textureFormatInfos['r32f'] = {
            gpuSampleType: 'unfilterable-float',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this._textureFormatInfos['r8ui'] = {
            gpuSampleType: 'uint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 1
        };
        this._textureFormatInfos['r8i'] = {
            gpuSampleType: 'sint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 1
        };
        this._textureFormatInfos['r16ui'] = {
            gpuSampleType: 'uint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 2
        };
        this._textureFormatInfos['r16i'] = {
            gpuSampleType: 'sint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 2
        };
        this._textureFormatInfos['r32ui'] = {
            gpuSampleType: 'uint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this._textureFormatInfos['r32i'] = {
            gpuSampleType: 'sint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this._textureFormatInfos['rg8unorm'] = {
            gpuSampleType: 'float',
            filterable: true,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 2
        };
        this._textureFormatInfos['rg8snorm'] = {
            gpuSampleType: 'float',
            filterable: true,
            renderable: false,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 2
        };
        this._textureFormatInfos['rg16f'] = {
            gpuSampleType: 'float',
            filterable: true,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this._textureFormatInfos['rg32f'] = {
            gpuSampleType: 'unfilterable-float',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 8
        };
        this._textureFormatInfos['rg8ui'] = {
            gpuSampleType: 'uint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 2
        };
        this._textureFormatInfos['rg8i'] = {
            gpuSampleType: 'sint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 2
        };
        this._textureFormatInfos['rg16ui'] = {
            gpuSampleType: 'uint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this._textureFormatInfos['rg16i'] = {
            gpuSampleType: 'sint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this._textureFormatInfos['rg32ui'] = {
            gpuSampleType: 'uint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 8
        };
        this._textureFormatInfos['rg32i'] = {
            gpuSampleType: 'sint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 8
        };
        this._textureFormatInfos['rgba8unorm-srgb'] = {
            gpuSampleType: 'float',
            filterable: true,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this._textureFormatInfos['bgra8unorm-srgb'] = {
            gpuSampleType: 'float',
            filterable: true,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this._textureFormatInfos['rgba16f'] = {
            gpuSampleType: 'float',
            filterable: true,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 8
        };
        this._textureFormatInfos['rgba32f'] = {
            gpuSampleType: 'unfilterable-float',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 16
        };
        this._textureFormatInfos['rgba8ui'] = {
            gpuSampleType: 'uint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this._textureFormatInfos['rgba8i'] = {
            gpuSampleType: 'sint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this._textureFormatInfos['rgba16ui'] = {
            gpuSampleType: 'uint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 8
        };
        this._textureFormatInfos['rgba16i'] = {
            gpuSampleType: 'sint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 8
        };
        this._textureFormatInfos['rgba32ui'] = {
            gpuSampleType: 'uint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 16
        };
        this._textureFormatInfos['rgba32i'] = {
            gpuSampleType: 'sint',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: true,
            blockWidth: 1,
            blockHeight: 1,
            size: 16
        };
        this._textureFormatInfos['rg11b10uf'] = {
            gpuSampleType: 'float',
            filterable: true,
            renderable: device.device.features.has('rg11b10ufloat-renderable'),
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this._textureFormatInfos['d16'] = {
            gpuSampleType: 'depth',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 2
        };
        this._textureFormatInfos['d24'] = {
            gpuSampleType: 'depth',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this._textureFormatInfos['d32f'] = {
            gpuSampleType: 'depth',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this._textureFormatInfos['d32fs8'] = {
            gpuSampleType: 'depth',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 8
        };
        this._textureFormatInfos['d24s8'] = {
            gpuSampleType: 'depth',
            filterable: false,
            renderable: true,
            compressed: false,
            writable: false,
            blockWidth: 1,
            blockHeight: 1,
            size: 4
        };
        this.supportLinearFloatTexture = this._textureFormatInfos['r32f'].filterable && this._textureFormatInfos['rg32f'].filterable && this._textureFormatInfos['rgba32f'].filterable;
        this.supportLinearHalfFloatTexture = this._textureFormatInfos['r16f'].filterable && this._textureFormatInfos['rg16f'].filterable && this._textureFormatInfos['rgba16f'].filterable;
    }
    calcMemoryUsage(format, numPixels) {
        return this._textureFormatInfos[format] ? this._textureFormatInfos[format].size * numPixels : 0;
    }
    getTextureFormatInfo(format) {
        return this._textureFormatInfos[format];
    }
}

class WebGPUVertexLayout extends WebGPUObject {
    static _hashCounter = 0;
    static _defaultBuffers = [];
    _vertexData;
    _hash;
    _layouts;
    constructor(device, options){
        super(device);
        this._vertexData = new VertexData();
        for (const vb of options.vertexBuffers){
            this._vertexData.setVertexBuffer(vb.buffer, vb.stepMode);
        }
        if (options.indexBuffer) {
            this._vertexData.setIndexBuffer(options.indexBuffer);
        }
        this._hash = String(++WebGPUVertexLayout._hashCounter);
        this._layouts = {};
    }
    destroy() {
        this._object = null;
    }
    restore() {
        this._object = {};
    }
    setDrawOffset(buffer, byteOffset) {
        for (const info of this._vertexData.vertexBuffers){
            if (info?.buffer === buffer) {
                info.drawOffset = byteOffset;
            }
        }
    }
    get hash() {
        return this._hash;
    }
    get vertexBuffers() {
        return this._vertexData.vertexBuffers;
    }
    get indexBuffer() {
        return this._vertexData.indexBuffer;
    }
    getDrawOffset() {
        return this._vertexData.getDrawOffset();
    }
    getVertexBuffer(semantic) {
        return this._vertexData.getVertexBuffer(semantic);
    }
    getVertexBufferInfo(semantic) {
        return this._vertexData.getVertexBufferInfo(semantic);
    }
    getIndexBuffer() {
        return this._vertexData.getIndexBuffer();
    }
    getLayouts(attributes) {
        if (!attributes) {
            return null;
        }
        let layout = this._layouts[attributes];
        if (!layout) {
            layout = this.calcHash(attributes);
            this._layouts[attributes] = layout;
        }
        return layout;
    }
    getDefaultBuffer(attrib, numVertices) {
        let buffer = WebGPUVertexLayout._defaultBuffers[0];
        if (buffer) {
            const n = Math.floor(buffer.byteLength / 4 * 4);
            if (n < numVertices) {
                buffer = null;
            }
        }
        if (!buffer) {
            buffer = this._device.createVertexBuffer(getVertexAttribFormat(getVertexAttribName(attrib), 'f32', 4), new Float32Array(numVertices * 4));
            WebGPUVertexLayout._defaultBuffers.unshift(buffer);
        }
        return buffer;
    }
    calcHash(attribHash) {
        const layouts = [];
        const layoutVertexBuffers = [];
        const vertexBuffers = this._vertexData.vertexBuffers;
        const attributes = attribHash.split(':').map((val)=>Number(val));
        for(let idx = 0; idx < attributes.length; idx++){
            const attrib = attributes[idx];
            let bufferInfo = vertexBuffers[attrib];
            let buffer = bufferInfo?.buffer ?? null;
            if (!buffer) {
                console.warn(`No vertex buffer set for location <${getVertexAttribName(attrib)}>`);
                buffer = this.getDefaultBuffer(attrib, this._vertexData.numVertices);
                bufferInfo = {
                    buffer,
                    offset: 0,
                    drawOffset: 0,
                    type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
                    stride: 4 * 4,
                    stepMode: 'vertex'
                };
            }
            const gpuFormat = WebGPUStructuredBuffer.getGPUVertexFormat(bufferInfo.type);
            if (!gpuFormat) {
                throw new Error('Invalid vertex buffer format');
            }
            const index = layoutVertexBuffers.findIndex((val)=>val.buffer === buffer);
            const stride = bufferInfo.stride;
            let layout = index >= 0 ? layouts[index] : `${stride}-${Number(bufferInfo.stepMode === 'instance')}`;
            layout += `-${vertexFormatToHash[gpuFormat]}-${bufferInfo.offset}-${idx}`;
            if (index >= 0) {
                layouts[index] = layout;
            } else {
                layouts.push(layout);
                layoutVertexBuffers.push(bufferInfo);
            }
        }
        return {
            layoutHash: layouts.join(':'),
            buffers: layoutVertexBuffers
        };
    }
    bind() {
        this._device.setVertexLayout(this);
    }
    draw(primitiveType, first, count) {
        this.bind();
        this._device.draw(primitiveType, first, count);
    }
    drawInstanced(primitiveType, first, count, numInstances) {
        this.bind();
        this._device.drawInstanced(primitiveType, first, count, numInstances);
    }
}

class WebGPURenderState {
    static _defaultState;
    _hash;
    static get defaultState() {
        return this._defaultState;
    }
    constructor(){
        this._hash = null;
    }
    get hash() {
        return this._getHash(this.constructor);
    }
    invalidateHash() {
        this._hash = null;
    }
    _getHash(ctor) {
        if (this === ctor.defaultState) {
            return '';
        } else {
            if (this._hash === null) {
                this._hash = this.computeHash();
            }
            return this._hash;
        }
    }
}
class WebGPUColorState extends WebGPURenderState {
    static _defaultState = new WebGPUColorState();
    _redMask;
    _greenMask;
    _blueMask;
    _alphaMask;
    constructor(){
        super();
        this._redMask = this._greenMask = this._blueMask = this._alphaMask = true;
    }
    clone() {
        return new WebGPUColorState().setColorMask(this._redMask, this._greenMask, this._blueMask, this._alphaMask);
    }
    get redMask() {
        return this._redMask;
    }
    set redMask(val) {
        if (this._redMask !== !!val) {
            this._redMask = !!val;
            this.invalidateHash();
        }
    }
    get greenMask() {
        return this._greenMask;
    }
    set greenMask(val) {
        if (this._greenMask !== !!val) {
            this._greenMask = !!val;
            this.invalidateHash();
        }
    }
    get blueMask() {
        return this._blueMask;
    }
    set blueMask(val) {
        if (this._blueMask !== !!val) {
            this._blueMask = !!val;
            this.invalidateHash();
        }
    }
    get alphaMask() {
        return this._alphaMask;
    }
    set alphaMask(val) {
        if (this._alphaMask !== !!val) {
            this._alphaMask = !!val;
            this.invalidateHash();
        }
    }
    setColorMask(r, g, b, a) {
        this.redMask = r;
        this.greenMask = g;
        this.blueMask = b;
        this.alphaMask = a;
        return this;
    }
    computeHash() {
        let val = 0;
        if (this.redMask) {
            val += 1 << 0;
        }
        if (this.greenMask) {
            val += 1 << 1;
        }
        if (this.blueMask) {
            val += 1 << 2;
        }
        if (this.alphaMask) {
            val += 1 << 3;
        }
        return String(val);
    }
}
class WebGPUBlendingState extends WebGPURenderState {
    static _defaultState = new WebGPUBlendingState();
    _enabled;
    _alphaToCoverageEnabled;
    _srcBlendRGB;
    _dstBlendRGB;
    _srcBlendAlpha;
    _dstBlendAlpha;
    _rgbEquation;
    _alphaEquation;
    constructor(){
        super();
        this._enabled = false;
        this._alphaToCoverageEnabled = false;
        this._srcBlendRGB = 'one';
        this._dstBlendRGB = 'zero';
        this._srcBlendAlpha = 'one';
        this._dstBlendAlpha = 'zero';
        this._rgbEquation = 'add';
        this._alphaEquation = 'add';
    }
    clone() {
        const other = new WebGPUBlendingState();
        other.enable(this._enabled);
        other.enableAlphaToCoverage(this._alphaToCoverageEnabled);
        other.setBlendFuncRGB(this._srcBlendRGB, this._dstBlendRGB);
        other.setBlendFuncAlpha(this._srcBlendAlpha, this._dstBlendAlpha);
        other.setBlendEquation(this._rgbEquation, this._alphaEquation);
        return other;
    }
    get enabled() {
        return this._enabled;
    }
    set enabled(val) {
        if (this._enabled !== !!val) {
            this._enabled = !!val;
            this.invalidateHash();
        }
    }
    get alphaToCoverageEnabled() {
        return this._alphaToCoverageEnabled;
    }
    set alphaToCoverageEnabled(val) {
        if (this._alphaToCoverageEnabled !== !!val) {
            this._alphaToCoverageEnabled = !!val;
            this.invalidateHash();
        }
    }
    get srcBlendRGB() {
        return this._srcBlendRGB;
    }
    set srcBlendRGB(val) {
        if (this._srcBlendRGB !== val) {
            this._srcBlendRGB = val;
            this.invalidateHash();
        }
    }
    get srcBlendAlpha() {
        return this._srcBlendAlpha;
    }
    set srcBlendAlpha(val) {
        if (this._srcBlendAlpha !== val) {
            this._srcBlendAlpha = val;
            this.invalidateHash();
        }
    }
    get dstBlendRGB() {
        return this._dstBlendRGB;
    }
    set dstBlendRGB(val) {
        if (this._dstBlendRGB !== val) {
            this._dstBlendRGB = val;
            this.invalidateHash();
        }
    }
    get dstBlendAlpha() {
        return this._dstBlendAlpha;
    }
    set dstBlendAlpha(val) {
        if (this._dstBlendAlpha !== val) {
            this._dstBlendAlpha = val;
            this.invalidateHash();
        }
    }
    get rgbEquation() {
        return this._rgbEquation;
    }
    set rgbEquation(val) {
        if (this._rgbEquation !== val) {
            this._rgbEquation = val;
            this.invalidateHash();
        }
    }
    get alphaEquation() {
        return this._alphaEquation;
    }
    set alphaEquation(val) {
        if (this._alphaEquation !== val) {
            this._alphaEquation = val;
            this.invalidateHash();
        }
    }
    enable(b) {
        this.enabled = b;
        return this;
    }
    enableAlphaToCoverage(b) {
        this.alphaToCoverageEnabled = b;
        return this;
    }
    setBlendFunc(src, dest) {
        this.srcBlendRGB = src;
        this.dstBlendRGB = dest;
        this.srcBlendAlpha = src;
        this.dstBlendAlpha = dest;
        return this;
    }
    setBlendFuncRGB(src, dest) {
        this.srcBlendRGB = src;
        this.dstBlendRGB = dest;
        return this;
    }
    setBlendFuncAlpha(src, dest) {
        this.srcBlendAlpha = src;
        this.dstBlendAlpha = dest;
        return this;
    }
    setBlendEquation(rgb, alpha) {
        this.rgbEquation = rgb;
        this.alphaEquation = alpha;
        return this;
    }
    computeHash() {
        return this._enabled ? `${this._srcBlendRGB}-${this._srcBlendAlpha}-${this._dstBlendRGB}-${this._dstBlendAlpha}-${this._rgbEquation}-${this._alphaEquation}-${Number(!!this._alphaToCoverageEnabled)}` : `${Number(!!this._alphaToCoverageEnabled)}`;
    }
}
class WebGPURasterizerState extends WebGPURenderState {
    static _defaultState = new WebGPURasterizerState();
    _cullMode;
    _depthClampEnabled;
    constructor(){
        super();
        this._cullMode = 'back';
        this._depthClampEnabled = false;
    }
    clone() {
        return new WebGPURasterizerState().setCullMode(this._cullMode).enableDepthClamp(this._depthClampEnabled);
    }
    get cullMode() {
        return this._cullMode;
    }
    set cullMode(val) {
        if (this._cullMode !== val) {
            this._cullMode = val;
            this.invalidateHash();
        }
    }
    setCullMode(mode) {
        this.cullMode = mode;
        return this;
    }
    get depthClampEnabled() {
        return this._depthClampEnabled;
    }
    set depthClampEnabled(val) {
        this.enableDepthClamp(val);
    }
    enableDepthClamp(enable) {
        if (this._depthClampEnabled !== !!enable) {
            this._depthClampEnabled = !!enable;
            this.invalidateHash();
        }
        return this;
    }
    computeHash() {
        return `${this._cullMode}-${this._depthClampEnabled ? 1 : 0}`;
    }
}
class WebGPUDepthState extends WebGPURenderState {
    static _defaultState = new WebGPUDepthState();
    _testEnabled;
    _writeEnabled;
    _compareFunc;
    _depthBias;
    _depthBiasSlopeScale;
    constructor(){
        super();
        this._testEnabled = true;
        this._writeEnabled = true;
        this._compareFunc = 'le';
        this._depthBias = 0;
        this._depthBiasSlopeScale = 0;
    }
    clone() {
        const other = new WebGPUDepthState();
        other.enableTest(this._testEnabled);
        other.enableWrite(this._writeEnabled);
        other.setCompareFunc(this._compareFunc);
        other.setDepthBias(this._depthBias);
        other.setDepthBiasSlopeScale(this._depthBiasSlopeScale);
        return other;
    }
    get testEnabled() {
        return this._testEnabled;
    }
    set testEnabled(val) {
        if (this._testEnabled !== !!val) {
            this._testEnabled = val;
            this.invalidateHash();
        }
    }
    get writeEnabled() {
        return this._writeEnabled;
    }
    set writeEnabled(val) {
        if (this._writeEnabled !== !!val) {
            this._writeEnabled = val;
            this.invalidateHash();
        }
    }
    get compareFunc() {
        return this._compareFunc;
    }
    set compareFunc(val) {
        if (this._compareFunc !== val) {
            this._compareFunc = val;
            this.invalidateHash();
        }
    }
    get depthBias() {
        return this._depthBias;
    }
    set depthBias(value) {
        this.setDepthBias(value);
    }
    setDepthBias(value) {
        if (this._depthBias !== value) {
            this._depthBias = value;
            this.invalidateHash();
        }
        return this;
    }
    get depthBiasSlopeScale() {
        return this._depthBiasSlopeScale;
    }
    set depthBiasSlopeScale(value) {
        this.setDepthBiasSlopeScale(value);
    }
    setDepthBiasSlopeScale(value) {
        if (this._depthBiasSlopeScale !== value) {
            this._depthBiasSlopeScale = value;
            this.invalidateHash();
        }
        return this;
    }
    enableTest(b) {
        this.testEnabled = b;
        return this;
    }
    enableWrite(b) {
        this.writeEnabled = b;
        return this;
    }
    setCompareFunc(func) {
        this.compareFunc = func;
        return this;
    }
    computeHash() {
        return `${Number(this._testEnabled)}-${Number(this._writeEnabled)}-${this._compareFunc}-${this._depthBias}-${this._depthBiasSlopeScale}`;
    }
}
class WebGPUStencilState extends WebGPURenderState {
    static _defaultState = new WebGPUStencilState();
    _enabled;
    _writeMask;
    _failOp;
    _failOpBack;
    _zFailOp;
    _zFailOpBack;
    _passOp;
    _passOpBack;
    _func;
    _funcBack;
    _ref;
    _readMask;
    constructor(){
        super();
        this._enabled = false;
        this._failOp = this.failOpBack = 'keep';
        this._zFailOp = this.zFailOpBack = 'keep';
        this._passOp = this.passOpBack = 'keep';
        this._func = this.funcBack = 'always';
        this._ref = 0;
        this._writeMask = 0xffffffff;
        this._readMask = 0xffffffff;
    }
    clone() {
        const other = new WebGPUStencilState();
        other.enable(this._enabled);
        other.setWriteMask(this._writeMask);
        other.setFrontOp(this._failOp, this._zFailOp, this._passOp);
        other.setBackOp(this._failOpBack, this._zFailOpBack, this._passOpBack);
        other.setFrontCompareFunc(this._func);
        other.setBackCompareFunc(this._funcBack);
        other.setReference(this._ref);
        other.setReadMask(this._readMask);
        return other;
    }
    get enabled() {
        return this._enabled;
    }
    set enabled(val) {
        if (this._enabled !== !!val) {
            this._enabled = !!val;
            this.invalidateHash();
        }
    }
    get writeMask() {
        return this._writeMask;
    }
    set writeMask(val) {
        if (this._writeMask !== val) {
            this._writeMask = val;
            this.invalidateHash();
        }
    }
    get failOp() {
        return this._failOp;
    }
    set failOp(val) {
        if (this._failOp !== val) {
            this._failOp = val;
            this.invalidateHash();
        }
    }
    get failOpBack() {
        return this._failOpBack;
    }
    set failOpBack(val) {
        if (this._failOpBack !== val) {
            this._failOpBack = val;
            this.invalidateHash();
        }
    }
    get zFailOp() {
        return this._zFailOp;
    }
    set zFailOp(val) {
        if (this._zFailOp !== val) {
            this._zFailOp = val;
            this.invalidateHash();
        }
    }
    get zFailOpBack() {
        return this._zFailOpBack;
    }
    set zFailOpBack(val) {
        if (this._zFailOpBack !== val) {
            this._zFailOpBack = val;
            this.invalidateHash();
        }
    }
    get passOp() {
        return this._passOp;
    }
    set passOp(val) {
        if (this._passOp !== val) {
            this._passOp = val;
            this.invalidateHash();
        }
    }
    get passOpBack() {
        return this._passOpBack;
    }
    set passOpBack(val) {
        if (this._passOpBack !== val) {
            this._passOpBack = val;
            this.invalidateHash();
        }
    }
    get func() {
        return this._func;
    }
    set func(val) {
        if (this._func !== val) {
            this._func = val;
            this.invalidateHash();
        }
    }
    get funcBack() {
        return this._funcBack;
    }
    set funcBack(val) {
        if (this._funcBack !== val) {
            this._funcBack = val;
            this.invalidateHash();
        }
    }
    get ref() {
        return this._ref;
    }
    set ref(val) {
        if (this._ref !== val) {
            this._ref = val;
            this.invalidateHash();
        }
    }
    get readMask() {
        return this._readMask;
    }
    set readMask(val) {
        if (this._readMask !== val) {
            this._readMask = val;
            this.invalidateHash();
        }
    }
    enable(b) {
        this.enabled = b;
        return this;
    }
    setWriteMask(mask) {
        this.writeMask = mask;
        return this;
    }
    setFrontOp(fail, zfail, pass) {
        this.failOp = fail;
        this.zFailOp = zfail;
        this.passOp = pass;
        return this;
    }
    setBackOp(fail, zfail, pass) {
        this.failOpBack = fail;
        this.zFailOpBack = zfail;
        this.passOpBack = pass;
        return this;
    }
    setFrontCompareFunc(func) {
        this.func = func;
        return this;
    }
    setBackCompareFunc(func) {
        this.funcBack = func;
        return this;
    }
    setReference(ref) {
        this.ref = ref;
        return this;
    }
    setReadMask(mask) {
        this.readMask = mask;
        return this;
    }
    computeHash() {
        return this._enabled ? `${this.sideHash(false)}-${this.sideHash(true)}-${this.readMask.toString(16)}-${this.writeMask.toString(16)}-${this.ref.toString(16)}` : '';
    }
    sideHash(back) {
        return back ? `${this._failOpBack}-${this._zFailOpBack}-${this._passOpBack}-${this._funcBack}` : `${this._failOp}-${this._zFailOp}-${this._passOp}-${this._func}`;
    }
}
class WebGPURenderStateSet {
    _device;
    colorState;
    blendingState;
    rasterizerState;
    depthState;
    stencilState;
    constructor(device){
        this._device = device;
        this.colorState = null;
        this.blendingState = null;
        this.rasterizerState = null;
        this.depthState = null;
        this.stencilState = null;
    }
    clone() {
        const newStateSet = new WebGPURenderStateSet(this._device);
        newStateSet.colorState = this.colorState?.clone() ?? null;
        newStateSet.blendingState = this.blendingState?.clone() ?? null;
        newStateSet.rasterizerState = this.rasterizerState?.clone() ?? null;
        newStateSet.depthState = this.depthState?.clone() ?? null;
        newStateSet.stencilState = this.stencilState?.clone() ?? null;
        return newStateSet;
    }
    copyFrom(stateSet) {
        this.colorState = stateSet.colorState;
        this.blendingState = stateSet.blendingState;
        this.rasterizerState = stateSet.rasterizerState;
        this.depthState = stateSet.depthState;
        this.stencilState = stateSet.stencilState;
    }
    get hash() {
        return `${this.colorState?.hash || ''}:${this.blendingState?.hash || ''}:${this.rasterizerState?.hash || ''}:${this.depthState?.hash || ''}:${this.stencilState?.hash || ''}`;
    }
    useColorState(state) {
        return this.colorState = state ?? this.colorState ?? new WebGPUColorState();
    }
    defaultColorState() {
        this.colorState = null;
    }
    useBlendingState(state) {
        return this.blendingState = state ?? this.blendingState ?? new WebGPUBlendingState();
    }
    defaultBlendingState() {
        this.blendingState = null;
    }
    useRasterizerState(state) {
        return this.rasterizerState = state ?? this.rasterizerState ?? new WebGPURasterizerState();
    }
    defaultRasterizerState() {
        this.rasterizerState = null;
    }
    useDepthState(state) {
        return this.depthState = state ?? this.depthState ?? new WebGPUDepthState();
    }
    defaultDepthState() {
        this.depthState = null;
    }
    useStencilState(state) {
        return this.stencilState = state ?? this.stencilState ?? new WebGPUStencilState();
    }
    defaultStencilState() {
        this.stencilState = null;
    }
    apply(_force) {
        this._device.setRenderStates(this);
    }
}

const typeU16$2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);
const stencilFormats = [
    'stencil8',
    'depth24plus-stencil8',
    'depth24unorm-stencil8',
    'depth32float-stencil8'
];
const depthFormats = [
    'depth16unorm',
    'depth24plus',
    'depth24plus-stencil8',
    'depth32float',
    'depth24unorm-stencil8',
    'depth32float-stencil8'
];
class PipelineCache {
    _device;
    _renderPipelines;
    _computePipelines;
    constructor(device){
        this._device = device;
        this._renderPipelines = {};
        this._computePipelines = {};
    }
    wipeCache() {
        this._renderPipelines = {};
        this._computePipelines = {};
    }
    fetchComputePipeline(program) {
        const hash = this.getComputePipelineHash(program);
        let pipeline = this._computePipelines[hash];
        if (pipeline === undefined) {
            const shaderModule = program.getShaderModule();
            const desc = {
                layout: shaderModule.pipelineLayout,
                compute: {
                    module: shaderModule.csModule,
                    entryPoint: 'main'
                }
            };
            pipeline = this._device.gpuCreateComputePipeline(desc);
            this._computePipelines[hash] = pipeline;
        }
        return pipeline;
    }
    fetchRenderPipeline(program, vertexData, stateSet, primitiveType, frameBufferInfo) {
        if (!frameBufferInfo.hash) {
            return null;
        }
        const vertexLayout = program.vertexAttributes ? vertexData : null;
        const hash = this.getRenderPipelineHash(frameBufferInfo.hash, program, vertexLayout, stateSet, primitiveType);
        let pipeline = this._renderPipelines[hash];
        if (pipeline === undefined) {
            const bufferLayouts = vertexLayout ? this._device.fetchVertexLayout(vertexLayout.getLayouts(program.vertexAttributes).layoutHash) : null;
            const shaderModule = program.getShaderModule();
            const vertex = {
                module: shaderModule.vsModule,
                entryPoint: 'main'
            };
            if (bufferLayouts) {
                vertex.buffers = bufferLayouts;
            }
            const primitiveState = this.createPrimitiveState(vertexLayout, stateSet, primitiveType);
            const depthStencilState = this.createDepthStencilState(frameBufferInfo.depthFormat, stateSet);
            const colorTargetStates = frameBufferInfo.colorFormats.map((val)=>this.createColorTargetState(stateSet, val));
            const desc = {
                label: hash,
                layout: shaderModule.pipelineLayout,
                vertex,
                primitive: primitiveState,
                depthStencil: depthStencilState,
                multisample: this.createMultisampleState(frameBufferInfo.sampleCount, stateSet),
                fragment: {
                    module: shaderModule.fsModule,
                    entryPoint: 'main',
                    targets: colorTargetStates
                }
            };
            pipeline = this._device.gpuCreateRenderPipeline(desc);
            this._renderPipelines[hash] = pipeline;
        }
        return pipeline;
    }
    createPrimitiveState(vertexData, stateSet, primitiveType) {
        const topology = primitiveTypeMap[primitiveType];
        if (!topology) {
            throw new Error(`createPrimitiveState() failed: invalid primitive type: ${primitiveType}`);
        }
        const rasterizerState = stateSet?.rasterizerState || WebGPURasterizerState.defaultState;
        const cullMode = faceModeMap[rasterizerState.cullMode];
        if (!cullMode) {
            throw new Error(`createPrimitiveState() failed: invalid cull mode: ${rasterizerState.cullMode}`);
        }
        const frontFace = this._device.isWindingOrderReversed() ? 'cw' : 'ccw';
        const state = {
            topology,
            frontFace,
            cullMode
        };
        if (this._device.device.features.has('depth-clip-control')) {
            state.unclippedDepth = rasterizerState.depthClampEnabled;
        }
        if (topology === 'triangle-strip' || topology === 'line-strip') {
            state.stripIndexFormat = vertexData?.getIndexBuffer()?.indexType === typeU16$2 ? 'uint16' : 'uint32';
        }
        return state;
    }
    createMultisampleState(sampleCount, stateSet) {
        return {
            count: sampleCount,
            alphaToCoverageEnabled: sampleCount > 1 && (stateSet?.blendingState ?? WebGPUBlendingState.defaultState).alphaToCoverageEnabled
        };
    }
    createDepthStencilState(depthFormat, stateSet) {
        if (!depthFormat) {
            return undefined;
        }
        const depthState = stateSet?.depthState || WebGPUDepthState.defaultState;
        const stencilState = stateSet?.stencilState || WebGPUStencilState.defaultState;
        const hasStencil = stencilFormats.indexOf(depthFormat) >= 0;
        const hasDepth = depthFormats.indexOf(depthFormat) >= 0;
        const depthWriteEnabled = hasDepth ? depthState.writeEnabled : false;
        const depthCompare = hasDepth && depthState.testEnabled ? compareFuncMap[depthState.compareFunc] : 'always';
        const state = {
            format: depthFormat,
            depthWriteEnabled,
            depthCompare
        };
        if (depthState.depthBias !== 0 || depthState.depthBiasSlopeScale !== 0) {
            state.depthBias = depthState.depthBias;
            state.depthBiasSlopeScale = depthState.depthBiasSlopeScale;
        }
        if (hasStencil) {
            const stencilFront = stencilState.enabled ? this.createStencilFaceState(stencilState.func, stencilState.failOp, stencilState.zFailOp, stencilState.passOp) : undefined;
            const stencilBack = stencilState.enabled ? this.createStencilFaceState(stencilState.funcBack, stencilState.failOpBack, stencilState.zFailOpBack, stencilState.passOpBack) : undefined;
            const stencilReadMask = stencilState.enabled ? stencilState.readMask : undefined;
            const stencilWriteMask = stencilState.enabled ? stencilState.writeMask : undefined;
            state.stencilFront = stencilFront;
            state.stencilBack = stencilBack;
            state.stencilReadMask = stencilReadMask;
            state.stencilWriteMask = stencilWriteMask;
        }
        return state;
    }
    createStencilFaceState(func, failOp, zFailOp, passOp) {
        return {
            compare: compareFuncMap[func],
            failOp: stencilOpMap[failOp],
            depthFailOp: stencilOpMap[zFailOp],
            passOp: stencilOpMap[passOp]
        };
    }
    createColorTargetState(stateSet, format) {
        const blendingState = stateSet?.blendingState || WebGPUBlendingState.defaultState;
        const colorState = stateSet?.colorState || WebGPUColorState.defaultState;
        const r = colorState.redMask ? GPUColorWrite.RED : 0;
        const g = colorState.greenMask ? GPUColorWrite.GREEN : 0;
        const b = colorState.blueMask ? GPUColorWrite.BLUE : 0;
        const a = colorState.alphaMask ? GPUColorWrite.ALPHA : 0;
        const state = {
            format: format,
            writeMask: r | g | b | a
        };
        if (blendingState.enabled) {
            state.blend = this.createBlendState(blendingState);
        }
        return state;
    }
    createBlendState(blendingState) {
        return {
            color: this.createBlendComponent(blendingState.rgbEquation, blendingState.srcBlendRGB, blendingState.dstBlendRGB),
            alpha: this.createBlendComponent(blendingState.alphaEquation, blendingState.srcBlendAlpha, blendingState.dstBlendAlpha)
        };
    }
    createBlendComponent(op, srcFunc, dstFunc) {
        const operation = blendEquationMap[op];
        if (!operation) {
            throw new Error(`createBlendComponent() failed: invalid blend op: ${op}`);
        }
        const srcFactor = blendFuncMap[srcFunc];
        if (!srcFactor) {
            throw new Error(`createBlendComponent() failed: invalid source blend func ${srcFunc}`);
        }
        const dstFactor = blendFuncMap[dstFunc];
        if (!dstFactor) {
            throw new Error(`createBlendComponent() failed: invalid dest blend func ${dstFunc}`);
        }
        return {
            operation,
            srcFactor,
            dstFactor
        };
    }
    getRenderPipelineHash(fbHash, program, vertexData, stateSet, primitiveType) {
        const programHash = program.hash;
        const vertexHash = vertexData?.getLayouts(program.vertexAttributes)?.layoutHash || '';
        const stateHash = stateSet?.hash || '';
        return `${programHash}:${vertexHash}:${fbHash}:${primitiveType}:${stateHash}:${Number(this._device.isWindingOrderReversed())}`;
    }
    getComputePipelineHash(program) {
        return program.hash;
    }
}

class WebGPUFrameBuffer extends WebGPUObject {
    _options;
    _width;
    _height;
    _bindFlag;
    _hash;
    _msaaColorTextures;
    _msaaDepthTexture;
    constructor(device, colorAttachments, depthAttachment, opt){
        super(device);
        if (colorAttachments.length > 0 && colorAttachments.findIndex((val)=>!val) >= 0) {
            throw new Error('WebGPUFramebuffer(): invalid color attachments');
        }
        this._object = null;
        this._options = {
            colorAttachments: colorAttachments?.length > 0 ? colorAttachments.map((value)=>({
                    texture: value,
                    face: 0,
                    layer: 0,
                    level: 0,
                    generateMipmaps: true
                })) : null,
            depthAttachment: depthAttachment ? {
                texture: depthAttachment,
                face: 0,
                layer: 0,
                level: 0,
                generateMipmaps: false
            } : null,
            sampleCount: opt?.sampleCount ?? 1,
            ignoreDepthStencil: opt?.ignoreDepthStencil ?? false
        };
        if (!this._options.colorAttachments && !this._options.depthAttachment) {
            throw new Error('WebGPUFramebuffer(): colorAttachments or depthAttachment must be specified');
        }
        this._width = this._options.colorAttachments ? this._options.colorAttachments[0].texture.width : this._options.depthAttachment.texture.width;
        this._height = this._options.colorAttachments ? this._options.colorAttachments[0].texture.height : this._options.depthAttachment.texture.height;
        if (this._options.colorAttachments && this._options.colorAttachments.findIndex((val)=>val.texture.width !== this._width || val.texture.height !== this._height) >= 0 || this._options.depthAttachment && (this._options.depthAttachment.texture.width !== this._width || this._options.depthAttachment.texture.height !== this._height)) {
            throw new Error('WebGPUFramebuffer(): attachment textures must have same width and height');
        }
        this._bindFlag = 0;
        this._msaaColorTextures = null;
        this._msaaDepthTexture = null;
        const colorAttachmentHash = this._options.colorAttachments?.map((tex)=>tex.texture.format).join(':') ?? '';
        const depthAttachmentHash = this._options.depthAttachment?.texture.format ?? '';
        this._hash = `${colorAttachmentHash}-${depthAttachmentHash}-${this._options.sampleCount ?? 1}`;
        this._init();
    }
    getOptions() {
        return this._options;
    }
    get bindFlag() {
        return this._bindFlag;
    }
    getHash() {
        return this._hash;
    }
    getWidth() {
        const attachment = this._options.colorAttachments?.[0] ?? this._options.depthAttachment;
        return attachment ? Math.max(attachment.texture.width >> attachment.level, 1) : 0;
    }
    getHeight() {
        const attachment = this._options.colorAttachments?.[0] ?? this._options.depthAttachment;
        return attachment ? Math.max(attachment.texture.height >> attachment.level, 1) : 0;
    }
    restore() {
        if (this._options?.depthAttachment?.texture?.disposed) {
            this._options.depthAttachment.texture.reload();
        }
        if (this._options?.colorAttachments) {
            for (const k of this._options.colorAttachments){
                if (k?.texture?.disposed) {
                    k.texture.reload();
                }
            }
        }
        if (!this._device.isContextLost()) {
            this._init();
        }
    }
    destroy() {
        this._object = null;
        if (this._msaaColorTextures) {
            for (const tex of this._msaaColorTextures){
                tex.destroy();
            }
            this._msaaColorTextures = null;
        }
        if (this._msaaDepthTexture) {
            this._msaaDepthTexture.destroy();
            this._msaaDepthTexture = null;
        }
    }
    setColorAttachmentGenerateMipmaps(index, generateMipmaps) {
        const k = this._options.colorAttachments?.[index];
        if (k) {
            k.generateMipmaps = !!generateMipmaps;
        }
    }
    getColorAttachmentGenerateMipmaps(index) {
        return this._options.colorAttachments?.[index]?.generateMipmaps ?? false;
    }
    setColorAttachmentCubeFace(index, face) {
        const k = this._options.colorAttachments?.[index];
        if (k && k.face !== face) {
            k.face = face;
            this._bindFlag++;
        }
    }
    getColorAttachmentCubeFace(index) {
        return this._options.colorAttachments?.[index].face ?? CubeFace.PX;
    }
    setColorAttachmentMipLevel(index, level) {
        const k = this._options.colorAttachments?.[index];
        if (k && k.level !== level) {
            k.level = level;
            this._bindFlag++;
        }
    }
    getColorAttachmentMipLevel(index) {
        return this._options.colorAttachments?.[index].level ?? 0;
    }
    setColorAttachmentLayer(index, layer) {
        const k = this._options.colorAttachments?.[index];
        if (k && k.layer !== layer) {
            k.layer = layer;
            this._bindFlag++;
        }
    }
    getColorAttachmentLayer(index) {
        return this._options.colorAttachments?.[index].layer ?? 0;
    }
    setDepthAttachmentCubeFace(face) {
        const k = this._options.depthAttachment;
        if (k && k.face !== face) {
            k.face = face;
            this._bindFlag++;
        }
    }
    getDepthAttachmentCubeFace() {
        return this._options.depthAttachment?.face ?? CubeFace.PX;
    }
    setDepthAttachmentLayer(layer) {
        const k = this._options.depthAttachment;
        if (k && k.layer !== layer) {
            k.layer = layer;
            this._bindFlag++;
        }
    }
    getDepthAttachmentLayer() {
        return this._options.depthAttachment?.layer ?? 0;
    }
    getDepthAttachment() {
        return this._options?.depthAttachment?.texture || null;
    }
    getColorAttachments() {
        return this._options?.colorAttachments?.map((val)=>val?.texture || null) || [];
    }
    getColorAttachment(index) {
        return this.getColorAttachments()[index] ?? null;
    }
    getMSAADepthAttachment() {
        return this._msaaDepthTexture;
    }
    getMSAAColorAttacments() {
        return this._msaaColorTextures;
    }
    getColorFormats() {
        return this._options?.colorAttachments?.map((val)=>val.texture.gpuFormat) ?? null;
    }
    getDepthFormat() {
        return this._options.depthAttachment?.texture?.gpuFormat ?? null;
    }
    bind() {
        return true;
    }
    unbind() {}
    _init() {
        if (this._options.sampleCount > 1) {
            this._msaaColorTextures = [];
            for (const colorAttachment of this._options.colorAttachments){
                const msaaTexture = this.device.gpuCreateTexture({
                    size: {
                        width: this._width,
                        height: this._height,
                        depthOrArrayLayers: 1
                    },
                    format: colorAttachment.texture.gpuFormat,
                    mipLevelCount: 1,
                    sampleCount: this._options.sampleCount,
                    dimension: '2d',
                    usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT
                });
                this._msaaColorTextures.push(msaaTexture);
            }
            if (this._options.depthAttachment) {
                const msaaDepthTexture = this.device.gpuCreateTexture({
                    size: {
                        width: this._width,
                        height: this._height,
                        depthOrArrayLayers: 1
                    },
                    format: this._options.depthAttachment.texture.gpuFormat,
                    mipLevelCount: 1,
                    sampleCount: this._options.sampleCount,
                    dimension: '2d',
                    usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT
                });
                this._msaaDepthTexture = msaaDepthTexture;
            }
        }
        this._object = {};
    }
    isFramebuffer() {
        return true;
    }
    getSampleCount() {
        return this._options.sampleCount;
    }
}

const typeU16$1 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);
const typeU32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32);
class WebGPUIndexBuffer extends WebGPUBuffer {
    indexType;
    length;
    constructor(device, data, usage){
        if (!(data instanceof Uint16Array) && !(data instanceof Uint32Array)) {
            throw new Error('invalid index data');
        }
        super(device, GPUResourceUsageFlags.BF_INDEX | (usage ?? 0), data);
        this.indexType = data instanceof Uint16Array ? typeU16$1 : typeU32;
        this.length = data.length;
    }
}

class BindGroupCache {
    _device;
    _bindGroupLayoutCache;
    constructor(device){
        this._device = device;
        this._bindGroupLayoutCache = {};
    }
    fetchBindGroupLayout(desc) {
        const hash = desc ? this.getLayoutHash(desc) : '';
        let bgl = this._bindGroupLayoutCache[hash];
        if (!bgl) {
            bgl = this.createBindGroupLayout(desc);
            if (bgl) {
                this._bindGroupLayoutCache[hash] = bgl;
            } else {
                throw new Error(`fetchBindGroupLayout() failed: hash: ${hash}`);
            }
        }
        return bgl;
    }
    getLayoutHash(desc) {
        let hash = '';
        for (const entry of desc.entries){
            let s = `${entry.binding}:${entry.visibility}:`;
            if (entry.buffer) {
                s += `b:${entry.buffer.type}:${entry.buffer.hasDynamicOffset}:${entry.buffer.minBindingSize}`;
            } else if (entry.sampler) {
                s += `s${entry.sampler.type}:`;
            } else if (entry.texture) {
                s += `t${entry.texture.sampleType}-${entry.texture.viewDimension}-${Number(!!entry.texture.multisampled)}:`;
            } else if (entry.storageTexture) {
                s += `k${entry.storageTexture.access}-${entry.storageTexture.format}-${entry.storageTexture.viewDimension}:`;
            } else if (entry.externalTexture) {
                s += `v:`;
            }
            hash = `${hash} ${s}`;
        }
        return hash;
    }
    createBindGroupLayout(desc) {
        const layoutDescriptor = {
            entries: desc?.entries.map((entry)=>{
                const binding = entry.binding;
                const visibility = (entry.visibility & ShaderType.Vertex ? GPUShaderStage.VERTEX : 0) | (entry.visibility & ShaderType.Fragment ? GPUShaderStage.FRAGMENT : 0) | (entry.visibility & ShaderType.Compute ? GPUShaderStage.COMPUTE : 0);
                const buffer = entry.buffer ? {
                    type: entry.buffer.type,
                    hasDynamicOffset: entry.buffer.hasDynamicOffset,
                    // minBindingSize: entry.buffer.uniformLayout.byteSize
                    minBindingSize: Number(entry.buffer.minBindingSize) || 0
                } : undefined;
                const sampler = entry.sampler ? {
                    type: entry.sampler.type
                } : undefined;
                const texture = entry.texture ? {
                    sampleType: entry.texture.sampleType,
                    viewDimension: entry.texture.viewDimension
                } : undefined;
                const storageTexture = entry.storageTexture ? {
                    access: entry.storageTexture.access,
                    viewDimension: entry.storageTexture.viewDimension,
                    format: textureFormatMap[entry.storageTexture.format]
                } : undefined;
                const externalTexture = entry.externalTexture ? {} : undefined;
                const t = {
                    binding,
                    visibility
                };
                if (buffer) {
                    t.buffer = buffer;
                } else if (sampler) {
                    t.sampler = sampler;
                } else if (texture) {
                    t.texture = texture;
                } else if (storageTexture) {
                    t.storageTexture = storageTexture;
                } else if (externalTexture) {
                    t.externalTexture = externalTexture;
                }
                return t;
            }) || []
        };
        if (desc?.label) {
            layoutDescriptor.label = desc.label;
        }
        return [
            layoutDescriptor,
            this._device.device.createBindGroupLayout(layoutDescriptor)
        ];
    }
}

class VertexLayoutCache {
    _layouts;
    constructor(){
        this._layouts = {};
    }
    fetchVertexLayout(hash) {
        let layouts = this._layouts[hash];
        if (!layouts) {
            layouts = [];
            hash.split(':').forEach((l)=>{
                const parts = l.split('-');
                const layout = {
                    arrayStride: Number(parts[0]),
                    stepMode: Number(parts[1]) ? 'instance' : 'vertex',
                    attributes: []
                };
                for(let i = 2; i < parts.length; i += 3){
                    layout.attributes.push({
                        format: hashToVertexFormat[parts[i]],
                        offset: Number(parts[i + 1]),
                        shaderLocation: Number(parts[i + 2])
                    });
                }
                layouts.push(layout);
            });
            this._layouts[hash] = layouts;
        }
        return layouts;
    }
}

class WebGPUTextureSampler extends WebGPUObject {
    _options;
    constructor(device, options){
        super(device);
        this._options = Object.assign({
            addressU: 'clamp',
            addressV: 'clamp',
            addressW: 'clamp',
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipFilter: 'none',
            lodMin: 0,
            lodMax: 32,
            compare: null,
            maxAnisotropy: 1
        }, options || {});
        this._load();
    }
    get hash() {
        return this._object ? this._device.gpuGetObjectHash(this._object) : 0;
    }
    get addressModeU() {
        return this._options.addressU;
    }
    get addressModeV() {
        return this._options.addressV;
    }
    get addressModeW() {
        return this._options.addressW;
    }
    get magFilter() {
        return this._options.magFilter;
    }
    get minFilter() {
        return this._options.minFilter;
    }
    get mipFilter() {
        return this._options.mipFilter;
    }
    get lodMin() {
        return this._options.lodMin;
    }
    get lodMax() {
        return this._options.lodMax;
    }
    get compare() {
        return this._options.compare;
    }
    get maxAnisotropy() {
        return this._options.maxAnisotropy;
    }
    destroy() {
        this._object = null;
    }
    restore() {
        if (!this._device.isContextLost()) {
            this._load();
        }
    }
    _load() {
        this._object = this._device.gpuCreateSampler({
            addressModeU: textureWrappingMap[this._options.addressU],
            addressModeV: textureWrappingMap[this._options.addressV],
            addressModeW: textureWrappingMap[this._options.addressW],
            magFilter: textureFilterMap[this._options.magFilter],
            minFilter: textureFilterMap[this._options.minFilter],
            mipmapFilter: textureFilterMap[this._options.mipFilter],
            lodMinClamp: this._options.lodMin,
            lodMaxClamp: this._options.lodMax,
            compare: this._options.compare ? compareFuncMap[this._options.compare] : undefined,
            maxAnisotropy: this._options.maxAnisotropy
        });
        return !!this._object;
    }
    isSampler() {
        return true;
    }
}

class SamplerCache {
    _device;
    _samplers;
    constructor(device){
        this._device = device;
        this._samplers = {};
    }
    fetchSampler(options) {
        const hash = this.hash(options);
        let sampler = this._samplers[hash];
        if (!sampler) {
            sampler = this.createSampler(options);
            this._samplers[hash] = sampler;
        }
        return sampler;
    }
    hash(options) {
        const addressU = options.addressU ? String(options.addressU) : '';
        const addressV = options.addressV ? String(options.addressV) : '';
        const addressW = options.addressW ? String(options.addressW) : '';
        const magFilter = options.magFilter ? String(options.magFilter) : '';
        const minFilter = options.minFilter ? String(options.minFilter) : '';
        const mipFilter = options.mipFilter ? String(options.mipFilter) : '';
        const lodMin = options.lodMin ? String(options.lodMin) : '';
        const lodMax = options.lodMax ? String(options.lodMax) : '';
        const compare = options.compare ? String(options.compare) : '';
        const maxAnisotropy = options.maxAnisotropy ? String(options.maxAnisotropy) : '';
        return `${addressU}:${addressV}:${addressW}:${magFilter}:${minFilter}:${mipFilter}:${lodMin}:${lodMax}:${compare}:${maxAnisotropy}`;
    }
    createSampler(options) {
        return new WebGPUTextureSampler(this._device, options);
    }
}

const VALIDATION_NEED_NEW_PASS = 1 << 0;
const VALIDATION_FAILED$1 = 1 << 1;
const typeU16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);
class WebGPURenderPass {
    _device;
    _renderCommandEncoder;
    _renderPassEncoder;
    _fbBindFlag;
    _currentViewport;
    _currentScissor;
    _frameBufferInfo;
    constructor(device){
        this._device = device;
        this._renderCommandEncoder = this._device.device.createCommandEncoder();
        this._renderPassEncoder = null;
        this._fbBindFlag = null;
        this._currentViewport = null;
        this._currentScissor = null;
        this._frameBufferInfo = this.createFrameBufferInfo(null);
    }
    get active() {
        return !!this._renderPassEncoder;
    }
    createFrameBufferInfo(fb) {
        const info = !fb ? {
            frameBuffer: null,
            colorFormats: [
                this._device.backbufferFormat
            ],
            depthFormat: this._device.backbufferDepthFormat,
            sampleCount: this._device.sampleCount,
            hash: null,
            clearHash: 'f'
        } : {
            frameBuffer: fb,
            colorFormats: fb.getColorAttachments().map((val)=>val.gpuFormat),
            depthFormat: fb.getDepthAttachment()?.gpuFormat,
            sampleCount: fb.getOptions().sampleCount ?? 1,
            hash: null,
            clearHash: fb.getColorAttachments().map((val)=>{
                const fmt = textureFormatInvMap[val.gpuFormat];
                return isIntegerTextureFormat(fmt) ? isSignedTextureFormat(fmt) ? 'i' : 'u' : 'f';
            }).join('')
        };
        info.hash = `${info.colorFormats.join('-')}:${info.depthFormat}:${info.sampleCount}`;
        return info;
    }
    setFramebuffer(fb) {
        if (this._frameBufferInfo.frameBuffer !== fb) {
            this.end();
            this._frameBufferInfo = this.createFrameBufferInfo(fb);
            this.setViewport(null);
            this.setScissor(null);
        }
    }
    getFramebuffer() {
        return this._frameBufferInfo.frameBuffer;
    }
    setViewport(vp) {
        if (!vp || !Array.isArray(vp) && vp.default) {
            this._currentViewport = {
                x: 0,
                y: 0,
                width: this._device.deviceXToScreen(this._device.drawingBufferWidth),
                height: this._device.deviceYToScreen(this._device.drawingBufferHeight),
                default: true
            };
        } else {
            if (Array.isArray(vp)) {
                this._currentViewport = {
                    x: vp[0],
                    y: vp[1],
                    width: vp[2],
                    height: vp[3],
                    default: false
                };
            } else {
                this._currentViewport = Object.assign({
                    default: false
                }, vp);
            }
        }
        const vx = this._device.screenXToDevice(this._currentViewport.x);
        const vy = this._device.screenYToDevice(this._currentViewport.y);
        const vw = this._device.screenXToDevice(this._currentViewport.width);
        const vh = this._device.screenYToDevice(this._currentViewport.height);
        /*
    if (vx < 0 || vy < 0 || vw > this._device.drawingBufferWidth || vh > this._device.drawingBufferHeight) {
      console.error(
        `** VIEWPORT ERROR **: (${vx}, ${vy}, ${vw}, ${vh}) => (0, 0, ${this._device.drawingBufferWidth}, ${this._device.drawingBufferHeight})`
      );
    }
    */ if (this._renderPassEncoder) {
            this._renderPassEncoder.setViewport(vx, this._device.drawingBufferHeight - vy - vh, vw, vh, 0, 1);
        }
    }
    getViewport() {
        return Object.assign({}, this._currentViewport);
    }
    setScissor(scissor) {
        const backBufferWidth = this._device.deviceXToScreen(this._device.drawingBufferWidth);
        const backBufferHeight = this._device.deviceYToScreen(this._device.drawingBufferHeight);
        if (scissor === null || scissor === undefined || !Array.isArray(scissor) && scissor.default) {
            this._currentScissor = {
                x: 0,
                y: 0,
                width: backBufferWidth,
                height: backBufferHeight,
                default: true
            };
        } else {
            if (Array.isArray(scissor)) {
                this._currentScissor = {
                    x: scissor[0],
                    y: scissor[1],
                    width: scissor[2],
                    height: scissor[3],
                    default: false
                };
            } else {
                this._currentScissor = Object.assign({
                    default: false
                }, scissor);
            }
        }
        let vx = this._device.screenXToDevice(this._currentScissor.x);
        let vy = this._device.screenYToDevice(this._currentScissor.y);
        let vw = this._device.screenXToDevice(this._currentScissor.width);
        let vh = this._device.screenYToDevice(this._currentScissor.height);
        // Clip scissor region to screen
        if (vx < 0) {
            vw += vx;
            vx = 0;
        }
        if (vy < 0) {
            vh += vy;
            vy = 0;
        }
        vw = Math.min(this._device.screenXToDevice(backBufferWidth) - vx, vw);
        vh = Math.min(this._device.screenYToDevice(backBufferHeight) - vy, vh);
        if (vw < 0 || vh < 0) {
            vx = 0;
            vy = 0;
            vw = 0;
            vh = 0;
        }
        if (this._renderPassEncoder) {
            this._renderPassEncoder.setScissorRect(vx, this._device.drawingBufferHeight - vy - vh, vw, vh);
        }
    }
    getScissor() {
        return Object.assign({}, this._currentScissor);
    }
    executeRenderBundle(renderBundle) {
        if (!this.active) {
            this.begin();
        }
        this._renderPassEncoder.executeBundles([
            renderBundle
        ]);
    }
    draw(program, vertexData, stateSet, bindGroups, bindGroupOffsets, primitiveType, first, count, numInstances) {
        const validation = this.validateDraw(program, bindGroups);
        if (validation & VALIDATION_FAILED$1) {
            return;
        }
        if (validation & VALIDATION_NEED_NEW_PASS) {
            this.end();
        }
        if (!this.active) {
            this.begin();
        }
        this.drawInternal(this._renderPassEncoder, program, vertexData, stateSet, bindGroups, bindGroupOffsets, primitiveType, first, count, numInstances);
    }
    clear(color, depth, stencil) {
        if (!this._currentScissor) {
            this.end();
            this.begin(color, depth, stencil);
        } else {
            if (!this._renderPassEncoder) {
                this.begin();
            }
            this._renderPassEncoder.insertDebugMarker('clear');
            WebGPUClearQuad.drawClearQuad(this, color, depth, stencil);
            this._renderPassEncoder.insertDebugMarker('end clear');
        }
    }
    getDevice() {
        return this._device;
    }
    getFrameBufferInfo() {
        return this._frameBufferInfo;
    }
    begin(color, depth, stencil) {
        if (this.active) {
            console.error('WebGPURenderPass.begin() failed: begin() has already been called');
            return;
        }
        this._renderCommandEncoder = this._device.device.createCommandEncoder();
        const frameBuffer = this._frameBufferInfo.frameBuffer;
        if (!frameBuffer) {
            const mainPassDesc = this._device.defaultRenderPassDesc;
            const colorAttachmentDesc = this._device.defaultRenderPassDesc.colorAttachments[0];
            if (this._frameBufferInfo.sampleCount > 1) {
                colorAttachmentDesc.resolveTarget = this._device.context.getCurrentTexture().createView();
            } else {
                colorAttachmentDesc.view = this._device.context.getCurrentTexture().createView();
            }
            colorAttachmentDesc.loadOp = color ? 'clear' : 'load';
            colorAttachmentDesc.clearValue = color ?? undefined;
            const depthAttachmentDesc = this._device.defaultRenderPassDesc.depthStencilAttachment;
            depthAttachmentDesc.depthLoadOp = typeof depth === 'number' ? 'clear' : 'load';
            depthAttachmentDesc.depthClearValue = depth ?? undefined;
            depthAttachmentDesc.stencilLoadOp = typeof stencil === 'number' ? 'clear' : 'load';
            depthAttachmentDesc.stencilClearValue = stencil ?? undefined;
            this._renderPassEncoder = this._renderCommandEncoder.beginRenderPass(mainPassDesc);
        } else {
            const depthAttachmentTexture = frameBuffer.getDepthAttachment();
            let depthTextureView;
            if (depthAttachmentTexture) {
                depthAttachmentTexture._markAsCurrentFB(true);
                const attachment = frameBuffer.getOptions().depthAttachment;
                const layer = depthAttachmentTexture.isTexture2DArray() || depthAttachmentTexture.isTexture3D() ? attachment.layer : depthAttachmentTexture.isTextureCube() ? attachment.face : 0;
                depthTextureView = depthAttachmentTexture.getView(0, layer ?? 0, 1);
            }
            this._fbBindFlag = frameBuffer.bindFlag;
            const passDesc = {
                label: `customRenderPass:${this._frameBufferInfo.hash}`,
                colorAttachments: frameBuffer.getOptions().colorAttachments?.map((attachment, index)=>{
                    const tex = attachment.texture;
                    if (tex) {
                        tex._markAsCurrentFB(true);
                        const layer = tex.isTexture2DArray() || tex.isTexture3D() ? attachment.layer : tex.isTextureCube() ? attachment.face : 0;
                        if (frameBuffer.getOptions().sampleCount === 1) {
                            return {
                                view: tex.getView(attachment.level ?? 0, layer ?? 0, 1),
                                loadOp: color ? 'clear' : 'load',
                                clearValue: color,
                                storeOp: 'store'
                            };
                        } else {
                            const msaaTexture = frameBuffer.getMSAAColorAttacments()[index];
                            const msaaView = this._device.gpuCreateTextureView(msaaTexture, {
                                dimension: '2d',
                                baseMipLevel: attachment.level ?? 0,
                                mipLevelCount: 1,
                                baseArrayLayer: 0,
                                arrayLayerCount: 1
                            });
                            return {
                                view: msaaView,
                                resolveTarget: tex.getView(attachment.level ?? 0, layer ?? 0, 1),
                                loadOp: color ? 'clear' : 'load',
                                clearValue: color,
                                storeOp: 'store'
                            };
                        }
                    } else {
                        return null;
                    }
                }) ?? [],
                depthStencilAttachment: depthAttachmentTexture ? frameBuffer.getOptions().sampleCount === 1 ? {
                    view: depthTextureView,
                    depthLoadOp: typeof depth === 'number' ? 'clear' : 'load',
                    depthClearValue: depth ?? undefined,
                    depthStoreOp: 'store',
                    stencilLoadOp: hasStencilChannel(depthAttachmentTexture.format) ? typeof stencil === 'number' ? 'clear' : 'load' : undefined,
                    stencilClearValue: stencil ?? undefined,
                    stencilStoreOp: hasStencilChannel(depthAttachmentTexture.format) ? 'store' : undefined
                } : {
                    view: frameBuffer.getMSAADepthAttachment().createView(),
                    depthLoadOp: typeof depth === 'number' ? 'clear' : 'load',
                    depthClearValue: depth ?? undefined,
                    depthStoreOp: 'store',
                    stencilLoadOp: hasStencilChannel(depthAttachmentTexture.format) ? typeof stencil === 'number' ? 'clear' : 'load' : undefined,
                    stencilClearValue: stencil ?? undefined,
                    stencilStoreOp: hasStencilChannel(depthAttachmentTexture.format) ? 'store' : undefined
                } : undefined
            };
            this._renderPassEncoder = this._renderCommandEncoder.beginRenderPass(passDesc);
        }
        this.setViewport(this._currentViewport);
        this.setScissor(this._currentScissor);
    }
    end() {
        if (!this.active) {
            return;
        }
        // finish current render pass command
        if (this._renderPassEncoder) {
            this._renderPassEncoder.end();
            this._renderPassEncoder = null;
        }
        // render commands
        if (this._renderCommandEncoder) {
            this._device.device.queue.submit([
                this._renderCommandEncoder.finish()
            ]);
            this._renderCommandEncoder = null;
        }
        // unmark render target flags and generate render target mipmaps if needed
        if (this._frameBufferInfo.frameBuffer) {
            const options = this._frameBufferInfo.frameBuffer.getOptions();
            if (options.colorAttachments) {
                for (const attachment of options.colorAttachments){
                    attachment.texture._markAsCurrentFB(false);
                    if (attachment.generateMipmaps && attachment.texture.mipLevelCount > 1) {
                        attachment.texture.generateMipmaps();
                    }
                }
            }
            options.depthAttachment?.texture?._markAsCurrentFB(false);
        }
    }
    capture(renderBundleEncoder, program, vertexData, stateSet, bindGroups, bindGroupOffsets, primitiveType, first, count, numInstances) {
        this.drawInternal(this._renderPassEncoder, program, vertexData, stateSet, bindGroups, bindGroupOffsets, primitiveType, first, count, numInstances, renderBundleEncoder);
    }
    drawInternal(renderPassEncoder, program, vertexData, stateSet, bindGroups, bindGroupOffsets, primitiveType, first, count, numInstances, renderBundleEncoder) {
        if (this.setBindGroupsForRender(renderPassEncoder, program, bindGroups, bindGroupOffsets, renderBundleEncoder)) {
            const pipeline = this._device.pipelineCache.fetchRenderPipeline(program, vertexData, stateSet, primitiveType, this._frameBufferInfo);
            if (pipeline) {
                renderPassEncoder.setPipeline(pipeline);
                renderBundleEncoder?.setPipeline(pipeline);
                const stencilState = stateSet?.stencilState;
                if (stencilState) {
                    renderPassEncoder.setStencilReference(stencilState.ref);
                }
                if (vertexData) {
                    const vertexBuffers = vertexData.getLayouts(program.vertexAttributes)?.buffers;
                    vertexBuffers?.forEach((val, index)=>{
                        renderPassEncoder.setVertexBuffer(index, val.buffer.object, val.drawOffset);
                        renderBundleEncoder?.setVertexBuffer(index, val.buffer.object, val.drawOffset);
                    });
                    const indexBuffer = vertexData.getIndexBuffer();
                    if (indexBuffer) {
                        renderPassEncoder.setIndexBuffer(indexBuffer.object, indexBuffer.indexType === typeU16 ? 'uint16' : 'uint32');
                        renderBundleEncoder?.setIndexBuffer(indexBuffer.object, indexBuffer.indexType === typeU16 ? 'uint16' : 'uint32');
                        renderPassEncoder.drawIndexed(count, numInstances, first);
                        renderBundleEncoder?.drawIndexed(count, numInstances, first);
                    } else {
                        renderPassEncoder.draw(count, numInstances, first);
                        renderBundleEncoder?.draw(count, numInstances, first);
                    }
                } else {
                    renderPassEncoder.draw(count, numInstances, first);
                    renderBundleEncoder?.draw(count, numInstances, first);
                }
            }
        }
    }
    validateDraw(program, bindGroups) {
        let validation = 0;
        if (bindGroups) {
            for(let i = 0; i < program.bindGroupLayouts.length; i++){
                const bindGroup = bindGroups[i];
                if (bindGroup) {
                    if (bindGroup.bindGroup) {
                        for (const ubo of bindGroup.bufferList){
                            if (ubo.disposed) {
                                validation |= VALIDATION_FAILED$1;
                            }
                        }
                        for (const tex of bindGroup.textureList){
                            if (tex.disposed) {
                                validation |= VALIDATION_FAILED$1;
                            }
                            if (tex._isMarkedAsCurrentFB()) {
                                console.error('bind resource texture can not be current render target');
                                validation |= VALIDATION_FAILED$1;
                            }
                        }
                    }
                } else {
                    console.error(`Missing bind group (${i}) when drawing with program '${program.name}'`);
                    return VALIDATION_FAILED$1;
                }
            }
        }
        if (this._frameBufferInfo.frameBuffer && this._frameBufferInfo.frameBuffer.bindFlag !== this._fbBindFlag) {
            validation |= VALIDATION_NEED_NEW_PASS;
        }
        return validation;
    }
    setBindGroupsForRender(renderPassEncoder, program, bindGroups, bindGroupOffsets, renderBundleEncoder) {
        if (bindGroups) {
            for(let i = 0; i < 4; i++){
                if (i < program.bindGroupLayouts.length) {
                    const bindGroup = bindGroups[i].bindGroup;
                    if (!bindGroup) {
                        return false;
                    }
                    const bindGroupOffset = bindGroups[i].getDynamicOffsets() ?? bindGroupOffsets?.[i];
                    if (bindGroupOffset) {
                        renderPassEncoder.setBindGroup(i, bindGroup, bindGroupOffset);
                        renderBundleEncoder?.setBindGroup(i, bindGroup, bindGroupOffset);
                    } else {
                        renderPassEncoder.setBindGroup(i, bindGroup);
                        renderBundleEncoder?.setBindGroup(i, bindGroup);
                    }
                } else {
                    renderPassEncoder.setBindGroup(i, this._device.emptyBindGroup);
                    renderBundleEncoder?.setBindGroup(i, this._device.emptyBindGroup);
                }
            }
        }
        return true;
    }
}

const VALIDATION_FAILED = 1 << 0;
class WebGPUComputePass {
    _device;
    _computeCommandEncoder;
    _computePassEncoder;
    constructor(device){
        this._device = device;
        this._computeCommandEncoder = this._device.device.createCommandEncoder();
        this._computePassEncoder = null;
    }
    get active() {
        return !!this._computePassEncoder;
    }
    compute(program, bindGroups, bindGroupOffsets, workgroupCountX, workgroupCountY, workgroupCountZ) {
        const validation = this.validateCompute(program, bindGroups);
        if (validation & VALIDATION_FAILED) {
            return;
        }
        if (!this.active) {
            this.begin();
        }
        this.setBindGroupsForCompute(this._computePassEncoder, program, bindGroups, bindGroupOffsets);
        const pipeline = this._device.pipelineCache.fetchComputePipeline(program);
        if (pipeline) {
            this._computePassEncoder.setPipeline(pipeline);
            this._computePassEncoder.dispatchWorkgroups(workgroupCountX, workgroupCountY, workgroupCountZ);
        }
    }
    setBindGroupsForCompute(computePassEncoder, program, bindGroups, bindGroupOffsets) {
        if (bindGroups) {
            for(let i = 0; i < 4; i++){
                if (i < program.bindGroupLayouts.length) {
                    const bindGroup = bindGroups[i].bindGroup;
                    if (!bindGroup) {
                        return false;
                    }
                    const bindGroupOffset = bindGroupOffsets?.[i];
                    if (bindGroupOffset) {
                        computePassEncoder.setBindGroup(i, bindGroup, bindGroupOffset);
                    } else {
                        computePassEncoder.setBindGroup(i, bindGroup);
                    }
                } else {
                    computePassEncoder.setBindGroup(i, this._device.emptyBindGroup);
                }
            }
        }
        return true;
    }
    begin() {
        if (this.active) {
            console.error('WebGPUComputePass.begin() failed: WebGPUComputePass.begin() has already been called');
            return;
        }
        this._computeCommandEncoder = this._device.device.createCommandEncoder();
        this._computePassEncoder = this._computeCommandEncoder.beginComputePass();
    }
    end() {
        if (this.active) {
            this._computePassEncoder.end();
            this._computePassEncoder = null;
            this._device.device.queue.submit([
                this._computeCommandEncoder.finish()
            ]);
            this._computeCommandEncoder = null;
        }
    }
    validateCompute(program, bindGroups) {
        let validation = 0;
        if (bindGroups) {
            for(let i = 0; i < program.bindGroupLayouts.length; i++){
                const bindGroup = bindGroups[i];
                if (bindGroup) {
                    if (bindGroup.bindGroup) {
                        for (const ubo of bindGroup.bufferList){
                            if (ubo.disposed) {
                                validation |= VALIDATION_FAILED;
                            }
                        }
                        for (const tex of bindGroup.textureList){
                            if (tex.disposed) {
                                validation |= VALIDATION_FAILED;
                            }
                        }
                    }
                } else {
                    console.error(`Missing bind group (${i}) when compute with program '${program.name}'`);
                    return VALIDATION_FAILED;
                }
            }
        }
        return validation;
    }
}

class CommandQueueImmediate {
    _renderPass;
    _computePass;
    _bufferUploads;
    _textureUploads;
    _device;
    _drawcallCounter;
    constructor(device){
        this._device = device;
        this._bufferUploads = new Map();
        this._textureUploads = new Map();
        this._renderPass = new WebGPURenderPass(device);
        this._computePass = new WebGPUComputePass(device);
        this._drawcallCounter = 0;
    }
    isBufferUploading(buffer) {
        return !!this._bufferUploads.has(buffer);
    }
    isTextureUploading(tex) {
        return !!this._textureUploads.has(tex);
    }
    flushUploads() {
        if (this._bufferUploads.size > 0 || this._textureUploads.size > 0) {
            this._drawcallCounter = 0;
            const bufferUploads = this._bufferUploads;
            this._bufferUploads = new Map();
            const textureUploads = this._textureUploads;
            this._textureUploads = new Map();
            const uploadCommandEncoder = this._device.device.createCommandEncoder();
            bufferUploads.forEach((_, buffer)=>buffer.beginSyncChanges(uploadCommandEncoder));
            textureUploads.forEach((_, tex)=>{
                tex.beginSyncChanges(uploadCommandEncoder);
                if (!tex.disposed && tex.isMipmapDirty()) {
                    WebGPUMipmapGenerator.generateMipmap(this._device, tex, uploadCommandEncoder);
                }
            });
            this._device.device.queue.submit([
                uploadCommandEncoder.finish()
            ]);
            bufferUploads.forEach((_, buffer)=>buffer.endSyncChanges());
            textureUploads.forEach((_, tex)=>tex.endSyncChanges());
        }
    }
    get currentPass() {
        return this._renderPass.active ? this._renderPass : this._computePass.active ? this._computePass : null;
    }
    beginFrame() {}
    endFrame() {
        this.flush();
    }
    flush() {
        this.flushUploads();
        if (this._renderPass.active) {
            this._renderPass.end();
        }
        if (this._computePass.active) {
            this._computePass.end();
        }
    }
    setFramebuffer(fb) {
        if (this._renderPass.active) {
            this.flushUploads();
        }
        this._renderPass.setFramebuffer(fb);
    }
    getFramebuffer() {
        return this._renderPass.getFramebuffer();
    }
    getFramebufferInfo() {
        return this._renderPass.getFrameBufferInfo();
    }
    executeRenderBundle(renderBundle) {
        if (this._computePass.active) {
            this.flushUploads();
            this._computePass.end();
        }
        this._renderPass.executeRenderBundle(renderBundle);
    }
    bufferUpload(buffer) {
        if (this._bufferUploads.has(buffer)) {
            if (this._drawcallCounter > this._bufferUploads.get(buffer)) {
                this.flush();
            }
        } else {
            this._bufferUploads.set(buffer, this._drawcallCounter);
        }
    }
    textureUpload(tex) {
        if (this._textureUploads.has(tex)) {
            if (this._drawcallCounter > this._textureUploads.get(tex)) {
                this.flush();
            }
        } else {
            this._textureUploads.set(tex, this._drawcallCounter);
        }
    }
    copyBuffer(srcBuffer, dstBuffer, srcOffset, dstOffset, bytes) {
        this.flush();
        const copyCommandEncoder = this._device.device.createCommandEncoder();
        copyCommandEncoder.copyBufferToBuffer(srcBuffer.object, srcOffset, dstBuffer.object, dstOffset, bytes);
        this._device.device.queue.submit([
            copyCommandEncoder.finish()
        ]);
    }
    compute(program, bindGroups, bindGroupOffsets, workgroupCountX, workgroupCountY, workgroupCountZ) {
        this._drawcallCounter++;
        if (this._renderPass.active) {
            this.flushUploads();
            this._renderPass.end();
        }
        this._computePass.compute(program, bindGroups, bindGroupOffsets, workgroupCountX, workgroupCountY, workgroupCountZ);
    }
    draw(program, vertexData, stateSet, bindGroups, bindGroupOffsets, primitiveType, first, count, numInstances) {
        if (this._computePass.active) {
            this.flushUploads();
            this._computePass.end();
        }
        this._drawcallCounter++;
        this._renderPass.draw(program, vertexData, stateSet, bindGroups, bindGroupOffsets, primitiveType, first, count, numInstances);
    }
    capture(renderBundleEncoder, program, vertexData, stateSet, bindGroups, bindGroupOffsets, primitiveType, first, count, numInstances) {
        this._drawcallCounter++;
        if (this._computePass.active) {
            this.flushUploads();
            this._computePass.end();
        }
        this._renderPass.capture(renderBundleEncoder, program, vertexData, stateSet, bindGroups, bindGroupOffsets, primitiveType, first, count, numInstances);
    }
    setViewport(vp) {
        this._renderPass.setViewport(vp);
    }
    getViewport() {
        return this._renderPass.getViewport();
    }
    setScissor(scissor) {
        this._renderPass.setScissor(scissor);
    }
    getScissor() {
        return this._renderPass.getScissor();
    }
    clear(color, depth, stencil) {
        this._renderPass.clear(color, depth, stencil);
    }
    finish() {
        return this._device.device.queue.onSubmittedWorkDone();
    }
}

class WebGPUDevice extends BaseDevice {
    _context;
    _device;
    _adapter;
    _deviceCaps;
    _reverseWindingOrder;
    _canRender;
    _backBufferFormat;
    _depthFormat;
    _defaultMSAAColorTexture;
    _defaultMSAAColorTextureView;
    _defaultDepthTexture;
    _defaultDepthTextureView;
    _pipelineCache;
    _bindGroupCache;
    _vertexLayoutCache;
    _samplerCache;
    _currentProgram;
    _currentVertexData;
    _currentStateSet;
    _currentBindGroups;
    _currentBindGroupOffsets;
    _commandQueue;
    _gpuObjectHashCounter;
    _gpuObjectHasher;
    _defaultRenderPassDesc;
    _sampleCount;
    _emptyBindGroup;
    _captureRenderBundle;
    _adapterInfo;
    constructor(backend, cvs, options){
        super(cvs, backend, options?.dpr);
        this._reverseWindingOrder = false;
        this._defaultMSAAColorTexture = null;
        this._defaultMSAAColorTextureView = null;
        this._currentProgram = null;
        this._currentVertexData = null;
        this._currentStateSet = null;
        this._currentBindGroups = [];
        this._currentBindGroupOffsets = [];
        this._sampleCount = options?.msaa ? 4 : 1;
        this._gpuObjectHasher = new WeakMap();
        this._gpuObjectHashCounter = 1;
        this._captureRenderBundle = null;
        this._samplerCache = new SamplerCache(this);
        this._adapterInfo = {};
    }
    get context() {
        return this._context;
    }
    getFrameBufferSampleCount() {
        return this.getFramebuffer()?.getSampleCount() ?? this._sampleCount;
    }
    get device() {
        return this._device;
    }
    get adapter() {
        return this._adapter;
    }
    get commandQueue() {
        return this._commandQueue;
    }
    get drawingBufferWidth() {
        return this.getDrawingBufferWidth();
    }
    get drawingBufferHeight() {
        return this.getDrawingBufferHeight();
    }
    get clientWidth() {
        return this.canvas.clientWidth;
    }
    get clientHeight() {
        return this.canvas.clientHeight;
    }
    get pipelineCache() {
        return this._pipelineCache;
    }
    get backbufferFormat() {
        return this._backBufferFormat;
    }
    get backbufferDepthFormat() {
        return this._depthFormat;
    }
    get defaultDepthTexture() {
        return this._defaultDepthTexture;
    }
    get defaultDepthTextureView() {
        return this._defaultDepthTextureView;
    }
    get defaultMSAAColorTextureView() {
        return this._defaultMSAAColorTextureView;
    }
    get defaultRenderPassDesc() {
        return this._defaultRenderPassDesc;
    }
    get sampleCount() {
        return this._sampleCount;
    }
    get currentPass() {
        return this._commandQueue.currentPass;
    }
    get emptyBindGroup() {
        return this._emptyBindGroup;
    }
    getAdapterInfo() {
        return this._adapterInfo;
    }
    isContextLost() {
        return false;
    }
    getDeviceCaps() {
        return this._deviceCaps;
    }
    getDrawingBufferWidth() {
        return this.getFramebuffer()?.getWidth() || this.canvas.width;
    }
    getDrawingBufferHeight() {
        return this.getFramebuffer()?.getHeight() || this.canvas.height;
    }
    getBackBufferWidth() {
        return this.canvas.width;
    }
    getBackBufferHeight() {
        return this.canvas.height;
    }
    async initContext() {
        if (!navigator.gpu) {
            throw new Error('No browser support for WebGPU');
        }
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error('WebGPU: requestAdapter() failed');
        }
        this._adapter = adapter;
        this._adapterInfo = this._adapter.info ?? {};
        this._device = await this._adapter.requestDevice({
            requiredFeatures: [
                ...this._adapter.features
            ],
            requiredLimits: {
                ...this._adapter.limits
            }
        });
        console.info('WebGPU device features:');
        for (const feature of this._device.features){
            console.info(` - ${feature}`);
        }
        this.device.lost.then((info)=>{
            console.error(`WebGPU device was lost: ${info.message}`);
            this._canRender = false;
        });
        this._emptyBindGroup = this.device.createBindGroup({
            layout: this.device.createBindGroupLayout({
                entries: []
            }),
            entries: []
        });
        const context = this.canvas.getContext('webgpu') || null;
        if (!context) {
            this._canRender = false;
            throw new Error('WebGPU: getContext() failed');
        }
        this._context = context;
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
        this._deviceCaps = {
            textureCaps: new WebGPUTextureCaps(this),
            framebufferCaps: new WebGPUFramebufferCaps(this),
            miscCaps: new WebGPUMiscCaps(this),
            shaderCaps: new WebGPUShaderCaps(this)
        };
        this.configure();
        this._pipelineCache = new PipelineCache(this);
        this._bindGroupCache = new BindGroupCache(this);
        this._vertexLayoutCache = new VertexLayoutCache();
        this._commandQueue = new CommandQueueImmediate(this);
        this._canRender = true;
        this.setViewport(null);
        this.setScissor(null);
        await this.initResizer();
    }
    _handleResize(_cssWidth, _cssHeight, deviceWidth, deviceHeight) {
        const lastWidth = this.canvas.clientWidth;
        const lastHeight = this.canvas.clientHeight;
        this.canvas.width = deviceWidth;
        this.canvas.height = deviceHeight;
        if (this.canvas.clientWidth !== lastWidth && this.canvas.clientWidth === this.canvas.width || this.canvas.clientHeight !== lastHeight && this.canvas.clientHeight === this.canvas.height) {
            console.warn('[Engine] Canvas intrinsic size affected layout. CSS size locked to prevent feedback loop.');
            this.canvas.style.width = `${lastWidth}px`;
            this.canvas.style.height = `${lastHeight}px`;
        }
        this.createDefaultRenderAttachments();
        this.setViewport(null);
        this.setScissor(null);
    }
    nextFrame(callback) {
        this._commandQueue.finish().then(callback);
        return 0;
    }
    cancelNextFrame(_handle) {
        return;
    }
    clearFrameBuffer(clearColor, clearDepth, clearStencil) {
        this._commandQueue.clear(clearColor, clearDepth, clearStencil);
    }
    // factory
    createGPUTimer() {
        // throw new Error('not implemented');
        return null;
    }
    createRenderStateSet() {
        return new WebGPURenderStateSet(this);
    }
    createBlendingState() {
        return new WebGPUBlendingState();
    }
    createColorState() {
        return new WebGPUColorState();
    }
    createRasterizerState() {
        return new WebGPURasterizerState();
    }
    createDepthState() {
        return new WebGPUDepthState();
    }
    createStencilState() {
        return new WebGPUStencilState();
    }
    createSampler(options) {
        return this.fetchSampler(options);
    }
    createTextureFromMipmapData(data, sRGB, options) {
        if (!data) {
            console.error(`Device.createTextureFromMipmapData() failed: invalid data`);
            return null;
        }
        if (data.isCubemap) {
            const tex = new WebGPUTextureCube(this);
            tex.createWithMipmapData(data, sRGB, this.parseTextureOptions(options));
            tex.samplerOptions = options?.samplerOptions ?? null;
            return tex;
        } else if (data.isVolume) {
            const tex = new WebGPUTexture3D(this);
            tex.createWithMipmapData(data, this.parseTextureOptions(options));
            tex.samplerOptions = options?.samplerOptions ?? null;
            return tex;
        } else if (data.isArray) {
            const tex = new WebGPUTexture2DArray(this);
            tex.createWithMipmapData(data, this.parseTextureOptions(options));
            tex.samplerOptions = options?.samplerOptions ?? null;
            return tex;
        } else {
            const tex = new WebGPUTexture2D(this);
            tex.createWithMipmapData(data, sRGB, this.parseTextureOptions(options));
            tex.samplerOptions = options?.samplerOptions ?? null;
            return tex;
        }
    }
    createTexture2D(format, width, height, options) {
        const tex = options?.texture ?? new WebGPUTexture2D(this);
        if (!tex.isTexture2D()) {
            console.error('createTexture2D() failed: options.texture must be 2d texture');
            return null;
        }
        tex.createEmpty(format, width, height, this.parseTextureOptions(options));
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createTexture2DFromImage(element, sRGB, options) {
        const tex = options?.texture ?? new WebGPUTexture2D(this);
        if (!tex.isTexture2D()) {
            console.error('createTexture2DFromImage() failed: options.texture must be 2d texture');
            return null;
        }
        tex.loadFromElement(element, sRGB, this.parseTextureOptions(options));
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createTexture2DArray(format, width, height, depth, options) {
        const tex = options?.texture ?? new WebGPUTexture2DArray(this);
        if (!tex.isTexture2DArray()) {
            console.error('createTexture2DArray() failed: options.texture must be 2d array texture');
            return null;
        }
        tex.createEmpty(format, width, height, depth, this.parseTextureOptions(options));
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createTexture2DArrayFromImages(elements, sRGB, options) {
        if (!elements || elements.length === 0) {
            console.error('createTexture2DArrayFromImages() failed: Invalid image elements');
            return null;
        }
        let width = 0;
        let height = 0;
        for (const element of elements){
            if (width === 0 || height === 0) {
                width = element.width;
                height = element.height;
            } else if (width !== element.width || height !== element.height) {
                console.error('createTexture2DArrayFromImages() failed: Image elements must have the same size');
                return null;
            }
        }
        if (options?.texture && !options.texture.isTexture2DArray()) {
            console.error('createTexture2DArrayFromImages() failed: options.texture must be 2d array texture');
            return null;
        }
        let tex = options?.texture;
        if (tex) {
            if (tex.depth !== elements.length) {
                console.error('createTexture2DArrayFromImages() failed: Layer count of options.texture not match the given image elements');
                return null;
            }
            if (tex.width !== width || tex.height !== height) {
                console.error('createTexture2DArrayFromImages() failed: Size of options.texture not match the given image elements');
                return null;
            }
        } else {
            tex = this.createTexture2DArray(sRGB ? 'rgba8unorm-srgb' : 'rgba8unorm', width, height, elements.length, options);
            if (!tex) {
                return null;
            }
            for(let i = 0; i < elements.length; i++){
                tex.updateFromElement(elements[i], 0, 0, i, 0, 0, width, height);
            }
        }
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createTexture3D(format, width, height, depth, options) {
        const tex = options?.texture ?? new WebGPUTexture3D(this);
        if (!tex.isTexture3D()) {
            console.error('createTexture3D() failed: options.texture must be 3d texture');
            return null;
        }
        tex.createEmpty(format, width, height, depth, this.parseTextureOptions(options));
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createCubeTexture(format, size, options) {
        const tex = options?.texture ?? new WebGPUTextureCube(this);
        if (!tex.isTextureCube()) {
            console.error('createCubeTexture() failed: options.texture must be cube texture');
            return null;
        }
        tex.createEmpty(format, size, this.parseTextureOptions(options));
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createTextureVideo(el, samplerOptions) {
        const tex = new WebGPUTextureVideo(this, el);
        tex.samplerOptions = samplerOptions ?? null;
        return tex;
    }
    copyFramebufferToTexture2D(src, index, dst, level) {
        if (!src?.isFramebuffer() || !dst?.isTexture2D()) {
            console.error('copyFramebufferToTexture2D(): invalid texture');
            return;
        }
        const srcTex = src.getColorAttachments()?.[index];
        if (!srcTex || !srcTex.isTexture2D()) {
            console.error('copyFramebufferToTexture2D(): Color attachment is not a 2D texture');
            return;
        }
        this.copyTexture2D(srcTex, src.getColorAttachmentMipLevel(index), dst, level);
    }
    copyTexture2D(src, srcLevel, dst, dstLevel) {
        if (!src?.isTexture2D() || !dst?.isTexture2D()) {
            console.error('CopyTexture2D(): invalid texture');
            return;
        }
        if (!Number.isInteger(srcLevel) || srcLevel < 0 || srcLevel >= src.mipLevelCount) {
            console.error('CopyTexture2D(): invalid source mipmap level');
            return;
        }
        if (!Number.isInteger(dstLevel) || dstLevel < 0 || dstLevel >= dst.mipLevelCount) {
            console.error('CopyTexture2D(): invalid destination mipmap level');
            return;
        }
        const srcWidth = Math.max(src.width >> srcLevel, 1);
        const srcHeight = Math.max(src.height >> srcLevel, 1);
        const dstWidth = Math.max(dst.width >> dstLevel, 1);
        const dstHeight = Math.max(dst.height >> dstLevel, 1);
        if (srcWidth !== dstWidth || srcHeight !== dstHeight) {
            console.error('Source texture and destination texture must have same size');
            return;
        }
        if (src.format !== dst.format) {
            console.error('CopyTexture2D(): Source texture and destination texture must have same format');
            return;
        }
        this.flush();
        const srcTex = src;
        const dstTex = dst;
        const commandEncoder = this._device.createCommandEncoder();
        commandEncoder.copyTextureToTexture({
            texture: srcTex.object,
            mipLevel: srcLevel,
            origin: {
                x: 0,
                y: 0,
                z: 0
            }
        }, {
            texture: dstTex.object,
            mipLevel: dstLevel,
            origin: {
                x: 0,
                y: 0,
                z: 0
            }
        }, {
            width: srcWidth,
            height: srcHeight,
            depthOrArrayLayers: 1
        });
        this._device.queue.submit([
            commandEncoder.finish()
        ]);
    }
    createGPUProgram(params) {
        return new WebGPUProgram(this, params);
    }
    createBindGroup(layout) {
        return new WebGPUBindGroup(this, layout);
    }
    createBuffer(sizeInBytes, options) {
        return new WebGPUBuffer(this, this.parseBufferOptions(options), sizeInBytes);
    }
    copyBuffer(sourceBuffer, destBuffer, srcOffset, dstOffset, bytes) {
        this._commandQueue.copyBuffer(sourceBuffer, destBuffer, srcOffset, dstOffset, bytes);
    }
    createIndexBuffer(data, options) {
        return new WebGPUIndexBuffer(this, data, this.parseBufferOptions(options, 'index'));
    }
    createStructuredBuffer(structureType, options, data) {
        return new WebGPUStructuredBuffer(this, structureType, this.parseBufferOptions(options), data);
    }
    createVertexLayout(options) {
        return new WebGPUVertexLayout(this, options);
    }
    createFrameBuffer(colorAttachments, depthAttachement, options) {
        return new WebGPUFrameBuffer(this, colorAttachments, depthAttachement, options);
    }
    setBindGroup(index, bindGroup, dynamicOffsets) {
        this._currentBindGroups[index] = bindGroup;
        this._currentBindGroupOffsets[index] = dynamicOffsets ?? bindGroup?.getDynamicOffsets() ?? null;
    }
    getBindGroup(index) {
        return [
            this._currentBindGroups[index],
            this._currentBindGroupOffsets[index]
        ];
    }
    // render related
    setViewport(vp) {
        this._commandQueue.setViewport(vp);
    }
    getViewport() {
        return this._commandQueue.getViewport();
    }
    setScissor(scissor) {
        this._commandQueue.setScissor(scissor);
    }
    getScissor() {
        return this._commandQueue.getScissor();
    }
    setProgram(program) {
        this._currentProgram = program;
    }
    getProgram() {
        return this._currentProgram;
    }
    setVertexLayout(vertexData) {
        this._currentVertexData = vertexData;
    }
    getVertexLayout() {
        return this._currentVertexData;
    }
    setRenderStates(stateSet) {
        this._currentStateSet = stateSet;
    }
    getRenderStates() {
        return this._currentStateSet;
    }
    getFramebuffer() {
        return this._commandQueue.getFramebuffer();
    }
    reverseVertexWindingOrder(reverse) {
        this._reverseWindingOrder = !!reverse;
    }
    isWindingOrderReversed() {
        return this._reverseWindingOrder;
    }
    /** @internal */ isBufferUploading(buffer) {
        return this._commandQueue.isBufferUploading(buffer);
    }
    /** @internal */ isTextureUploading(tex) {
        return this._commandQueue.isTextureUploading(tex);
    }
    /** @internal */ getFramebufferInfo() {
        return this._commandQueue.getFramebufferInfo();
    }
    /** @internal */ gpuGetObjectHash(obj) {
        return this._gpuObjectHasher.get(obj) ?? null;
    }
    /** @internal */ gpuCreateTexture(desc) {
        const tex = this._device.createTexture(desc);
        if (tex) {
            this._gpuObjectHasher.set(tex, ++this._gpuObjectHashCounter);
        }
        return tex;
    }
    /** @internal */ gpuImportExternalTexture(el) {
        const tex = this._device.importExternalTexture({
            source: el
        });
        if (tex) {
            this._gpuObjectHasher.set(tex, ++this._gpuObjectHashCounter);
        }
        return tex;
    }
    /** @internal */ gpuCreateSampler(desc) {
        const sampler = this._device.createSampler(desc);
        if (sampler) {
            this._gpuObjectHasher.set(sampler, ++this._gpuObjectHashCounter);
        }
        return sampler;
    }
    /** @internal */ gpuCreateBindGroup(desc) {
        const bindGroup = this._device.createBindGroup(desc);
        if (bindGroup) {
            this._gpuObjectHasher.set(bindGroup, ++this._gpuObjectHashCounter);
        }
        return bindGroup;
    }
    /** @internal */ gpuCreateBuffer(desc) {
        const buffer = this._device.createBuffer(desc);
        if (buffer) {
            this._gpuObjectHasher.set(buffer, ++this._gpuObjectHashCounter);
        }
        return buffer;
    }
    /** @internal */ gpuCreateTextureView(texture, desc) {
        const view = texture?.createView(desc);
        if (view) {
            this._gpuObjectHasher.set(view, ++this._gpuObjectHashCounter);
        }
        return view;
    }
    /** @internal */ gpuCreateRenderPipeline(desc) {
        const pipeline = this._device.createRenderPipeline(desc);
        if (pipeline) {
            this._gpuObjectHasher.set(pipeline, ++this._gpuObjectHashCounter);
        }
        return pipeline;
    }
    /** @internal */ gpuCreateComputePipeline(desc) {
        const pipeline = this._device.createComputePipeline(desc);
        if (pipeline) {
            this._gpuObjectHasher.set(pipeline, ++this._gpuObjectHashCounter);
        }
        return pipeline;
    }
    /** @internal */ fetchVertexLayout(hash) {
        return this._vertexLayoutCache.fetchVertexLayout(hash);
    }
    /** @internal */ fetchSampler(options) {
        return this._samplerCache.fetchSampler(options);
    }
    /** @internal */ fetchBindGroupLayout(desc) {
        return this._bindGroupCache.fetchBindGroupLayout(desc);
    }
    flush() {
        this._commandQueue.flush();
    }
    async readPixels(index, x, y, w, h, buffer) {
        const fb = this.getFramebuffer();
        const colorAttachment = fb ? fb.getColorAttachments()[index]?.object : this.context.getCurrentTexture();
        const texFormat = fb ? fb.getColorAttachments()[index]?.format : textureFormatInvMap[this._backBufferFormat];
        if (colorAttachment && texFormat) {
            const pixelSize = getTextureFormatBlockSize(texFormat);
            const bufferSize = w * h * pixelSize;
            const stagingBuffer = this.createBuffer(bufferSize, {
                usage: 'read'
            });
            this.readPixelsToBuffer(0, x, y, w, h, stagingBuffer);
            const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            await stagingBuffer.getBufferSubData(data);
            stagingBuffer.dispose();
        } else {
            console.error('readPixels() failed: no color attachment0 or unrecoganized color attachment format');
        }
    }
    readPixelsToBuffer(index, x, y, w, h, buffer) {
        const fb = this.getFramebuffer();
        const colorAttachment = fb ? fb.getColorAttachments()[index]?.object : this.context.getCurrentTexture();
        const texFormat = fb ? fb.getColorAttachments()[index]?.format : textureFormatInvMap[this._backBufferFormat];
        if (colorAttachment && texFormat) {
            this.flush();
            WebGPUBaseTexture.copyTexturePixelsToBuffer(this._device, colorAttachment, texFormat, x, y, w, h, 0, 0, buffer);
        } else {
            console.error('readPixelsToBuffer() failed: no color attachment0 or unrecoganized color attachment format');
        }
    }
    looseContext() {
    // not implemented
    }
    restoreContext() {
    // not implemented
    }
    beginCapture() {
        if (this._captureRenderBundle) {
            throw new Error('Device.beginCapture() failed: device is already capturing draw commands');
        }
        const frameBuffer = this.getFramebufferInfo();
        const desc = {
            colorFormats: frameBuffer.colorFormats,
            depthStencilFormat: frameBuffer.depthFormat,
            sampleCount: frameBuffer.sampleCount
        };
        this._captureRenderBundle = {
            dc: 0,
            encoder: this._device.createRenderBundleEncoder(desc),
            renderBundle: null
        };
    }
    endCapture() {
        if (!this._captureRenderBundle) {
            throw new Error('Device.endCapture() failed: device is not capturing draw commands');
        }
        this._captureRenderBundle.renderBundle = this._captureRenderBundle.encoder.finish();
        const ret = this._captureRenderBundle;
        this._captureRenderBundle = null;
        return ret;
    }
    _executeRenderBundle(renderBundle) {
        this._commandQueue.executeRenderBundle(renderBundle.renderBundle);
        return renderBundle.dc;
    }
    bufferUpload(buffer) {
        this._commandQueue.bufferUpload(buffer);
    }
    textureUpload(tex) {
        this._commandQueue.textureUpload(tex);
    }
    flushUploads() {
        this._commandQueue.flushUploads();
    }
    /** @internal */ _setFramebuffer(rt) {
        this._commandQueue.setFramebuffer(rt);
    }
    /** @internal */ onBeginFrame() {
        if (this._canRender) {
            this._commandQueue.beginFrame();
            return true;
        } else {
            return false;
        }
    }
    /** @internal */ onEndFrame() {
        this._commandQueue.endFrame();
    }
    /** @internal */ _draw(primitiveType, first, count) {
        this._commandQueue.draw(this._currentProgram, this._currentVertexData, this._currentStateSet, this._currentBindGroups, this._currentBindGroupOffsets, primitiveType, first, count, 1);
        if (this._captureRenderBundle) {
            this._captureRenderBundle.dc++;
            this._commandQueue.capture(this._captureRenderBundle.encoder, this._currentProgram, this._currentVertexData, this._currentStateSet, this._currentBindGroups, this._currentBindGroupOffsets, primitiveType, first, count, 1);
        }
    }
    /** @internal */ _drawInstanced(primitiveType, first, count, numInstances) {
        this._commandQueue.draw(this._currentProgram, this._currentVertexData, this._currentStateSet, this._currentBindGroups, this._currentBindGroupOffsets, primitiveType, first, count, numInstances);
        if (this._captureRenderBundle) {
            this._captureRenderBundle.dc++;
            this._commandQueue.capture(this._captureRenderBundle.encoder, this._currentProgram, this._currentVertexData, this._currentStateSet, this._currentBindGroups, this._currentBindGroupOffsets, primitiveType, first, count, numInstances);
        }
    }
    /** @internal */ _compute(workgroupCountX, workgroupCountY, workgroupCountZ) {
        this._commandQueue.compute(this._currentProgram, this._currentBindGroups, this._currentBindGroupOffsets, workgroupCountX, workgroupCountY, workgroupCountZ);
    }
    configure() {
        this._backBufferFormat = navigator.gpu.getPreferredCanvasFormat();
        this._depthFormat = this._deviceCaps.framebufferCaps.supportDepth32floatStencil8 ? 'depth32float-stencil8' : 'depth24plus-stencil8';
        this._context.configure({
            device: this._device,
            format: this._backBufferFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
            alphaMode: 'opaque',
            colorSpace: 'srgb'
        });
        this.createDefaultRenderAttachments();
    }
    createDefaultRenderAttachments() {
        const width = Math.max(1, this.canvas.width);
        const height = Math.max(1, this.canvas.height);
        this._defaultMSAAColorTexture?.destroy();
        this._defaultMSAAColorTexture = null;
        this._defaultMSAAColorTextureView = null;
        this._defaultDepthTexture?.destroy();
        if (this._sampleCount > 1) {
            this._defaultMSAAColorTexture = this.gpuCreateTexture({
                size: {
                    width,
                    height,
                    depthOrArrayLayers: 1
                },
                format: this._backBufferFormat,
                dimension: '2d',
                mipLevelCount: 1,
                sampleCount: this._sampleCount,
                usage: GPUTextureUsage.RENDER_ATTACHMENT
            });
            this._defaultMSAAColorTextureView = this._defaultMSAAColorTexture.createView();
        }
        this._defaultDepthTexture = this.gpuCreateTexture({
            size: {
                width,
                height,
                depthOrArrayLayers: 1
            },
            format: this._depthFormat,
            dimension: '2d',
            mipLevelCount: 1,
            sampleCount: this._sampleCount,
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        this._defaultDepthTextureView = this._defaultDepthTexture.createView();
        this._defaultRenderPassDesc = {
            label: `mainRenderPass:${this._sampleCount}`,
            colorAttachments: [
                {
                    view: this._sampleCount > 1 ? this._defaultMSAAColorTextureView : null,
                    resolveTarget: undefined,
                    loadOp: 'clear',
                    clearValue: [
                        0,
                        0,
                        0,
                        0
                    ],
                    storeOp: 'store'
                }
            ],
            depthStencilAttachment: {
                view: this._defaultDepthTextureView,
                depthLoadOp: 'clear',
                depthClearValue: 1,
                depthStoreOp: 'store',
                stencilLoadOp: 'clear',
                stencilClearValue: 0,
                stencilStoreOp: 'store'
            }
        };
    }
}

let webGPUStatus = null;
/**
 * The WebGPU backend
 * @public
 */ const backendWebGPU = {
    typeName () {
        return 'webgpu';
    },
    async supported () {
        if (!webGPUStatus) {
            webGPUStatus = new Promise(async (resolve)=>{
                let status = true;
                try {
                    if (!('gpu' in navigator)) {
                        status = false;
                    }
                    const adapter = await navigator.gpu.requestAdapter();
                    if (!adapter) {
                        status = false;
                    } else {
                        const device = await adapter.requestDevice();
                        if (!device) {
                            status = false;
                        } else if (typeof device.destroy === 'function') {
                            device.destroy();
                        }
                        status = true;
                    }
                } catch  {
                    status = false;
                }
                resolve(status);
            });
        }
        return webGPUStatus;
    },
    async createDevice (cvs, options) {
        try {
            const factory = makeObservable(WebGPUDevice)();
            const device = new factory(this, cvs, options);
            await device.initContext();
            device.setViewport(null);
            device.setScissor(null);
            return device;
        } catch (err) {
            console.error(err);
            return null;
        }
    }
};

export { backendWebGPU };
//# sourceMappingURL=zephyr3d_backend-webgpu.js.map
