# Lyrics-bridge

EchoMusic 灵动岛歌词插件，将 EchoMusic 的歌词和播放状态通过 WebSocket 实时推送到外部歌词软件，并支持接收外部歌词软件的播放控制指令。

> 此插件不直接提供功能，仅作为桥接工具  
> 建议搭配 [EchoMusic-Lyrics-WinIsland](https://github.com/xiaotian2333/EchoMusic-Lyrics-WinIsland) 使用

## 功能

- **歌词推送**：将当前播放歌曲的歌词（含逐字时间轴、翻译、罗马音）推送到外部软件
- **播放状态同步**：实时推送曲目切换、播放/暂停、进度跳转（seek）等状态变更
- **播放控制**：接收外部软件发出的播放、暂停、切歌、跳转进度等指令
- **音量与模式同步**：双向同步音量、播放模式与收藏状态
- **封面推送**：自动获取并缓存歌曲封面图片，以 Base64 格式推送
- **高速进度同步**：可选的 `/seek` 独立连接高频进度推送（由服务端下发命令触发）
- **设置面板**：支持自定义服务端地址、自动重连、自动启动辅助进程
- **辅助进程管理**：自动启动/终止外部 bridge 服务端进程（Windows 平台）

## 通信协议

通过 WebSocket 与外部歌词软件通信，默认地址为 `ws://127.0.0.1:17195`。

详细接口说明请参考[接口文档](docs/接口文档.md)，高速进度同步协议见[高频进度同步协议](docs/高频进度同步协议.md)。

## 设置项

| 设置项 | 说明 |
|--------|------|
| 服务端地址 | WebSocket 服务地址，默认 `ws://127.0.0.1:17195`，可省略 `ws://` 前缀（保存时自动补全） |
| 自动重连 | 断开后自动重新连接 |
| 自动启动辅助进程 | EchoMusic 启动时自动运行 bridge 服务端（服务端已在运行时不重复拉起） |

## 开发

```bash
npm ci        # 安装依赖（esbuild）
npm test      # 运行单元测试（node:test）
npm run build # 构建产物到 dist/index.js
```

如需开发其他外部歌词软件的桥接工具，请参考[接口文档](docs/接口文档.md)。

## 目录结构

```text
Lyrics-bridge/
├── index.js              # 插件启动入口
├── manifest.json         # 插件清单
├── README.md             # 项目说明
├── docs/
│   ├── 接口文档.md       # WebSocket 通信协议说明
│   └── 高频进度同步协议.md # /seek 高频进度同步协议说明
├── scripts/
│   └── build.js          # esbuild 打包脚本
├── src/
│   ├── constants.js      # 常量
│   ├── utils.js          # 纯工具函数
│   ├── state.js          # 运行时状态工厂
│   ├── config.js         # 配置读写
│   ├── cover.js          # 封面缓存与下载
│   ├── lyrics.js         # 歌词数据构建
│   ├── track.js          # 曲目与播放查询
│   ├── musicdata.js      # MusicData 构建与发送
│   ├── favorite.js       # 收藏状态管理
│   ├── volume.js         # 音量状态管理
│   ├── playmode.js       # 播放模式状态管理
│   ├── websocket.js      # WebSocket 生命周期与消息分发
│   ├── snapshot.js       # 播放快照订阅与处理
│   └── settings.js       # 设置面板组件
└── tests/                # node:test 单元测试
```

## 许可

MIT
