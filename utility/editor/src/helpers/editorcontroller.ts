import { Vector3, Quaternion, Matrix3x3, Matrix4x4, ASSERT } from '@zephyr3d/base';
import type {
  IControllerPointerDownEvent,
  IControllerPointerMoveEvent,
  IControllerPointerUpEvent,
  IControllerWheelEvent,
  IControllerKeydownEvent,  // 键盘按下事件接口
  IControllerKeyupEvent     // 键盘释放事件接口
} from '@zephyr3d/scene';
import { BaseCameraController } from '@zephyr3d/scene';

export interface EditorCameraControllerOptions {
  /** Moving speed */
  moveSpeed?: number;
  /** Zoom speed */
  zoomSpeed?: number;
  /** Rotating speed */
  rotateSpeed?: number;
  /** Scale speed */
  scaleSpeed?: number;
  /** Zoom damping */
  zoomDamping?: number;
  /** WSADQE movement speed multiplier when right mouse button is held */
  rightClickMoveSpeed?: number;
}

export class EditorCameraController extends BaseCameraController {
  /** @internal */
  private readonly options: EditorCameraControllerOptions;
  /** @internal */
  private altLeftMouseDown: boolean; // 新增：Alt+左键状态
  /** @internal */
  private rightMouseDown: boolean;
  /** @internal */
  private middleMouseDown: boolean;
  /** @internal */
  private lastMouseX: number;
  /** @internal */
  private lastMouseY: number;
  /** @internal */
  /** @internal */
  private viewCenter: Vector3; // 新增：固定的视图中心点
  public cameraDistanceToViewCenter: number; // 公共变量：相机到视图中心的距离（缓存值）
  /** @internal */
  private pressedKeys: Set<string>; // 新增：记录按下的按键
  /**
 * 检查是否按下了鼠标右键
 * @returns 如果右键按下返回true
 */
  isRightMouseDown(): boolean {
    return this.rightMouseDown;
  }
   /**
 * 获取当前摄像机前方目标点
 * @returns 如果相机有效返回坐标
 */ 
  getCameraTargetPos(): Vector3{
      // 尝试获取摄像机并设置视图中心到其前方10个单位
    try {
      const camera = this._getCamera();
      if (camera) {
        // 获取摄像机世界矩阵的前向向量 (负Z轴，但通常“前”是-Z方向，此处需根据引擎坐标系确认)
        // 假设 camera.worldMatrix 的行2 (索引2) 是-Z轴方向 (摄像机朝向)
        const forward = camera.worldMatrix.getRow(2).xyz().inplaceNormalize();
        // 获取摄像机世界位置
        const cameraPos = new Vector3();
        const cameraScale = new Vector3();
        const cameraRotation = new Quaternion();
        camera.worldMatrix.decompose(cameraScale, cameraRotation, cameraPos);
        // 计算摄像机前方10个单位的位置: 位置 + 前向向量 * 10
        const targetPos = Vector3.add(cameraPos, forward.scaleBy(-10));
        return targetPos;
      } else {
        // 摄像机未就绪，暂时设置为原点
        return new Vector3(0,0,0);
      }
    } catch (error) {
      // 防止_getCamera()调用异常，回退到原点
      console.warn('Failed to get camera for initial view center, setting to origin.', error);
      return new Vector3(0,0,0);
    }
  }

  /**
   * Creates an instance of FPSCameraController
   * @param options - The creation options
   */
  constructor(options?: EditorCameraControllerOptions) {
    super();
    this.options = {
      moveSpeed: 0.1,
      zoomSpeed: 5,
      rotateSpeed: 0.01,
      scaleSpeed: 0.01,
      zoomDamping: 10,
      rightClickMoveSpeed: 2, // 新增：右键按住时的移动速度倍数
      ...options
    };
    this.viewCenter = this.getCameraTargetPos(); // 默认中心点
    this.pressedKeys = new Set<string>(); // 初始化按键集合
    this.cameraDistanceToViewCenter = 0;
    this.reset();
  }
  
