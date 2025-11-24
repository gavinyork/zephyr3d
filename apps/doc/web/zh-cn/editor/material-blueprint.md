# 材质系统  

## 材质蓝图基础

材质蓝图采用节点式编辑模式。  
每个节点代表一种数学运算、常量或纹理采样，将输出连接至材质通道（BaseColor、Roughness 等）。

主要节点类型：
- Constant 数值；
- Texture 采样；
- Math 运算 (Add / Multiply)；
- Output 终点。

<video src="https://cdn.zephyr3d.org/doc/assets/videos/material-blueprint.mp4" controls width="640">
  您的浏览器不支持 video 标签。
</video>

