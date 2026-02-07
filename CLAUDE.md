# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

X2Obs 是一个 Chrome 浏览器扩展,用于将 Twitter/X 推文保存为 Markdown 格式。支持保存单条推文和推文串(Thread),可以选择本地下载或直接提交到 GitHub 仓库。

**核心功能:**
- 提取推文文本、图片、视频链接
- 支持长推文(Note Tweet)和文章(Article)格式
- 两种保存模式:本地下载 / GitHub 仓库
- 文件命名格式: `时间戳@作者.md`

## 架构设计

### 三层脚本架构

扩展使用三层脚本架构来处理 Twitter/X 的复杂 DOM 结构和 React 数据:

1. **background.js (Service Worker)**
   - 创建右键菜单
   - 协调数据流:接收 content script 提取的数据
   - 生成 Markdown 文件
   - 处理本地下载或 GitHub API 提交
   - 管理用户配置(chrome.storage.sync)

2. **content.js (Content Script)**
   - 监听来自 background 的消息
   - 从 DOM 提取推文基本信息(ID、作者、URL、Thread 结构)
   - 通过 inject.js 获取 React Fiber 树中的完整数据
   - 合并 DOM 和 React 数据,优先使用 React 数据
   - 显示 Toast 通知

3. **inject.js (Page Context Script)**
   - 注入到页面主世界,可访问 React Fiber 树
   - 通过 window.postMessage 与 content.js 通信
   - 从 React Fiber 树提取完整推文数据:
     - 长文完整内容(Article、Note Tweet)
     - 高清图片 URL
     - 视频直链(video_info.variants)
   - 处理 Article 的复杂数据结构(blocks、entityMap、media_entities)

### 数据流

```
用户右键点击 → background.js 注入 content.js
→ content.js 提取 DOM 基本信息
→ content.js 请求 inject.js 获取 React 数据
→ inject.js 遍历 Fiber 树返回完整数据
→ content.js 合并数据返回 background.js
→ background.js 生成 Markdown 并保存
```

### 关键技术点

**React Fiber 树访问 (inject.js:64-106)**
- 通过 `__reactFiber$` key 访问 DOM 元素的 Fiber 实例
- 遍历 `fiber.memoizedProps.tweet` 获取推文原始数据
- 支持 `tweet.legacy`、`tweet.note_tweet`、`tweet.article` 多种数据格式

**Article 数据解析 (inject.js:121-238)**
- Article 使用类似 Draft.js 的数据结构
- 包含 `blocks`(内容块) 和 `entityMap`(实体映射)
- 需要处理图片内嵌(`XIMGPH_` 占位符)和链接实体
- 媒体资源从多个来源收集(cover_media、media_entities)

**Thread 检测 (content.js:151-202)**
- 查找所有同一作者的推文
- 排除"发现更多"推荐区域(通过 h2 标题定位)
- 按时间排序保持 Thread 顺序

## 开发命令

**加载扩展:**
1. 打开 Chrome: `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」,选择项目文件夹

**重新加载扩展:**
- 在 `chrome://extensions/` 页面点击刷新按钮
- 或使用快捷键: Ctrl+R (在扩展卡片上)

**调试:**
- background.js: 在扩展详情页点击「Service Worker」查看控制台
- content.js/inject.js: 在 Twitter/X 页面按 F12,查看页面控制台
- 查看日志前缀区分来源:
  - `[X2MD Inject]` - inject.js
  - `X2MD content script` - content.js
  - `X2MD background` - background.js

## 文件说明

- **manifest.json**: 扩展清单,定义权限和脚本加载规则
- **popup.html/popup.js**: 设置弹窗界面
- **background.js**: 后台服务,主要逻辑控制器
- **content.js**: 内容脚本,DOM 操作和数据提取
- **inject.js**: 页面注入脚本,React 数据访问
- **tests/**: 测试文件和示例输出

## 关键注意事项

**修改数据提取逻辑时:**
- inject.js 的 React Fiber 树遍历非常脆弱,Twitter 更新可能破坏访问路径
- 始终保持降级机制: React 数据失败时回退到 DOM 提取
- Article 解析需处理多种图片插入方式(entityRanges、XIMGPH_ 占位符)
- 注意避免图片重复:已在正文内嵌的图片不应再出现在底部

**GitHub API:**
- 使用 PUT 方法创建/更新文件
- 内容必须 Base64 编码
- 更新已存在文件需要先获取 sha
- Token 需要 `repo` 权限

**时间处理:**
- 所有时间戳使用北京时间(UTC+8)
- 文件名格式: `yyyyMMddHHmmss@author.md`

## 常见问题

**长推文内容被截断:**
- 检查是否正确提取了 `note_tweet` 或 `article` 数据
- 验证 inject.js 的 Fiber 树遍历是否成功

**图片质量低:**
- 确保使用 `?format=jpg&name=large` 参数
- Article 应优先使用 `original_img_url`

**Thread 顺序错误:**
- 检查时间排序逻辑 (content.js:192)
- 验证是否正确过滤了推荐区域

**GitHub 提交失败:**
- 检查 Token 权限
- 确认仓库格式为 `owner/repo`
- 查看 response.status 获取具体错误码
