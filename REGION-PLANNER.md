# 区域规划 MCP

在游戏里右键圈定区域，在当前 Codex 聊天里读取地图、地形和局部方块。小克无需在线。本功能只读取世界，不向游戏提交建造、挖掘或移动命令。

## 游戏内操作

```text
/region select
```

右键两个对角的方块。第一个角选中后会提示；第二个角选中后显示长宽和面积，普通右键恢复。粒子边界只发给选区玩家。选点期间拦截主副手方块交互、物品使用和实体交互，避免开箱、放置方块或触发坐下。

```text
/region save home buffer 32
```

保存生活区 `home`，并授权读取边界外 32 格。新选区省略 `buffer` 时为 32。两个角只取 X/Z；采集覆盖该维度完整建筑高度。所有坐标边界均包含端点。包含周边的范围最多 512 x 512 格，周边可设 0 到 128 格。

### 微调选区

水面或难以到达的位置，可以先在岸边选两个角，再调整边界：

```text
/region expand east 12
/region shrink south 4
/region size 80 60
```

- `expand` 将指定方向的边界向外推，`shrink` 将该边界向内收，其他三条边保持原位。
- 方向使用 `north/south/east/west`，支持 Tab 补全；分别对应 -Z、+Z、+X、-X。
- `size` 的第一个数字为东西宽度，第二个为南北长度，固定西北角，向东和向南确定尺寸。
- 每次调整显示新长宽、面积和坐标，粒子边界同步更新。长宽至少为 1 格。
- 调整只修改草稿，保存后 MCP 的读取范围才会更新；取消保留原登记。

修改已登记区域无需重新选点：

```text
/region edit home
/region expand east 12
/region save
```

`edit` 在当前维度载入自己的区域，管理员也可编辑其他人的登记。普通右键保持正常。`save` 可省略 ID，保留原登记类型、所有者和周边范围；也可用 `/region save home buffer 48` 明确调整周边。放弃用 `/region cancel`。编辑后保存会使旧快照失效，需要重新获取区域总览。

临时选区使用同一选点流程，然后执行：

```text
/region share hillside
```

临时分享的周边默认为 0，登记会保留到主动撤销。保存后选区状态清除；选错可以重新 `/region select`。下线也会清除未保存的选区。

```text
/region list
/region info home
/region buffer home 48
/region revoke hillside
/region delete home
/region cancel
```

ID 使用小写英文、数字、短横线或下划线，首字符为字母，最多 32 字符。子命令和已有 ID 支持 Tab 补全。普通玩家可创建区域，只能修改自己的登记；管理员可管理全部登记。所有登记区域都会共享给本机规划 MCP。删除或撤销只移除登记，不修改世界方块，也无法移除此前已进入聊天的资料。

登记保存在当前世界的 `region-planner/regions.json`，原子写入；正式服和测试服分别保存。修改范围会生成新 revision，让旧快照失效。

## 接入当前聊天

本机安装仓库依赖后，使用绝对路径配置独立 STDIO MCP：

```powershell
codex mcp add minecraft_regions --env REGION_SSH_HOST=root@your-server -- node C:\path\mc-bot-claude\scripts\region-mcp.mjs
```

服务端的 xiaoke-bridge 模组提供 `127.0.0.1:25620` 只读 HTTP 数据接口。MCP 经 SSH 调用服务器上的 curl，显式绕过 HTTP 代理，不开放公网监听端口。连接需要现有 SSH 认证和服务器上的 curl。`REGION_URL` 可设置不同的回环地址端口；服务端用 JVM 参数 `-Dregion.planner.port=25620` 修改端口。

新增 MCP 后，在客户端重新加载 MCP 连接；若当前聊天的工具列表未更新，重开客户端后继续。MCP 启动不依赖小克的身体进程。

配置中的 `tool_timeout_sec` 建议设为 240。当前聊天工具列表尚未更新时，也可通过短生命周期 MCP 客户端调用同一接口，无需重启聊天：

