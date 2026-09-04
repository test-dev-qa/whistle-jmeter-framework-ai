# Whistle 插件打包与安装指南

## 📋 概述

本项目是一个 **Whistle 插件**（`whistle.jmeter-exporter`），可以通过以下方式打包和安装：

1. **本地安装**（开发模式）
2. **NPM 包发布**（正式发布）
3. **私有 NPM 仓库**（企业内部）
4. **源码直接使用**（快速体验）

---

## 🚀 方式一：本地开发安装（推荐快速上手）

### 前置条件

- Node.js >= 18.0 （推荐 20+，SQLite 需要 22.5+）
- npm >= 9.0
- Whistle 已安装：`npm install -g whistle`

### 安装步骤

#### 1️⃣ 克隆项目

```bash
git clone <项目仓库地址>
cd whistle-jmeter-framework-ai
```

#### 2️⃣ 安装依赖

```bash
npm install
```

**依赖清单**：
```json
{
  "koa": "^2.14.2",           // Web 框架
  "koa-bodyparser": "^4.4.1", // 请求体解析
  "koa-router": "^12.0.0",    // 路由管理
  "xmlbuilder2": "^3.1.1"     // XML 生成（JMX）
}
```

#### 3️⃣ 链接到 Whistle

在项目根目录执行：

```bash
npm link
```

**原理**：
- 在全局 `node_modules` 中创建符号链接指向本项目
- Whistle 启动时会自动扫描全局 `node_modules` 中名称以 `whistle.` 开头的包

#### 4️⃣ 启动 Whistle

```bash
w2 start
# 或者
whistle start
```

#### 5️⃣ 访问插件

在浏览器中打开：
```
http://127.0.0.1:8899
```

左侧菜单栏会看到 **「jmeter-exporter」** 选项，点击进入插件界面。

### 验证安装

```bash
# 查看已安装的 Whistle 插件
w2 listplugin

# 输出示例：
# whistle.jmeter-exporter (local)  ✓
```

---

## 📦 方式二：NPM 包发布（正式发布）

### 前置条件

- NPM 账户：https://www.npmjs.com/signup
- 已在本地登录：`npm login`

### 发布步骤

#### 1️⃣ 检查 package.json

```json
{
  "name": "whistle.jmeter-exporter",
  "version": "1.0.0",
  "description": "A whistle plugin to capture traffic and generate JMeter scripts",
  "main": "index.js",
  "license": "ISC",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-username/whistle-jmeter-framework-ai.git"
  },
  "bugs": {
    "url": "https://github.com/your-username/whistle-jmeter-framework-ai/issues"
  },
  "homepage": "https://github.com/your-username/whistle-jmeter-framework-ai#readme"
}
```

**关键字段**：
- `name`：**必须**以 `whistle.` 开头（Whistle 插件约定）
- `version`：语义版本号（1.0.0）
- `main`：入口文件
- `repository`：Git 仓库地址
- `license`：开源协议（ISC/MIT/Apache-2.0 等）

#### 2️⃣ 更新版本号

```bash
# 修补版本 (1.0.0 → 1.0.1)
npm version patch

# 小版本 (1.0.0 → 1.1.0)
npm version minor

# 大版本 (1.0.0 → 2.0.0)
npm version major
```

#### 3️⃣ 创建 .npmignore

在项目根目录创建 `.npmignore` 文件，排除不需要发布的文件：

```
.git/
.gitee/
.gitignore
node_modules/
scripts/
data/
.vscode/
*.log
.DS_Store
RESSTATSSERVER_DETAILED.md
CODE_LOGIC.md
example/
test/
```

#### 4️⃣ 发布到 NPM

