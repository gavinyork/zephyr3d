import { Vector3, Quaternion, Matrix3x3, Matrix4x4, ASSERT } from '@zephyr3d/base';
import type {
  IControllerPointerDownEvent,
  IControllerPointerMoveEvent,
  IControllerPointerUpEvent,
  IControllerWheelEvent,
  IControllerKeydownEvent, // 键盘按下事件
  IControllerKeyupEvent // 键盘抬起事件
} from '@zephyr3d/scene';
import { BaseCameraController } from '@zephyr3d/scene';

export interface EditorCameraControllerOptions {
  /** 平移速度 */
  moveSpeed?: number;
  /** 缩放速度 */
  zoomSpeed?: number;
  /** 旋转速度 */
  rotateSpeed?: number;
  /** 正交缩放速度 */
  scaleSpeed?: number;
  /** 缩放阻尼 */
  zoomDamping?: number;
  /** 右键按住时 WSADQE 移动速度倍率 */
  rightClickMoveSpeed?: number;
}

export class EditorCameraController extends BaseCameraController {
  /** @internal */
  private readonly options: EditorCameraControllerOptions;
  /** @internal */
  private altLeftMouseDown: boolean; // Alt+左键是否按下（绕视图中心旋转）
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
  private viewCenter: Vector3; // 当前视图中心（轨道旋转中心）
  public cameraDistanceToViewCenter: number; // 相机到视图中心的缓存距离
  /** @internal */
  private pressedKeys: Set<string>; // 当前按下的移动按键集合（W/S/A/D/Q/E）
  /**
   * 是否正在按住右键
   * @returns 右键按下返回 true
   */
  isRightMouseDown(): boolean {
    return this.rightMouseDown;
  }
  /**
   * 获取当前“视图中心”初始值（默认取相机前方 10 个单位）
   * @returns 视图中心世界坐标
   */
  getCameraTargetPos(): Vector3 {
    // 尝试从当前相机推导默认视图中心
    try {
      const camera = this._getCamera();
      if (camera) {
        // 使用相机世界矩阵第 2 行作为相机后向，取反得到前向
        const forward = camera.worldMatrix.getRow(2).xyz().inplaceNormalize();
        // 分解得到相机世界位置
        const cameraPos = new Vector3();
        const cameraScale = new Vector3();
        const cameraRotation = new Quaternion();
        camera.worldMatrix.decompose(cameraScale, cameraRotation, cameraPos);
        // 默认目标点：相机位置沿前向 10 个单位
        const targetPos = Vector3.add(cameraPos, forward.scaleBy(-10));
        return targetPos;
      } else {
        // 相机尚不可用时回退到原点
        return new Vector3(0, 0, 0);
      }
    } catch (error) {
      // 控制器初始化早期可能取不到相机，异常时回退到原点
      console.warn('Failed to get camera for initial view center, setting to origin.', error);
      return new Vector3(0, 0, 0);
    }
  }

  /**
   * 创建编辑器相机控制器
   * @param options - 初始化参数
   */
  constructor(options?: EditorCameraControllerOptions) {
    super();
    this.options = {
      moveSpeed: 0.1,
      zoomSpeed: 5,
      rotateSpeed: 0.01,
      scaleSpeed: 0.01,
      zoomDamping: 10,
      rightClickMoveSpeed: 2, // 右键按住时的 WSADQE 速度倍率
      ...options
    };
    this.viewCenter = this.getCameraTargetPos(); // 初始化视图中心
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
    this.pressedKeys.clear(); // 清空按键状态
    this.viewCenter = this.getCameraTargetPos(); // 重置视图中心
    // 重置后同步刷新距离缓存
    this.refreshCameraDistanceToViewCenter();
  }

