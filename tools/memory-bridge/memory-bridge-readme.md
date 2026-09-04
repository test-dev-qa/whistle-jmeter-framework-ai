<!-- 已将 MemoryBridge 集成到项目初始化流程。 -->


#新增命令：MemoryBridge（用于交接卡、Wiki 或记忆锚点）：

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

#安装逻辑：
已安装时自动跳过
默认从同级目录 tools/memory-bridge 安装
可通过 MEMBRIDGE_SOURCE 指定源码目录
使用 Python 用户目录安装，不污染项目 npm 依赖
安装后自动验证 membridge 是否可用
示例：
$env:MEMBRIDGE_SOURCE="D:\tools\memory-bridge"
npm run setup:memory-bridge
npm run check:memory-bridge

# 相关文件：
setup-memory-bridge.js
package.json
DEPLOY.md
README.md