```bash
npm publish

# 输出示例：
# npm notice
# npm notice 📦  whistle.jmeter-exporter@1.0.0
# npm notice === Tarball Contents ===
# npm notice 123B   package.json
# npm notice 3.5kB  index.js
# npm notice 2.2kB  resStatsServer.js
# npm notice 12.3kB lib/
# ...
# npm notice === Tarball Details ===
# npm notice name:          whistle.jmeter-exporter
# npm notice version:        1.0.0
# npm notice filename:       whistle.jmeter-exporter-1.0.0.tgz
# npm notice published-at:   2026-08-31T10:20:00.000Z
# npm notice public
# npm notice access:         public
# npm notice ✓
```

#### 5️⃣ 验证发布

在 NPM 官网查看：
```
https://www.npmjs.com/package/whistle.jmeter-exporter
```

### 用户安装（来自 NPM）

用户可以直接安装：

```bash
w2 install whistle.jmeter-exporter
# 或
npm install -g whistle.jmeter-exporter
```

---

## 🏢 方式三：私有 NPM 仓库（企业内部）

### 使用 npm registry

#### 1️⃣ 配置私有仓库地址

```bash
# 临时切换到私有仓库
npm publish --registry https://your-private-registry.com

# 或永久配置
npm config set registry https://your-private-registry.com

# 查看当前配置
npm config get registry
```

#### 2️⃣ 企业用户安装

```bash
# 从私有仓库安装
npm install -g whistle.jmeter-exporter --registry https://your-private-registry.com

# 或使用 Whistle 命令
w2 install whistle.jmeter-exporter
```

### 使用 Nexus/Artifactory

以 Nexus 为例：

```bash
# 1. 在 .npmrc 中配置
echo "@mycompany:registry=https://nexus.mycompany.com/repository/npm/" >> ~/.npmrc

# 2. 发布包
npm publish --registry https://nexus.mycompany.com/repository/npm/

# 3. 用户安装
npm install -g whistle.jmeter-exporter
```

---

## 📥 方式四：用户安装

### 从 NPM 官方源安装

```bash
# 安装到全局
w2 install whistle.jmeter-exporter

# 或
npm install -g whistle.jmeter-exporter
```

### 从本地路径安装

```bash
# 指定本地项目路径
npm install -g /path/to/whistle-jmeter-framework-ai

# 或使用相对路径
npm install -g ../whistle-jmeter-framework-ai
```

### 从 Git 仓库安装

```bash
# 直接从 GitHub 安装
npm install -g github:your-username/whistle-jmeter-framework-ai

# 或指定特定分支
npm install -g github:your-username/whistle-jmeter-framework-ai#main

# 或指定特定版本标签
npm install -g github:your-username/whistle-jmeter-framework-ai#v1.0.0
```

### 验证安装

```bash
# 列出已安装的 Whistle 插件
w2 listplugin

# 输出示例：
# whistle.jmeter-exporter (v1.0.0)  ✓  
```

### 使用插件

1. 启动 Whistle：`w2 start`
2. 打开 http://127.0.0.1:8899
3. 左侧菜单栏选择 **「jmeter-exporter」**
4. 开始捕获流量

---

## 🗂️ 打包与发布工作流

### 完整发布流程

```bash
# 1. 开发完成，提交代码
git add .
git commit -m "feat: 新增功能描述"
git push origin main

# 2. 本地验证
npm link
w2 start
# ... 在 http://127.0.0.1:8899 测试插件

# 3. 更新版本
npm version minor  # 或 patch/major
# 会自动更新 package.json 中的版本号
# 并创建 Git tag

# 4. 推送版本 tag
git push origin --tags

# 5. 发布到 NPM
npm publish

# 6. 验证
npm view whistle.jmeter-exporter
```

### 更新插件

用户更新已安装的插件：

```bash
# 更新到最新版本
npm update -g whistle.jmeter-exporter

# 或指定版本
npm install -g whistle.jmeter-exporter@1.1.0

# 重启 Whistle 生效
w2 restart
```

---

## 🔧 项目结构（打包视角）

打包时会包含以下文件：