  /**
   * {@inheritDoc BaseCameraController.reset}
   * @override
   */
  reset() {
    this.rightMouseDown = false;
    this.middleMouseDown = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.pressedKeys.clear(); // 重置按键集合
    this.viewCenter = this.getCameraTargetPos(); // 重置视图中心
    // 重置后同步刷新距离缓存，供平移/旋转逻辑复用
    this.refreshCameraDistanceToViewCenter();
  }


  
  /**
   * {@inheritDoc BaseCameraController._onMouseDown}
   * @override
   */
  protected _onMouseDown(evt: IControllerPointerDownEvent): boolean {
    // 修改：添加Alt+左键支持
    if (evt.button === 0 && evt.altKey) {
      this.altLeftMouseDown = true;
    }else if (evt.button === 1) {
      this.middleMouseDown = true;
    } else if (evt.button === 2) {
      this.rightMouseDown = true;
    } else {
      return false;
    }
    this.lastMouseX = evt.offsetX;
    this.lastMouseY = evt.offsetY;
    return true;
  }
  
  /**
   * {@inheritDoc BaseCameraController._onMouseUp}
   * @override
   */
  protected _onMouseUp(evt: IControllerPointerUpEvent): boolean {
    // 修改：检查Alt+左键释放
    if (evt.button === 0 && this.altLeftMouseDown) {
      this.altLeftMouseDown = false;
      return true;
    }else if (evt.button === 1 && this.middleMouseDown) {
      this.middleMouseDown = false;
      return true;
    } else if (evt.button === 2 && this.rightMouseDown) {
        this.rightMouseDown = false;
        if(!evt.altKey){
          this.setViewCenter(this.getCameraTargetPos()); 
        }
        return true;
    }
    return false;
  }
  