```powershell
$env:REGION_SSH_HOST='root@your-server'
node scripts/region-query.mjs list_regions
node scripts/region-query.mjs get_region_context '{"region":"home","refresh":true}'
```

客户端输出摘要，将图片写入 `logs/region-query` 并打印绝对路径供 agent 读取。可用第三个参数指定独立输出目录。

| 工具 | 用途 |
| --- | --- |
| `list_regions` | 列出生活区和临时分享选区，不采集方块 |
| `get_region_context(region, refresh)` | 读取生活区及授权周边，返回摘要、地表图和高度图 |
| `get_selection_context(selection, refresh)` | 读取 `/region share` 的选区 |
| `inspect_area(region, snapshot, area, mode, surface, y)` | 绑定快照查询局部摘要、地表、高度、水平切片或精确方块 |

在聊天里说“读取 home，帮我规划仓库选址”即可。工具结果直接包含 PNG 图片和 JSON 摘要。`inspect_area` 的 `area` 包含 `minX/maxX/minZ/maxZ`，可附 `minY/maxY`；`mode` 为 `summary/surface/height/slice/blocks`；切片必须指定 `y`。精确方块查询最多 32768 个方块，并受 48000 字符输出预算限制，超过时缩小查询范围。

## 数据含义

- 北为 -Z，东为 +X，地图上北下南；坐标标尺使用世界坐标。粉色框为登记核心区，其外为授权周边；灰色棋盘为未知区块。
- 地表图使用 Minecraft 方块地图色绘制，包含草、树冠和屋顶。高度值为最上层非空气方块的 Y，不代表可站立高度或可建设地面。
- `surface=solid` 跳过无碰撞方块和树干树叶，仍保留建筑结构；建筑用途需要人工说明。
- 精确查询保留方块命名空间和状态属性，例如楼梯朝向、台阶上下半、含水状态。按列返回 `[minY,maxY,paletteIndex]`，空气显式编码，未知列为 `null`。
- 当前版本不采集实体、箱内物品、告示牌文字或其他方块实体 NBT，不自动识别建筑名称或用途。
- 已加载区块在服务端主线程复制区段，再在工作线程分析；未加载区块通过游戏原生存储接口读取最后存档，使用原生区段解析器。采集不会加载实体、添加区块票据或生成新地形。
- 一次快照记录采集开始和结束时间，是逐区块采集。已加载区块反映各自复制时的状态，磁盘区块反映最后存档。讨论绑定同一快照，需要新数据时显式 `refresh=true`。
- 服务端保留最近四个快照，本机最多缓存两个。每次读取都会重新核对区域登记和 revision，包括缓存命中。撤销、改范围或服务端重启后，旧快照停止读取。
- 原始数据只在服务端和本机工具之间传递，模型默认只收到图片和摘要。所有采集结果按授权边界裁剪，不输出选区外方块。

## 验证与部署

```powershell
$env:XKB_JAVA='C:\path\jdk-25\bin\java.exe'
python server/xiaoke-bridge/build.py
npm test
```

构建产物为 `server/xiaoke-bridge/build/xiaoke-bridge-1.0.0.jar`。备份原 JAR 后先安装测试服验收，再安装正式服并重启。保留原来的 `config/xiaoke-bridge.json` 和世界目录。

真实联调脚本只能连接测试服，使用独立账号 `region_probe`，不运行小克模型：

```powershell
$env:REGION_TEST='1'
$env:REGION_SSH_HOST='root@your-server'
node scripts/probe-regions.mjs
```

脚本测试真实右键、粒子、箱子拦截、登记、MCP 图片、精确状态、越界拒绝、分享撤销、测试服重启和离线区块读取。测试临时方块和登记在结束时清理，结果在 `logs/probe-regions`。测试会重启测试服；结束后按项目约定归档日志，并执行 `mc-switch main`、`mc-active unit` 恢复确认。
