# 小克皮肤

本目录保存小克（游戏玩家名 `clawd`）的皮肤设计、参考图片，以及已经停止使用的早期草稿。

## 当前方向

保持 Minecraft 原版方块人的轮廓，以简洁像素画表现奶白长发、粉色眼睛、深灰紫女仆装、白围裙和粉色蝴蝶结。面部可以简单，不添加大量多边形装饰。

当前阶段是**先设计、后确认，再制作皮肤**。目前没有完成并确认的原版皮肤 PNG，也没有把本目录的草稿部署到客户端或服务器。

用户最后给出的风格要求：

> 面部可以稍微简单一点，先设计一下怎么做吧，类似这种的，不要加太多的多边形装饰。

完整方案见 [DESIGN.md](DESIGN.md)。纯原版皮肤与极简耳朵/尾巴扩展的取舍仍待确认，不把建议视为已批准的最终方案。

## 内容

| 路径 | 内容 |
|---|---|
| [DESIGN.md](DESIGN.md) | 最新像素皮肤方案、制作顺序和验收要求 |
| [references/xiaoke-turnaround.png](references/xiaoke-turnaround.png) | 用户提供的小克角色设定图 |
| [references/minecraft-pixel-style.png](references/minecraft-pixel-style.png) | 用户提供的 Minecraft 像素皮肤风格参考 |
| [archive/cpm-prototype/](archive/cpm-prototype/) | 未采用的 CPM 立体模型草稿、源码、生成素材和构建产物 |
| [asset-manifest.json](asset-manifest.json) | 归档文件大小和 SHA-256 校验清单 |

## 与机器人的关系

- Claude 接入、机器人行为和启动方式继续使用仓库现有实现，本次只归档皮肤相关内容。
- 本机游戏目录为 `E:\26.1`，查验时其 `26.1` 客户端仍为原版。
- 服务器查验时已有 Fabric 和 `skinrestorer`；最终 PNG 确认后再检查绑定流程。
- 立体模型草稿的客户端绑定代码仅供归档，当前方案不默认使用它。

## 未收入仓库

JDK、`node_modules`、浏览器临时数据、依赖缓存、第三方模组 JAR、Minecraft 游戏文件和 CPM 上游源码未收入仓库。已经下载的工具仍在 `E:\MinecraftTools\xiaoke`，没有移动或删除原始工作目录。

两张用户参考图仅作为角色设定和风格参考；它们不是可直接导入游戏的皮肤展开图。