  /**
   * {@inheritDoc BaseCameraController._onMouseDown}
   * @override
   */
  protected _onMouseDown(evt: IControllerPointerDownEvent): boolean {
    // 支持 Alt+左键 / 中键 / 右键三种模式
    if (evt.button === 0 && evt.altKey) {
      this.altLeftMouseDown = true;
    } else if (evt.button === 1) {
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
    // 对应释放 Alt+左键 / 中键 / 右键状态
    if (evt.button === 0 && this.altLeftMouseDown) {
      this.altLeftMouseDown = false;
      return true;
    } else if (evt.button === 1 && this.middleMouseDown) {
      this.middleMouseDown = false;
      return true;
    } else if (evt.button === 2 && this.rightMouseDown) {
      this.rightMouseDown = false;
      if (!evt.altKey) {
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
    // Alt+左键：绕固定视图中心做轨道旋转
    if (this.altLeftMouseDown && evt.altKey && this._getCamera().isPerspective()) {
      const dx = evt.offsetX - this.lastMouseX;
      const dy = evt.offsetY - this.lastMouseY;
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;

      const camera = this._getCamera();

      // 1) 获取当前相机世界位置
      const cameraWorldPos = new Vector3();
      const cameraRotation = new Quaternion();
      const cameraScale = new Vector3();
      camera.worldMatrix.decompose(cameraScale, cameraRotation, cameraWorldPos);

      // 2) 计算相机到视图中心向量和缓存距离
      const cameraToViewCenter = Vector3.sub(this.viewCenter, cameraWorldPos);
      const distance = this.cameraDistanceToViewCenter;

      if (distance < 1e-6) {
        // 避免距离过小导致计算不稳定
        console.warn('Camera is too close to the view center. Falling back to default rotation.');
        return this._performDefaultRotation(dx, dy);
      }

      // 3) 归一化方向向量
      const direction = cameraToViewCenter.inplaceNormalize();

      // 4) 计算当前球坐标角
      const currentTheta = Math.atan2(direction.z, direction.x);
      const currentPhi = Math.asin(direction.y);

      // 根据鼠标位移更新角度
      const newTheta = currentTheta + dx * this.options.rotateSpeed;
      const newPhi = Math.min(
        Math.PI / 2.1,
        Math.max(-Math.PI / 2.1, currentPhi - dy * this.options.rotateSpeed)
      );

      // 5) 由新角度反算方向向量
      const cosPhi = Math.cos(newPhi);
      const newDirection = new Vector3(
        cosPhi * Math.cos(newTheta),
        Math.sin(newPhi),
        cosPhi * Math.sin(newTheta)
      ).inplaceNormalize();

      // 6) 由方向和半径反算新相机位置
      const newCameraWorldPos = Vector3.sub(this.viewCenter, newDirection.scaleBy(distance));

      // 7) 计算相机朝向（始终看向视图中心）
      const lookAtRotation = new Quaternion();
      const forward = Vector3.sub(this.viewCenter, newCameraWorldPos).inplaceNormalize();
      const back = forward.scaleBy(-1);
      const right = Vector3.cross(Vector3.axisPY(), forward).inplaceNormalize();
      const up = Vector3.cross(forward, right).inplaceNormalize();

      const rotationMatrix = new Matrix3x3([
        right.x,
        right.y,
        right.z,
        up.x,
        up.y,
        up.z,
        back.x,
        back.y,
        back.z
      ]);

      lookAtRotation.set(Quaternion.fromRotationMatrix(rotationMatrix));

      // 8) 写回相机变换（兼容有父节点和无父节点两种情况）
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
      // 绕固定中心旋转时半径不变，直接复用当前 distance
      this.cameraDistanceToViewCenter = distance;
      return true;
    }

    // 右键拖拽：沿相机自身坐标系做自由旋转
    if (!evt.altKey && this.rightMouseDown && this._getCamera().isPerspective()) {
      const dx = evt.offsetX - this.lastMouseX;
      const dy = evt.offsetY - this.lastMouseY;
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      return this._performDefaultRotation(dx, dy);
    }

    // Alt 模式：右键缩放/推进，中键平移
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
      } else if (this.middleMouseDown) {
        const x = this._getCamera()
          .worldMatrix.getRow(0)
          .xyz()
          .mulBy(new Vector3(1, 0, 1))
          .inplaceNormalize();
        const y = Vector3.cross(z, x);
        if (this._getCamera().isPerspective()) {
          // 透视相机平移速度随距离缩放，距离越远移动越快
          const panSpeedScale = Math.max(0.01, this.cameraDistanceToViewCenter * 0.02);
          moveX *= panSpeedScale;
          moveY *= panSpeedScale;
          const move = Vector3.combine(x, y, moveX, moveY);
          this._moveCamera(move, false);

          // 相机与视图中心同步平移，保持相对关系
          this.moveViewCenter(move);
        } else {
          const viewport = this._getCamera().viewport;
          const projMatrix = this._getCamera().getProjectionMatrix();
          const width = projMatrix.getRightPlane() - projMatrix.getLeftPlane();
          const height = projMatrix.getTopPlane() - projMatrix.getBottomPlane();
          const deltaX = (-dx * width) / viewport[2];
          const deltaY = (dy * height) / viewport[3];
          const move = Vector3.combine(x, y, deltaX, deltaY);
          this._moveCamera(move, false);

          // 正交相机同样同步平移视图中心
          this.moveViewCenter(move);
        }
      }
      return true;
    }
    return false;
  }

  /**
   * 计算“相机到视图中心”的实时距离（内部方法）
   */
  private calcCameraDistanceToViewCenter(): number {
    const camera = this._getCamera();
    if (!camera) {
      // 初始化阶段可能还没有相机，返回 0 避免异常
      return 0;
    }
    const cameraPos = new Vector3();
    const cameraScale = new Vector3();
    camera.worldMatrix.decompose(cameraScale, null, cameraPos);
    const delta = Vector3.sub(this.viewCenter, cameraPos);
    return Math.sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z);
  }

