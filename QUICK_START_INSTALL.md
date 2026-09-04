# 快速安装指南

> 这是 Whistle 插件打包和安装的 **快速参考卡片**，适合快速上手

---

## 🚀 5 分钟快速开始

### 前置条件

```bash
# 检查 Node.js 版本（需要 >= 18）
node --version

# 安装 Whistle 全局包
npm install -g whistle
```

### 方式 A：本地开发（推荐）

```bash
# 1. 进入项目目录
cd whistle-jmeter-framework-ai

# 2. 安装依赖
npm install

# 3. 链接到 Whistle
npm link

# 4. 启动 Whistle
w2 start

# 5. 打开浏览器
http://127.0.0.1:8899

# 6. 左侧菜单栏找到「jmeter-exporter」
```

### 方式 B：从 NPM 官方源安装（已发布）

```bash
# 一行命令安装
npm install -g whistle.jmeter-exporter

# 启动 Whistle
w2 start
```

### 方式 C：从本地路径安装

```bash
# 指定本地项目路径
npm install -g /path/to/whistle-jmeter-framework-ai

# 或相对路径
npm install -g ../whistle-jmeter-framework-ai
```

---

## 📦 发布到 NPM（第一次）

```bash
# 1. 确保已登录 NPM
npm login

# 2. 发布到 NPM 官方源
npm publish

# 用户就可以安装了
npm install -g whistle.jmeter-exporter
```

---

## 🔄 更新插件版本

```bash
# 1. 修改代码
vim lib/captureConfig.js

# 2. 本地测试（如果使用了 npm link，会自动生效）
w2 restart

# 3. 更新版本号
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0

# 4. 发布新版本
npm publish

# 5. 用户更新
npm update -g whistle.jmeter-exporter
```

---

## ✅ 验证安装

```bash
# 查看已安装的 Whistle 插件
w2 listplugin

# 输出应包含
# whistle.jmeter-exporter (v1.0.0)  ✓

# 查看插件信息
npm info whistle.jmeter-exporter
```

---

## 🐛 常见问题

### 问题 1：插件在 Whistle 中不显示

```bash
# 重新链接
npm link

# 重启 Whistle
w2 stop
w2 start
```

### 问题 2：找不到依赖

```bash
# 重装依赖
rm -rf node_modules package-lock.json
npm install
npm link
```

### 问题 3：Node.js 版本太低

```bash
# 检查版本（需要 >= 18）
node --version

# 升级 Node.js（使用 nvm）
nvm install 20
nvm use 20
```

---

## 📚 关键命令对照表

| 任务 | 命令 |
|------|------|
| 本地开发安装 | `npm link` |
| 发布到 NPM | `npm publish` |
| 更新补丁版本 | `npm version patch` |
| 更新小版本 | `npm version minor` |
| 列出插件 | `w2 listplugin` |
| 启动 Whistle | `w2 start` |
| 停止 Whistle | `w2 stop` |
| 重启 Whistle | `w2 restart` |
| 查看插件信息 | `npm info whistle.jmeter-exporter` |
| 安装特定版本 | `npm install -g whistle.jmeter-exporter@1.0.0` |
| 卸载插件 | `npm uninstall -g whistle.jmeter-exporter` |

---

## 🎯 三种安装方式对比

| 方式 | 命令 | 场景 | 速度 | 易用 |
|------|------|------|------|------|
| **本地链接** | `npm link` | 开发测试 | 🚀 最快 | ✅ 最简 |
| **NPM 官方** | `npm install -g whistle.jmeter-exporter` | 用户安装 | 🐢 需下载 | ✅ 最简 |
| **本地路径** | `npm install -g /path/to/project` | 内部分发 | 🚀 最快 | ✅ 简单 |

---

## 📊 package.json 关键字段

```json
{
  "name": "whistle.jmeter-exporter",      // 必须以 whistle. 开头
  "version": "1.0.0",                    // 遵循语义版本（SemVer）
  "main": "index.js",                    // 入口文件
  "description": "JMeter 脚本导出工具",
  "license": "ISC",                      // 开源协议
  "repository": {                        // Git 仓库
    "type": "git",
    "url": "https://github.com/xxx/xxx"
  }
}
```

---

## 🔗 完整文档位置

详细说明请查看：
- [PACKAGE_AND_INSTALL.md](PACKAGE_AND_INSTALL.md) - 完整打包和安装指南

---

**适用于**：whistle.jmeter-exporter v1.0.0+

**最后更新**：2026-08-31
