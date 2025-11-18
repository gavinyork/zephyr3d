# 材质系统  

## 材质蓝图基础

材质蓝图采用节点式编辑模式。  
每个节点代表一种数学运算、常量或纹理采样，将输出连接至材质通道（BaseColor、Roughness 等）。

主要节点类型：
- Constant 数值；
- Texture 采样；
- Math 运算 (Add / Multiply)；
- Output 终点。

*示意图：材质蓝图编辑器界面*
