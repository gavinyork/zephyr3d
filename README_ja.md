<!-- hy-mt2-i18n:start -->
[English](./README.md) | [中文](./README_zh-CN.md) | **日本語** | [Español](./README_es.md)
<!-- hy-mt2-i18n:end -->



<div align="center">

  ![](https://cdn.zephyr3d.org/doc/assets/images/logo_theme.svg)

> モダンなTypeScriptベースのWebGLおよびWebGPUレンダリングエンジン

[ユーザーマニュアル](https://zephyr3d.org/doc/) &nbsp;|&nbsp; [デモ](https://zephyr3d.org/en/demos.html) &nbsp;|&nbsp; [オンラインエディタ](https://zephyr3d.org/editor/)

[![CI](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml/badge.svg)](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zephyr3d/scene?color=%235865f2)](https://www.npmjs.com/package/@zephyr3d/scene)
[![License: MIT](https://img.shields.io/badge/license-MIT-blueviolet.svg)](https://opensource.org/licenses/MIT)

</div>

## 概要

**Zephyr3D**は、TypeScriptをベースにしたウェブ向け3Dレンダリングエンジンであり、以下の機能を備えています。

 - WebGL/WebGPUを統一したバックエンド
 - コード生成によるシェーダーシステム（JS/TS → GLSL/WGSL）
 - 完全なウェブベースのビジュアルエディター  

> 軽量性・モジュール性・開発者に優しいインターフェース・コードによる視覚的クリエイションの実現。

## 概要

**Zephyr3D**は、TypeScriptをベースにしたウェブ向け3Dレンダリングエンジンであり、

 - ユニファイドなWebGL/WebGPUバックエンド  
- コード生成によるシェーダーシステム（JS/TS → GLSL/WGSL）  
- そして完全なウェブベースのビジュアルエディター

軽量・モジュール型・開発者に優しい・コードによって強化された視覚的クリエイション。

# 主な機能

- **統一された WebGL / WebGPU バックエンド（RHI）**  
  1つのレンダリング抽象化レイヤーで複数のバックエンドをサポート。Sceneコードを書き直すことなくWebGL、WebGL2、WebGPUの間を切り替えられます。

## コア機能

- **統一されたWebGL/WebGPUバックエンド（RHI）**  
  1つのレンダリング抽象化レイヤーで複数のバックエンドをサポート。シーンコードを書き直すことなく、WebGL、WebGL2、WebGPUの間を切り替えられます。

- **JS/TSベースのシェーダービルダー**  
  TypeScript/JavaScriptでシェーダーを作成し、単一のソースから各バックエンド向けのGLSL/WGSLコードやWebGPUのバインドグループレイアウトを自動生成します。

- **最新のシーンレンダリング機能**  
  PBR、画像ベースのライティング、クラスターライティング、シャドウマップ、テライン、FFTを利用した水面表現、ポストプロセッシングなどが搭載されています。

- **TypeScriptを最優先とするアーキテクチャ**  
  強力な型付け、モジュラー型のパッケージ、そしてエンジンやツール開発に適したIDE向けAPIを備えています。

- **ウェブベースのビジュアルエディタ**  
  シーン編集、マテリアル編集、地形編集、そしてTypeScriptスクリプト機能——すべてブラウザ内で直接動作します。

- **NPM対応のモジュラー型パッケージ**  
  必要な部分だけを利用できます。基本数学関数、デバイス/RHI、バックエンド、シーンレイヤー、または完全なエディターまで。

## JS/TSベースのシェーダービルダー

手動で原始的なGLSL/WGSLの文字列を記述する代わりに、Zephyr3DではJavaScript/TypeScriptでシェーダーを**定義**でき、バックエンドごとに最適化されたコードを自動生成してくれます。

1つのJSプログラム：

```ts  
const program = device.buildRenderProgram({  
  vertex(pb) {  
    this.$inputs.pos = pb.vec3().attrib('position');  
    this.$inputs.uv  = pb.vec2().attrib('texCoord0');  
    this.$outputs.uv = pb.vec2();  

    this.xform = pb.defineStruct([pb.mat4('mvpMatrix')])().uniform(0);  

    pb.main(function () {  
      this.$builtins.position =  
        pb.mul(this.xform.mvpMatrix, pb.vec4(this.$inputs.pos, 1));  
      this.$outputs.uv = this.$inputs.uv;  
    });  
  },  

  fragment(pb) {  
    this.$outputs.color = pb.vec4();  
    this.tex = pb.tex2D().uniform(0);  

    pb.main(function () {  
      this.$outputs.color = pb.textureSample(this.tex, this.$inputs.uv);  
    });  
  }  
});  
```

この単一のソースから、Zephyr3Dは以下を生成します：

- WebGL 1 GLSL（属性/変数、従来型ユニフォーム）
- WebGL 2 GLSL（layout(std140)を持つUBO、明示的な出力）
- WebGPU WGSLシェーダー
- 対応するWebGPUバインドグループのレイアウト（テクスチャ、サンプラー、計算されたレイアウトを持つユニフォームバッファ）

つまり、あなたは：

- JS/TSでシェーダーロジックを1回だけ記述
- 各バックエンドに最適なGLSL/WGSLを自動的に生成
- バインディングとシェーダーコードを自動的に同期
- 少しずつ異なるN種類のシェーダーバリアントを管理する手間を省く

より高度な例については、[ユーザーマニュアル](https://zephyr3d.org/doc/)をご覧ください。

---

## Zephyr3D Editor — *ウェブベースのビジュアルツール*

<div align="center">

**オンラインで試す → [Zephyr3D Editor](https://zephyr3d.org/editor/)**  
*インストール不要 — ブラウザ内だけで完全に動作します*

<br/>

<img src="https://cdn.zephyr3d.org/doc/assets/images/editor-sm.jpg" width="80%" alt="Zephyr3D Web Editor">

</div>

## 主な特長
- シーン、マテリアル、テレインエディタ  
- TypeScriptスクリプト機能およびアニメーションツール  
- Zephyr3DのScene APIおよびDevice APIを使用して構築  
- 即時プレビューとワンクリックエクスポート

## Zephyr3D Editor デスクトップ版

デスクトップエディタは、ローカルプロジェクトや永続的なストレージをサポートするElectronビルドとして提供されています。また、MCPおよび組み込みのLLMアシスタントを通じてAIサポートも備えており、APIキーはローカルに保存される際に暗号化処理が施されます。

最新のデスクトップ版をダウンロードするには：[GitHub Releases](https://github.com/gavinyork/zephyr3d/releases)

# アーキテクチャ概要

## アーキテクチャ概要

| レイヤー | 説明 |
|-------|--------------|
| **Base** | Math / VFS / Events / SmartPtr |
| **Device (RHI)** | 抽象的なグラフィックスAPIレイヤー + シェーダービルダー / リソースバインディング |
| **Backend-WebGL / WebGPU** | プラットフォーム固有のレンダリングバックエンド |
| **Scene** | シーンシステム、マテリアル、アニメーション、ポストエフェクト |
| **Editor** | Sceneレイヤーを基盤としたブラウザネイティブのエディタ |

# 厳格な制約
1. **構造の維持**：元の Markdown のデータ構造、インデント、見出し階層、表、リンク、URL、バッジ、コードブロック、インラインコードを一切変更しないこと。
2. **選択的翻訳**：ユーザーに表示される可視的な自然言語コンテンツのみを翻訳すること。
3. **変更禁止**：コードタグ、キー名、変数プレースホルダー（{{var}}、${var}、%s、%d など）、コマンド例、ファイルパス、プロジェクト名、API名、パッケージ名、モデル名、識別子、コード記号を翻訳または変更することは**厳禁**である。背景情報に対応する訳名が既に記載されている場合を除く。
4. 用語、スタイル、専有名詞の翻訳は、提供された背景情報と一致させること。

## インストール

```bash
npm install --save @zephyr3d/device
npm install --save @zephyr3d/backend-webgl
npm install --save @zephyr3d/backend-webgpu
npm install --save @zephyr3d/scene
```

お好みのバンドラー（Vite / Webpack / Rollup）を使用してください。

---

## 深度規約（Reverse-Z）

このエンジンは2つの深度表現規約をサポートしており、起動時に1回だけ選択されます：

- **Standard-Z**：近傍面でのデバイス深度は0、遠方面での深度は1です。  
- **Reverse-Z**（デフォルト）：近傍面でのデバイス深度は1、遠方面での深度は0です。浮動小数点型の深度バッファ（`d32f` / `d32fs8`、WebGPUおよびWebGL2のデフォルト）を使用する場合、ほぼ均一な深度誤差分布が得られ、遠方にあるオブジェクト間のz-fightingが大幅に軽減されます。

ビルド時に `define` を設定して逆Zを有効にし、バンドラーが未使用のコードを削除できるようにします：
path:

```js
// vite.config.js / esbuild
define: { __ZEPHYR3D_REVERSE_Z__: 'true' }

// rollup (@rollup/plugin-replace)
replace({ preventAssignment: true, values: { __ZEPHYR3D_REVERSE_Z__: 'true' } })
```

バンドラーを使用しない場合は、任意の`@zephyr3d/*`モジュールを最初にインポートする**前**に、グローバル変数を設定してください：

```html
<script>globalThis.__ZEPHYR3D_REVERSE_Z__ = true;</script>
<script type="module" src="app.js"></script>
```

この規約はページの寿命にわたって変更されません。バックエンドに関するメモ：

- **WebGPU**：追加の要件なく、最大限の効果が得られます。  
- **WebGL/WebGL2**：利用可能な場合（Chromium 121以降）、エンジンは`EXT_clip_control`を有効にします。これがない場合でもシェーダー側のフォールバックにより正しくレンダリングは続きますが、精度面での利点は限定的です。WebGL1には浮動小数点型の深度フォーマットがないため、逆Z軸処理は機能的にはサポートされていますが精度向上の効果はありません。  
- カスタムマテリアルでは、深度値や比較方向を硬直的にコードに記述する代わりに、`@zephyr3d/base`からエクスポートされる定数（`REVERSE_Z`、`DEPTH_CLEAR_VALUE`、`DEPTH_COMPARE_DEFAULT`、`DEPTH_FARTHEST`など）および`ShaderHelper`の深度関連ユーティリティを使用すべきです。  
- 既知の制限事項：逆Z軸処理では斜めクリッピング投影（平面の水面反射で使用される`Matrix4x4.obliqueProjection/obliquePerspective`）はまだサポートされておらず、明示的なエラーが発生します。

---

## 例：Scene API

```ts
import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene, Application, LambertMaterial, Mesh,
  OrbitCameraController, PerspectiveCamera,
  SphereShape, DirectionalLight
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const app = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

app.ready().then(() => {
  const scene = new Scene();
  new DirectionalLight(scene).lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());
  const mat = new LambertMaterial();
  mat.albedoColor = new Vector4(0.9, 0.1, 0.1, 1);
  new Mesh(scene, new SphereShape(), mat);
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  scene.mainCamera.lookAt(new Vector3(0,0,4), Vector3.zero(), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center: Vector3.zero() });
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);
  getEngine().setRenderable(scene, 0);
  app.run();
});
```

---

## ステータス

現在も積極的に開発が進められています。

Zephyr3Dは私自身の実験、デモ、ツールとして使用されており、現在も積極的に開発が進められています。
APIは今後変更される可能性がありますが、すでに以下の用途に適しています：

- グラフィックス／ウェブレンダリングに関する実験  
- エンジンおよびレンダリングアーキテクチャの研究  
- カスタムツールや社内専用エディタの開発

# 严格约束
1. **结构锁定**：绝对保持原有的 Markdown 数据结构、缩进、标题层级、表格、链接、URL、徽章、代码块和行内代码完全不变。
2. **选择性翻译**：仅翻译面向用户展示的可见自然语言内容。
3. **禁止修改**：**严禁**翻译或更改代码标签、键名、变量占位符（如 {{var}}、${var}、%s、%d 等）、命令示例、文件路径、项目名、API 名、包名、模型名、标识符和代码符号；除非背景信息中已经给出对应译名。
4. 术语、风格、专有名词的译法要与所给背景信息保持一致。

【待翻译片段】
---

## サポートのお願い

Zephyr3Dは私の自由時間を使って開発・維持されています。
このエンジンやエディタ、その他関連するツールや記事がお役に立った場合は、こちらから私の活動を応援していただけます：

Ko‑fi: https://ko-fi.com/gavinyork2024

皆様のご支援により、ホスティングやテストツールの費用が賄え、さらに以下の作業に専念できる時間も増えます：

- 新しいエンジン機能の開発とパフォーマンスの向上  
- ドキュメントやサンプルコードの維持管理  
- 実験的なレンダリング手法やツールの探求

いかなる形でのご支援も心より感謝いたします。Zephyr3Dを試してフィードバックをいただくだけでも、大変ありがたく思います。

---

## ライセンス

Zephyr3Dは[MIT License](https://opensource.org/licenses/MIT)のもとでリリースされています。

---

<div align="center">

**© 2025 Zephyr3D — Web3Dの世界のためにTypeScriptで💙を使って構築されました。**

</div>
