# 本地更新与部署指南

面向本仓库 `whistle.jmeter-exporter` 的日常打包、安装与重启。

当前版本以 `package.json` 中的 `version` 为准（当前为 `1.1.22`）。

---

## 前置

- Node.js：**22.5+**（SQLite 落盘需要；更低版本会回退 JSON）
- 全局安装 Whistle：

```bash
npm install -g whistle
w2 start
```

依赖安装与自测：

```bash
npm install
npm test
```

MemoryBridge（用于交接卡、Wiki 或记忆锚点）：

```bash
python3 -m pip install --user --break-system-packages ./tools/memory-bridge

npm run setup:memory-bridge
npm run check:memory-bridge

# 如需初始化设备和跨设备同步，可执行：
python3 -m membridge init

# 如只使用本机交接卡，现在已经可以直接使用：
membridge add "goal: test

#  自检
membridge doctor
```

安装脚本会优先复用已有安装；默认从工作区同级的 `tools/memory-bridge` 安装。源码不在该位置时，会自动从官方 Git 仓库安装：

```bash
npm run setup:memory-bridge
```

如果使用本地源码：

```powershell
$env:MEMBRIDGE_SOURCE="D:\tools\memory-bridge"
npm run setup:memory-bridge
```

Linux/macOS：

```bash
export MEMBRIDGE_SOURCE=/home/test/dev-test/tools/memory-bridge
npm run setup:memory-bridge
```

内网或镜像仓库可覆盖默认地址：

```bash
export MEMBRIDGE_REPOSITORY="git+https://your-git.example/memory-bridge.git"
npm run setup:memory-bridge
```

MemoryBridge 也可直接从已检出的源码目录安装：

```powershell
py -m pip install --user D:\tools\memory-bridge
```

---

## 一键部署（推荐）

在仓库根目录执行：

```bash
npm run deploy
```

等价于：

```bash
node scripts/pack-install-restart.js
```

Windows：

```bat
scripts\pack-install-restart.cmd
```

PowerShell：

```powershell
.\scripts\pack-install-restart.ps1
```

macOS / Linux：

```bash
bash scripts/pack-install-restart.sh
```

脚本依次执行：

1. `npm pack` → 生成 `whistle.jmeter-exporter-<version>.tgz`
2. 清理仓库根目录下旧的同名插件 `.tgz`
3. `w2 install <tgz 绝对路径>`
4. `w2 restart`

完成后打开插件页并 **Ctrl+F5** 强制刷新。

插件页示例：

```text
http://127.0.0.1:8899/whistle.jmeter-exporter/
```

---

## 手动分步

```bash
npm install
npm test
npm pack
w2 install ./whistle.jmeter-exporter-<version>.tgz
w2 restart
```

将 `<version>` 换成 `package.json` 里的版本号。

不打包、直接从源码目录安装：

```bash
w2 install <本仓库绝对路径>
w2 restart
```

也可在 Whistle **Plugins → Install** 中选择本地目录或 `.tgz`。

---

## 只打包 / 清理产物

```bash
npm run pack
```

生成：`whistle.jmeter-exporter-<version>.tgz`

清理多余旧包（保留当前版本）：

```bash
npm run clean:pack
```

发给同事时：

```bash
npm pack
w2 install ./whistle.jmeter-exporter-<version>.tgz
w2 restart
```

---

## Whistle 常用命令

| 命令 | 作用 |
|------|------|
| `w2 start` | 启动 Whistle |
| `w2 restart` | 重启（改代码或重装插件后） |
| `w2 stop` | 停止 |
| `w2 install <路径或 tgz>` | 安装插件 |
| `w2 uninstall whistle.jmeter-exporter` | 卸载本插件 |

---

## npm scripts 一览

| 命令 | 作用 |
|------|------|
| `npm test` | 运行单元测试 |
| `npm run pack` | 仅打包，不安装 |
| `npm run clean:pack` | 清理多余 `.tgz` |
| `npm run deploy` | 打包 + 安装到本机 Whistle + 重启 |

---

## 数据目录

默认在插件安装目录下的 `data/`。

可用环境变量改到其他路径：

```bash
# Windows PowerShell 示例
$env:JMETER_EXPORTER_DATA_DIR="D:\wje-data"
```

```bash
# macOS / Linux 示例
export JMETER_EXPORTER_DATA_DIR=/var/lib/wje-data
```

注意：`w2 install` 重装插件时，若数据落在包内 `data/`，部分文件可能被覆盖；重要数据建议用 `JMETER_EXPORTER_DATA_DIR` 指到包外目录。

---

## 改代码后的推荐流程

1. 改代码 / 改 `package.json` 版本号（如需）
2. `npm test`
3. `npm run deploy`
4. 浏览器对插件页 **Ctrl+F5**

---

## 部署验证

```powershell
# 查看 Whistle 状态和访问地址
w2 status

# 查看已安装插件
w2 listplugin
```

确认插件页可正常打开，并使用 **Ctrl+F5** 强制刷新浏览器缓存：

```text
http://127.0.0.1:8899/whistle.jmeter-exporter/
```

若页面仍是旧版本，重新执行：

```powershell
w2 restart
```

## 回滚到上一版本

保留上一版本安装包时，重新安装该 `.tgz` 并重启：

```powershell
w2 install .\whistle.jmeter-exporter-<上一版本>.tgz
w2 restart
```

卸载插件：

```powershell
w2 uninstall whistle.jmeter-exporter
w2 restart
```