  /**
   * 刷新距离缓存，避免在多处重复计算
   */
  private refreshCameraDistanceToViewCenter(): void {
    // 统一更新缓存入口
    this.cameraDistanceToViewCenter = this.calcCameraDistanceToViewCenter();
  }

  /**
   * 处理键盘按下事件
   * @override
   */
  protected _onKeyDown(evt: IControllerKeydownEvent): boolean {
    // 只处理用于移动的按键
    if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE'].includes(evt.code)) {
      this.pressedKeys.add(evt.code);
      return true;
    }
    return false;
  }

  /**
   * 处理键盘抬起事件
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
   * 每帧更新：右键按住时处理 WSADQE 连续移动
   * @override
   */
  update(): void {
    super.update();

    // 仅在透视相机且右键按住时启用飞行移动
    if (this.rightMouseDown && this.pressedKeys.size > 0 && this._getCamera().isPerspective()) {
      this._handleWASDQEMovement();
    }
  }

  /**
   * 处理 WSADQE 移动逻辑（飞行模式）
   */
  private _handleWASDQEMovement(): void {
    if (this.pressedKeys.size === 0) {
      return;
    }

    const camera = this._getCamera();
    const moveSpeed = this.options.moveSpeed * (this.options.rightClickMoveSpeed || 3);
    const moveVector = new Vector3(0, 0, 0);

    // 相机局部坐标轴：前/右/上
    const forward = camera.worldMatrix.getRow(2).xyz().inplaceNormalize().scaleBy(-1); // 前向
    const right = camera.worldMatrix.getRow(0).xyz().inplaceNormalize(); // 右向
    const up = camera.worldMatrix.getRow(1).xyz().inplaceNormalize(); // 上向

    // 累积每个按键贡献的移动向量
    for (const key of this.pressedKeys) {
      switch (key) {
        case 'KeyW': // 前进
          moveVector.addBy(forward.scaleBy(moveSpeed));
          break;
        case 'KeyS': // 后退
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
      moveVector.x * moveVector.x + moveVector.y * moveVector.y + moveVector.z * moveVector.z
    );
    if (moveLength > 0.0001) {
      this._moveCamera(moveVector, false);
      // 统一通过方法更新视图中心，自动维护距离缓存
      this.moveViewCenter(moveVector);
    }
  }

  /**
   * 默认旋转：绕相机自身旋转（非绕中心轨道）
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

    // 根据正交基重建旋转四元数
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

  private _moveCamera(move: Vector3, refreshDistance = true) {
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
    // 相机位置变化后刷新距离缓存（可按需关闭，避免重复刷新）
    if (refreshDistance) {
      this.refreshCameraDistanceToViewCenter();
    }
  }

  /**
   * 设置视图中心
   * @param center - 新的视图中心（世界坐标）
   */
  setViewCenter(center: Vector3): void {
    this.viewCenter.set(center);
    // 视图中心变化后刷新距离缓存
    this.refreshCameraDistanceToViewCenter();
  }

  /**
   * 获取当前视图中心
   * @returns 视图中心（拷贝）
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
   * 公开方法：立即同步“相机到视图中心”距离缓存
   */
  syncCameraDistanceToViewCenter(): void {
    this.refreshCameraDistanceToViewCenter();
  }

  /**
   * 更新控制器参数并重置状态
   * @param opt - 新参数
   */
  setOptions(opt?: EditorCameraControllerOptions) {
    Object.assign(this.options, opt ?? {});
    this.reset();
  }
}
