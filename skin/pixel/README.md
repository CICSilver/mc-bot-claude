# 小克原版像素皮肤预览

当前为待确认制作稿，未部署。皮肤是标准 64 x 64 RGBA PNG，模型必须选择 **Alex / slim**。

- `xiaoke-skin.png`：实际皮肤，无额外模型几何。
- `preview/xiaoke-preview.png`：六视角、透明 UV 展开图和小尺寸检查。
- `preview/xiaoke-preview-walk.png`：行走、转头抬臂、关闭第二层对照。
- `preview/xiaoke-preview-route-b.png`：同贴图、同相机的 A / B 对照。
- `preview/checks.json`：实际皮肤哈希、模型类型、几何数量、姿势、画布边界检查。

路线 B 只在渲染场景中添加 6 个耳部方块和 4 个尾巴方块。它需要相应模组及观看端支持，具体安装与同步方案尚未选择；本目录没有可部署的模组模型文件。

## 重新生成

在仓库根目录执行：

```powershell
python -B skin/pixel/build_skin.py
node skin/pixel/render_preview.mjs
```

`build_skin.py` 顶部集中定义调色板，使用逐像素图案生成 PNG；同时检查基础层不透明、第二层二值透明、标准 UV 范围、细手臂闲置区域。

`render_preview.mjs` 使用 skinview3d 的标准 SkinObject、Three.js 和 Playwright 启动本机无头 Edge，监听随机本地端口，渲染结束关闭浏览器与服务器。`compose_preview.py` 使用 Pillow 和微软雅黑合成中文图版。中间截图放在系统临时目录，正常或异常退出时清理本次目录。

本次使用 Python 3.14、Pillow、Node 24、skinview3d 3.4.2。依赖全部位于仓库外：

| 环境变量 | 默认值 |
| --- | --- |
| `PIXEL_NODE_MODULES` | `E:/MinecraftTools/xiaoke/work/pixel-preview/node_modules` |
| `PLAYWRIGHT_NODE_MODULES` | `E:/MinecraftTools/xiaoke/work/avatar/node_modules` |
| `PIXEL_BROWSER` | `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` |
| `PIXEL_FONT` | `C:/Windows/Fonts/msyh.ttc` |
| `PYTHON` | `python` |

外部依赖安装命令：

```powershell
npm install --prefix E:/MinecraftTools/xiaoke/work/pixel-preview --cache E:/MinecraftTools/xiaoke/npm-cache skinview3d@3.4.2
```

## 已知取舍

纯原版猫耳与尾巴只有贴图暗示。后发在躯干上分束缩短，给腰结和尾纹留出空间；没有把尾纹跨到腿上。围裙徽章为 5 x 4 像素，因此近看较醒目，远看只作为橙色点缀。短裙随两腿分开，转头时头发也会出现原版模型关节断点。

渲染检查不能替代游戏内验收。尚未验证皮肤绑定、装备遮挡、实际游戏光照或多人显示；未修改游戏与服务器。