```
whistle.jmeter-exporter/
├── package.json           ✓ 包配置（必需）
├── index.js              ✓ 入口文件（必需）
├── resStatsServer.js     ✓ 核心逻辑
├── lib/
│   ├── dataStore.js       ✓ SQLite / MySQL / JSON 存储
│   ├── jmxGenerator.js    ✓ JMeter JMX 生成
│   ├── k6Generator.js     ✓ k6 脚本生成
│   ├── postmanGenerator.js✓ Postman 集合生成
│   ├── stress*.js         ✓ 压测、报告与通知
│   └── ...                ✓ 配置、关联、后置操作与工具模块
├── ui/
│   ├── app.js             ✓ Koa API / 页面服务
│   ├── index.html         ✓ 页面骨架
│   └── *-ui.js            ✓ 原生 JavaScript 功能模块
├── LICENSE               ✓ 许可证
└── README.md             ✓ 文档
```

项目使用 Node.js `>=22.5.0` 和 CommonJS，不包含独立的前端构建产物；UI 脚本由 Koa 直接提供。`test/`、`scripts/`、`docs/` 和 `data/` 属于开发、运维、文档及运行时目录，不作为 npm 包的核心运行入口；其中 `data/` 也不会进入发布包。

**不会包含**（.npmignore）：
```
.git/
.gitee/
node_modules/
data/
scripts/
RESSTATSSERVER_DETAILED.md
CODE_LOGIC.md
```

---

## ⚙️ Whistle 插件加载机制

### 插件发现

Whistle 启动时会：

1. 扫描全局 `node_modules` 目录
2. 查找名称以 `whistle.` 开头的包
3. 加载包的 `index.js` 中导出的函数

### 插件入口（index.js）

```javascript
// index.js
module.exports = require('./ui/app');

// 配置请求统计服务
module.exports.resStatsServer = require('./resStatsServer');
```

**两个导出**：
- **默认导出**：`ui/app.js` - Web 服务（提供 UI 和 API）
- **resStatsServer 导出**：`resStatsServer.js` - 流量捕获服务

### 插件的双重身份

```
HTTP 请求到达
  ↓
┌─────────────────────────────────────┐
│ Whistle 代理                        │
├─────────────────────────────────────┤
│                                     │
│ 1. resStatsServer (捕获)            │
│    └─ 拦截请求/响应，存储数据      │
│                                     │
│ 2. ui/app (Web Service)             │
│    ├─ 提供前端 HTML 界面            │
│    ├─ 提供 REST API                 │
│    └─ 处理导出请求                  │
│                                     │
└─────────────────────────────────────┘
```

---

## 📊 版本管理

### 语义版本号（Semantic Versioning）

格式：`MAJOR.MINOR.PATCH`

| 版本 | 升级原因 | 示例 |
|------|---------|------|
| MAJOR | 不兼容的 API 改变 | 1.0.0 → 2.0.0 |
| MINOR | 向下兼容的新功能 | 1.0.0 → 1.1.0 |
| PATCH | 向下兼容的 bug 修复 | 1.0.0 → 1.0.1 |

### NPM 版本号依赖

在 `package.json` 的 `dependencies` 中：

```json
{
  "dependencies": {
    "koa": "^2.14.2"          // ^: 兼容 2.x 版本
    "koa-bodyparser": "~4.4.1" // ~: 兼容 4.4.x 版本
    "koa-router": "12.0.0"     // 精确版本
  }
}
```

---

## 🐛 故障排查

### 插件安装后不显示

**问题**：访问 Whistle 后台没看到插件

**排查步骤**：

```bash
# 1. 检查是否安装
w2 listplugin

# 2. 检查全局 node_modules 中是否有插件
npm list -g whistle.jmeter-exporter

# 3. 检查插件入口
ls -la $(npm root -g)/whistle.jmeter-exporter/

# 4. 重新安装/链接
npm link

# 5. 重启 Whistle
w2 stop
w2 start
```

### 插件启动出错

**问题**：Whistle 启动时报错

