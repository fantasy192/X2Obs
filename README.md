# X2Obs

一键保存 Twitter/X 推文到本地 Markdown 文件或 GitHub 仓库。

## 功能特性

- 支持保存单条推文和推文串（Thread）
- 两种保存模式：本地下载 / GitHub 仓库
- 自动提取推文文本、图片、视频链接
- 支持长推文（Note Tweet）和文章（Article）
- 文件命名格式：`时间戳@作者.md`（如 `20260201153045@elonmusk.md`）

## 安装

1. 下载本仓库代码
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择项目文件夹

## 使用方法

### 基本使用

1. 在 Twitter/X 页面上找到想要保存的推文
2. 右键点击推文区域
3. 选择「保存推文到 Markdown」

### 配置保存方式

点击扩展图标，可以选择：

**本地下载模式：**
- 设置保存路径（相对于浏览器下载目录的子文件夹）
- 留空则保存到下载目录根目录

**GitHub 模式：**
- Personal Access Token：在 [GitHub Settings](https://github.com/settings/tokens/new?scopes=repo) 创建，需要 `repo` 权限
- 仓库：格式为 `owner/repo`
- 保存路径：仓库内的子文件夹（可选）
- 分支：默认 `main`

## 生成的 Markdown 格式

```markdown
# Tweet by @username

## Info

- **Author:** [@username](https://x.com/username)
- **Date:** 2026-02-01 15:30:45
- **URL:** https://x.com/username/status/123456789

## Content

推文内容...

![Image](https://pbs.twimg.com/media/xxx.jpg)
```

## 权限说明

- `contextMenus`: 创建右键菜单
- `activeTab`: 访问当前标签页
- `downloads`: 下载文件到本地
- `scripting`: 在页面中执行脚本提取推文数据
- `storage`: 保存用户配置
- `host_permissions`: 访问 Twitter/X 和 GitHub API

---

## Privacy Policy

**Last Updated:** February 1, 2026

### 1. Introduction

X2MD is committed to protecting your privacy. This Privacy Policy explains how our Chrome extension collects, uses, and safeguards your information.

### 2. Information We Collect and Use

- **Twitter/X Content:** We access the content of tweets you select (text, images, videos) solely for converting them into Markdown format upon your request.
- **Configuration Data:** We store your preferences (save mode, paths, GitHub token) using `chrome.storage.sync`. GitHub tokens are stored locally and only sent to the official GitHub API.
- **Browsing Data:** We do not track your browsing history.

### 3. Data Transmission

- **Local Mode:** All data is processed locally. No data is sent to external servers.
- **GitHub Mode:** Tweet content is sent to GitHub API (`api.github.com`) to create files in your repository. Your GitHub token is only used for authentication with GitHub.

### 4. Data Security

We do not sell, trade, or transfer your information to outside parties. Your GitHub token is stored securely in Chrome's sync storage and is never exposed to third parties.

### 5. Contact

If you have questions about this Privacy Policy, please open an issue in this repository.
