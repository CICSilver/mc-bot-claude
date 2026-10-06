# CPM 早期草稿：未采用、未部署

本目录保留设计改向前的主要源码、素材和构建产物。用户希望使用原版像素皮肤风格，并减少多边形装饰，因此这份草稿不继续作为制作方向。当前设计见 [../../DESIGN.md](../../DESIGN.md)。

## 保留内容

- `build-avatar.mjs`：创建 CPM 项目的脚本，包含 578 个元素节点。
- `editor-tool.mjs`：当时用于操作 CPM 网页编辑器的临时 Playwright 辅助脚本。
- `build-client.ps1`、`src/`、`resources/`：尚未部署的客户端绑定模组和本地打包/测试源码。
- `package.json`、`package-lock.json`：当时的 Node 工具依赖声明。
- `assets/xiaoke-face.png`：根据第一张参考图生成的高清脸部贴图，1254 x 1254；这是未采用的贴图，不是 Minecraft 标准皮肤。
- `artifacts/xiaoke-maid.cpmproject`：可编辑 CPM 项目。
- `artifacts/xiaoke-maid.cpmmodel`：通过 CPM 原生序列化工具打包的本地模型。
- `artifacts/xiaoke-avatar-0.1.0.jar`：尚未部署的客户端绑定模组草稿。
- `artifacts/xiaoke-native-package.b64`：从 CPM 编辑器导出的模型数据，保留供复现打包，不依赖公开托管。
- `artifacts/model-stats.json`：节点、贴图和绑定目标统计。
- `artifacts/editor-preview.png`：改向前在 CPM 网页编辑器中的实际截图。

## 验证范围

已做过：

1. CPM 网页编辑器加载项目并显示模型。
2. 使用 JDK 25 编译客户端绑定源码。
3. 11 项目标服务器、玩家名和 UUID 匹配检查。
4. CPM 原生模型数据校验和检查，以及 `ModelFile` 读写回环检查。

未做过：

- 没有完成 Minecraft 游戏内外观、动画与长期运行验收。
- 没有将此 JAR 安装到 `E:\26.1`。
- 没有修改服务器、重启服务器或改动 Claude 机器人逻辑。
- 没有把模型上传到 Gist、CPM 粘贴站等公开托管服务。

因此编译通过不代表这份草稿已经可以作为经过验收的交付使用。

## 工具快照

- 游戏目标：Minecraft Java 26.1。
- CPM 下载版本：`CustomPlayerModels-Fabric-26.1-0.6.27b.jar`。
- Fabric API：`0.155.3+26.1.2`，下载元数据列出了 26.1 兼容性。
- Fabric Loader 编译依赖：`0.19.5`。
- JDK：Temurin `25.0.4.1+1`。
- 下载和依赖目录：`E:\MinecraftTools\xiaoke`。
- 原始草稿目录：`E:\MinecraftTools\xiaoke\work\avatar`。

这里的脚本是当时的工作快照，尚未改造成可移植产品。`build-client.ps1` 引用本机 E 盘工具链和游戏文件；`editor-tool.mjs` 的默认 CDP 地址只适用于当时的临时浏览器，当前浏览器已经关闭。归档过程不自动执行这些脚本。

如以后专门研究这份草稿，需先 `npm ci` 准备工具，重新配置本地路径和浏览器连接；打包脚本需要把归档的 `xiaoke-native-package.b64` 放入 `build/`。当前像素皮肤方案不需要这些步骤。

## 上游资料

- [Customizable Player Models 源码与文档](https://github.com/tom5454/CustomPlayerModels)
- [CPM 网页编辑器](https://tom5454.com/cpm/editor.html)
- [CPM 导出说明](https://github.com/tom5454/CustomPlayerModels/wiki/Exporting)
- [Fabric 26.1 开发说明](https://www.fabricmc.net/2026/03/14/261.html)

第三方上游源码、JDK、依赖缓存和第三方模组文件没有复制到本目录。