  /**
   * {@inheritDoc BaseCameraController._onMouseMove}
   * @override
   */
  protected _onMouseMove(evt: IControllerPointerMoveEvent): boolean {
    
    // 新增：Alt+左键旋转逻辑（围绕固定视图中心）
    if (this.altLeftMouseDown && evt.altKey && this._getCamera().isPerspective()) {
      const dx = evt.offsetX - this.lastMouseX;
      const dy = evt.offsetY - this.lastMouseY;
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;

      const camera = this._getCamera();
      
      // ========== 新模式：始终围绕固定中心点旋转 ==========
      // 1. 获取摄像机当前位置
      const cameraWorldPos = new Vector3();
      const cameraRotation = new Quaternion();
      const cameraScale = new Vector3();
      camera.worldMatrix.decompose(cameraScale, cameraRotation, cameraWorldPos);
      
      // 2. 计算摄像机到视图中心的向量和距离
      const cameraToViewCenter = Vector3.sub(this.viewCenter, cameraWorldPos);
      const distance = this.cameraDistanceToViewCenter;
      
      if (distance < 1e-6) {
        // 防止摄像机与视图中心重合导致计算异常
        console.warn('Camera is too close to the view center. Falling back to default rotation.');
        return this._performDefaultRotation(dx, dy);
      }
      
      // 3. 将摄像机到视图中心的向量标准化
      const direction = cameraToViewCenter.inplaceNormalize();
      
      // 4. 计算基于鼠标位移的新方位角
      const currentTheta = Math.atan2(direction.z, direction.x);
      const currentPhi = Math.asin(direction.y);
      
      // 计算新的角度
      const newTheta = currentTheta + dx * this.options.rotateSpeed;
      const newPhi = Math.min(
        Math.PI / 2.1,
        Math.max(-Math.PI / 2.1, currentPhi - dy * this.options.rotateSpeed)
      );
      
      // 5. 根据新角度计算新的方向向量
      const cosPhi = Math.cos(newPhi);
      const newDirection = new Vector3(
        cosPhi * Math.cos(newTheta),
        Math.sin(newPhi),
        cosPhi * Math.sin(newTheta)
      ).inplaceNormalize();
      
      // 6. 计算新的摄像机位置
      const newCameraWorldPos = Vector3.sub(this.viewCenter, newDirection.scaleBy(distance));
      
      // 7. 计算摄像机的新朝向（看向视图中心）
      const lookAtRotation = new Quaternion();
      const forward = Vector3.sub(this.viewCenter, newCameraWorldPos).inplaceNormalize();
      const back = forward.scaleBy(-1); 
      const right = Vector3.cross(Vector3.axisPY(), forward).inplaceNormalize();
      const up = Vector3.cross(forward, right).inplaceNormalize();
      
      const rotationMatrix = new Matrix3x3([
        right.x, right.y, right.z,
        up.x, up.y, up.z,
        back.x, back.y, back.z
      ]);

      lookAtRotation.set(Quaternion.fromRotationMatrix(rotationMatrix));
      
      // 8. 更新摄像机变换
      if (!camera.parent) {
        camera.position.set(newCameraWorldPos);
        camera.rotation.set(lookAtRotation);
      } else {
        const newWorldMatrix = Matrix4x4.scaling(cameraScale)
          .rotateLeft(lookAtRotation)
          .translateLeft(newCameraWorldPos);
        const newLocalMatrix = newWorldMatrix.multiplyLeftAffine(
          Matrix4x4.invertAffine(camera.parent.worldMatrix)
        );
        const newLocalPos = new Vector3();
        const newLocalScale = new Vector3();
        const newLocalRotation = new Quaternion();
        newLocalMatrix.decompose(newLocalScale, newLocalRotation, newLocalPos);
        camera.position.set(newLocalPos);
        camera.scale.set(newLocalScale);
        camera.rotation.set(newLocalRotation);
      }
      // 绕固定中心旋转不会改变半径，直接复用当前 distance 更新缓存值
      this.cameraDistanceToViewCenter = distance;
      return true;
    }

    // 右键直接调用默认旋转
    if (!evt.altKey && this.rightMouseDown && this._getCamera().isPerspective()) {
      const dx = evt.offsetX - this.lastMouseX;
      const dy = evt.offsetY - this.lastMouseY;
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      return this._performDefaultRotation(dx, dy);
    }

    // 修改：中键平移时，视图中心跟随摄像机一起平移
    if (evt.altKey) {
      const dx = evt.offsetX - this.lastMouseX;
      const dy = evt.offsetY - this.lastMouseY;
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      // const zooming = evt.altKey;
      const moveSpeed = this._getCamera().isPerspective() ? this.options.moveSpeed : this.options.scaleSpeed;
      let moveX = -dx * moveSpeed;
      let moveY = dy * moveSpeed;
      const z = this._getCamera().worldMatrix.getRow(2).xyz().inplaceNormalize();
      if (this.rightMouseDown) {
        if (this._getCamera().isPerspective()) {
          const move = z.scaleBy(moveX);
          this._moveCamera(move);
        } else if (dx !== 0) {
          this._scaleCamera(dx < 0 ? 1 / (1 - dx * moveSpeed) : 1 + dx * moveSpeed);
        }
      } else if(this.middleMouseDown){
        const x = this._getCamera()
          .worldMatrix.getRow(0)
          .xyz()
          .mulBy(new Vector3(1, 0, 1))
          .inplaceNormalize();
        const y = Vector3.cross(z, x);
        if (this._getCamera().isPerspective()) {
          // 使用缓存距离控制中键平移速度，距离越远速度越快
          const panSpeedScale = Math.max(0.01, this.cameraDistanceToViewCenter * 0.02);
          moveX *= panSpeedScale;
          moveY *= panSpeedScale;
          const move = Vector3.combine(x, y, moveX, moveY);
          this._moveCamera(move);

          // 新增：视图中心跟随摄像机一起平移
          this.moveViewCenter(move);
        } else {
          const viewport = this._getCamera().viewport;
          const projMatrix = this._getCamera().getProjectionMatrix();
          const width = projMatrix.getRightPlane() - projMatrix.getLeftPlane();
          const height = projMatrix.getTopPlane() - projMatrix.getBottomPlane();
          const deltaX = (-dx * width) / viewport[2];
          const deltaY = (dy * height) / viewport[3];
          const move = Vector3.combine(x, y, deltaX, deltaY);
          this._moveCamera(move);
          
          // 新增：视图中心跟随摄像机一起平移
          this.moveViewCenter(move);
        }
      }
      return true;
    }
    return false;
  }