**排查步骤**：

```bash
# 1. 检查依赖是否安装
cd $(npm root -g)/whistle.jmeter-exporter
npm ls

# 2. 检查 Node.js 版本（需要 >= 18）
node --version

# 3. 查看错误日志
cat ~/.whistlerc/log/latest

# 4. 重装依赖
cd /path/to/whistle-jmeter-framework-ai
rm -rf node_modules package-lock.json
npm install
npm link
```

### 大文件上传失败

**问题**：multipart 文件无法正确处理

**原因**：可能超过 MAX_MULTIPART_BYTES 限制

**解决方案**：

```bash
# 在 lib/multipart.js 中调整
const MAX_MULTIPART_BYTES = 500 * 1024 * 1024; // 500MB
```

---

## 🔒 安全考虑

### 发布前检查清单

- [ ] 敏感信息已移除（密钥、token、密码）
- [ ] `.npmignore` 已配置，敏感目录已排除
- [ ] `data/` 目录已加入 `.gitignore`
- [ ] 依赖版本已锁定（使用 `package-lock.json`）
- [ ] README 已更新
- [ ] LICENSE 已选择
- [ ] package.json 中的作者和仓库地址正确

### 推荐安全实践

```json
{
  "name": "whistle.jmeter-exporter",
  "version": "1.0.0",
  "private": false,
  "license": "MIT",
  "engines": {
    "node": ">=18.0.0"
  },
  "author": "Your Name <your.email@example.com>",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-username/repo.git"
  },
  "bugs": {
    "url": "https://github.com/your-username/repo/issues"
  }
}
```

---

## 📈 常见场景

### 场景 1：快速本地开发

```bash
# 1. 克隆项目
git clone <repo>
cd whistle-jmeter-framework-ai

# 2. 安装 + 链接
npm install
npm link

# 3. 启动使用
w2 start

# 4. 开发中修改代码，无需重启即生效（热加载）
```

### 场景 2：发布到 NPM

```bash
# 1. 更新版本
npm version minor

# 2. 发布
npm publish

# 3. 用户安装
npm install -g whistle.jmeter-exporter@latest
```

### 场景 3：企业内部分发

```bash
# 1. 上传到私有仓库
npm publish --registry https://my-nexus.com/repository/npm

# 2. 用户从私有仓库安装
npm install -g whistle.jmeter-exporter \
  --registry https://my-nexus.com/repository/npm
```

### 场景 4：开发包更新

```bash
# 1. 修改代码
vim lib/captureConfig.js

# 2. 测试（npm link 后自动生效）
w2 restart

# 3. 测试通过，提交 & 版本更新 & 发布
git commit -am "fix: xxx"
npm version patch
npm publish
```

---

## 📚 参考资源

### Whistle 官方文档
- 官网：https://wproxy.org/whistle/
- 插件开发：https://wproxy.org/whistle/plugins.html

### NPM 文档
- 发布指南：https://docs.npmjs.com/creating-and-publishing-scoped-public-packages
- 版本管理：https://docs.npmjs.com/about-semantic-versioning

### Node.js 版本要求
- Node.js 18+（基础支持）
- Node.js 22.5+（SQLite 原生支持，推荐）

---

## ✅ 检查清单

**发布前验证**：

- [ ] `npm test` 通过
- [ ] `npm link` 成功
- [ ] Whistle 中能看到插件
- [ ] 核心功能（捕获、导出）正常
- [ ] .npmignore 已配置
- [ ] package.json 信息完整
- [ ] README.md 已更新
- [ ] CHANGELOG.md 已更新（可选）
- [ ] 版本号已更新
- [ ] Git tags 已创建

**发布后验证**：

- [ ] NPM 官网能查到包
- [ ] `npm info whistle.jmeter-exporter` 返回正确信息
- [ ] `npm install -g whistle.jmeter-exporter` 成功
- [ ] 插件能正常加载和运行

---

**最后更新**：2026-08-31