  /**
   * 计算相机到视图中心的真实距离（私有计算方法）
   */
  private calcCameraDistanceToViewCenter(): number {
    const camera = this._getCamera();
    if (!camera) {
      // 控制器初始化早期可能还没有相机，返回 0 避免空引用
      return 0;
    }
    const cameraPos = new Vector3();
    const cameraScale = new Vector3();
    camera.worldMatrix.decompose(cameraScale, null, cameraPos);
    const delta = Vector3.sub(this.viewCenter, cameraPos);
    return Math.sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z);
  }

  /**
   * 刷新公共距离缓存，避免多处重复计算 distance
   */
  private refreshCameraDistanceToViewCenter(): void {
    // 统一刷新缓存，减少多处重复计算
    this.cameraDistanceToViewCenter = this.calcCameraDistanceToViewCenter();
  }
  
  /**
   * 新增：处理按键按下事件
   * @override
   */
  protected _onKeyDown(evt: IControllerKeydownEvent): boolean {
    // 只处理W、S、A、D、Q、E键
    if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE'].includes(evt.code)) {
      this.pressedKeys.add(evt.code);
      return true;
    }
    return false;
  }

    /**
   * 新增：处理按键释放事件
   * @override
   */
  protected _onKeyUp(evt: IControllerKeyupEvent): boolean {
    if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE'].includes(evt.code)) {
      this.pressedKeys.delete(evt.code);
      return true;
    }
    return false;
  }

    /**
   * 新增：更新方法，用于处理帧更新时的移动逻辑
   * @override
   */
  update(): void {
    super.update();
    
    // 当鼠标右键被按下时，处理WSADQE按键移动
    if (this.rightMouseDown && this.pressedKeys.size > 0 && this._getCamera().isPerspective()) {
      this._handleWASDQEMovement();
    }
  }

    /**
   * 新增：处理WSADQE按键移动
   */
  private _handleWASDQEMovement(): void {
    if (this.pressedKeys.size === 0) return;
    
    const camera = this._getCamera();
    const moveSpeed = this.options.moveSpeed * (this.options.rightClickMoveSpeed || 3);
    const moveVector = new Vector3(0, 0, 0);
    
    // 获取摄像机的局部坐标系方向
    const forward = camera.worldMatrix.getRow(2).xyz().inplaceNormalize().scaleBy(-1); // 摄像机前向
    const right = camera.worldMatrix.getRow(0).xyz().inplaceNormalize(); // 摄像机右向
    const up = camera.worldMatrix.getRow(1).xyz().inplaceNormalize(); // 摄像机上向
    
    // 处理每个按下的键
    for (const key of this.pressedKeys) {
      switch (key) {
        case 'KeyW': // 前移
          moveVector.addBy(forward.scaleBy(moveSpeed));
          break;
        case 'KeyS': // 后移
          moveVector.addBy(forward.scaleBy(-moveSpeed));
          break;
        case 'KeyA': // 左移
          moveVector.addBy(right.scaleBy(-moveSpeed));
          break;
        case 'KeyD': // 右移
          moveVector.addBy(right.scaleBy(moveSpeed));
          break;
        case 'KeyQ': // 下移
          moveVector.addBy(up.scaleBy(-moveSpeed));
          break;
        case 'KeyE': // 上移
          moveVector.addBy(up.scaleBy(moveSpeed));
          break;
      }
    }
    
    // 应用移动
    const moveLength = Math.sqrt(
      moveVector.x * moveVector.x + 
      moveVector.y * moveVector.y + 
      moveVector.z * moveVector.z
    );
    if (moveLength > 0.0001) {
      this._moveCamera(moveVector);
      // 统一通过方法更新视图中心，自动维护距离缓存
      this.moveViewCenter(moveVector);
    }
  }
  
  /**
   * 执行原始的绕自身旋转逻辑（内部辅助函数）
   * @private
   */
  private _performDefaultRotation(dx: number, dy: number): boolean {
    const camera = this._getCamera();
    const zAxis = camera.worldMatrix.getRow(2).xyz();
    const alpha = Math.atan2(zAxis.z, zAxis.x) + dx * this.options.rotateSpeed;
    const beta = Math.min(
      Math.PI / 2.1,
      Math.max(-Math.PI / 2.1, Math.asin(zAxis.y) + dy * this.options.rotateSpeed)
    );
    const newY = Math.sin(beta);
    const r = Math.sqrt(Math.max(0, 1 - newY * newY));
    const newZ = Math.sin(alpha) * r;
    const newX = Math.cos(alpha) * r;
    zAxis.setXYZ(newX, newY, newZ).inplaceNormalize();
    const XAxis = Vector3.cross(Vector3.axisPY(), zAxis).inplaceNormalize();
    const YAxis = Vector3.cross(zAxis, XAxis).inplaceNormalize();

    // 修复：正确的矩阵构造
    const rotation = Quaternion.fromRotationMatrix(
      new Matrix3x3([XAxis.x, XAxis.y, XAxis.z, YAxis.x, YAxis.y, YAxis.z, zAxis.x, zAxis.y, zAxis.z])
    );
    
    if (!camera.parent) {
      camera.rotation.set(rotation);
    } else {
      const pos = new Vector3();
      const scale = new Vector3();
      camera.worldMatrix.decompose(scale, null, pos);
      const newWorldMatrix = Matrix4x4.scaling(scale).rotateLeft(rotation).translateLeft(pos);
      const newLocalMatrix = camera.parent
        ? newWorldMatrix.multiplyLeftAffine(Matrix4x4.invertAffine(camera.parent.worldMatrix))
        : newWorldMatrix;
      newLocalMatrix.decompose(scale, rotation, pos);
      camera.position.set(pos);
      camera.scale.set(scale);
      camera.rotation.set(rotation);
    }
    return true;
  }
  
  
  protected _onMouseWheel(evt: IControllerWheelEvent): boolean {
    let px = evt.deltaY;
    if (evt.deltaMode === 1) {
      px *= 16;
    } else if (evt.deltaMode === 2) {
      px *= window.innerHeight;
    }
    if (evt.ctrlKey) {
      px *= 10;
    }
    if (evt.shiftKey) {
      px *= 0.1;
    }
    px = Math.max(-100, Math.min(100, px));

    const z = this._getCamera().worldMatrix.getRow(2).xyz().inplaceNormalize();
    const move = z.scaleBy(this.options.zoomSpeed * px * 0.01);
    this._moveCamera(move);
    return true;
  }
  
  private _scaleCamera(scale: number) {
    ASSERT(!this._getCamera().isPerspective());
    const projMatrix = this._getCamera().getProjectionMatrix();
    const left = projMatrix.getLeftPlane() * scale;
    const right = projMatrix.getRightPlane() * scale;
    const bottom = projMatrix.getBottomPlane() * scale;
    const top = projMatrix.getTopPlane() * scale;
    const near = projMatrix.getNearPlane();
    const far = projMatrix.getFarPlane();
    this._getCamera().setProjectionMatrix(Matrix4x4.ortho(left, right, bottom, top, near, far));
  }
  
  private _moveCamera(move: Vector3) {
    if (this._getCamera().parent) {
      const pos = new Vector3();
      const scale = new Vector3();
      const rotation = new Quaternion();
      this._getCamera().worldMatrix.decompose(scale, rotation, pos);
      pos.addBy(move);
      const newWorldMatrix = Matrix4x4.scaling(scale).rotateLeft(rotation).translateLeft(pos);
      const newLocalMatrix = newWorldMatrix.multiplyLeftAffine(
        Matrix4x4.invertAffine(this._getCamera().parent.worldMatrix)
      );
      newLocalMatrix.decompose(scale, rotation, pos);
      this._getCamera().position.set(pos);
      this._getCamera().scale.set(scale);
      this._getCamera().rotation.set(rotation);
    } else {
      this._getCamera().moveBy(move);
    }
    // 相机位置变化后刷新距离缓存
    this.refreshCameraDistanceToViewCenter();
  }
  
    /**
   * 设置视图中心点
   * @param center - 新的视图中心
   */
  setViewCenter(center: Vector3): void {
    this.viewCenter.set(center);
    // 视图中心变化后刷新距离缓存
    this.refreshCameraDistanceToViewCenter();
  }
  
  /**
   * 获取当前视图中心
   * @returns 当前视图中心
   */
  getViewCenter(): Vector3 {
    return this.viewCenter.clone();
  }
  
  /**
   * 平移视图中心
   * @param delta - 平移向量
   */
  moveViewCenter(delta: Vector3): void {
    this.viewCenter.addBy(delta);
    // 视图中心平移后刷新距离缓存
    this.refreshCameraDistanceToViewCenter();
  }

  /**
   * Set options
   * @param opt - options
   */
  setOptions(opt?: EditorCameraControllerOptions) {
    Object.assign(this.options, opt ?? {});
    this.reset();
  }
}
