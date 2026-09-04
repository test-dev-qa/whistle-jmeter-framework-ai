# rules.txt 快速参考卡片

## 📌 当前配置

```
# 默认将匹配的请求交给插件 resStatsServer 统计
* whistle.jmeter-exporter://
```

**含义**：所有请求 → 都被捕获

---

## 🎯 常用模式速查

### 基础模式

```
# 捕获所有请求（默认）
* whistle.jmeter-exporter://

# 捕获特定域名
api.example.com whistle.jmeter-exporter://

# 仅捕获 HTTPS
https://api.example.com whistle.jmeter-exporter://

# 捕获特定路径
https://api.example.com/api/* whistle.jmeter-exporter://

# 排除某个域名（不处理）
*.cdn.example.com -

# 排除文件类型
/\.(js|css|png|jpg)$/i -
```

---

## 📊 多规则配置（推荐）

```
# 排除静态资源（前置）
/\.(js|css|jpg|jpeg|png|gif|svg|webp|ico)(\?.*)?$/i -
*.cdn.* -

# 捕获业务 API
https://api.example.com/api/* whistle.jmeter-exporter://
https://api.example.com/v1/* whistle.jmeter-exporter://

# 默认不处理其他
* -
```

---

## ⚡ 快速配置变更

### 1. 打开 rules 编辑界面

```
http://127.0.0.1:8899 → Rules
```

### 2. 编辑规则

```
粘贴上方配置 → 保存 → 自动生效
```

### 3. 或编辑文件后重启

```bash
# 编辑 rules.txt
vim rules.txt

# 重启 Whistle
w2 restart
```

---

## 🔍 规则优先级（重要）

Whistle 按**从上到下**的顺序匹配，**遇第一个匹配即停止**

```
❌ 错误顺序（下面的规则永不执行）
* whistle.jmeter-exporter://    # 已匹配所有
api.example.com -                # 无法执行

✅ 正确顺序（具体→宽泛）
api.example.com -                # 具体规则放前面
* whistle.jmeter-exporter://    # 通用规则放后面
```

---

## 🎓 理解规则格式

```
<Pattern>  <Target>
 ↑          ↑
 请求匹配   执行操作
```

### Pattern（请求匹配）

| 语法 | 示例 |
|------|------|
| `*` | 所有请求 |
| `*.example.com` | example.com 的任意子域名 |
| `api.example.com/api/*` | 该路径下所有请求 |
| `/regex/` | 正则表达式匹配 |
| `https://api.example.com` | 指定协议和域名 |

### Target（执行操作）

| 值 | 含义 |
|----|------|
| `whistle.jmeter-exporter://` | 交给本插件处理 |
| `-` | 不处理（透传）|
| `http://127.0.0.1:8080` | 转发到本地服务 |

---

## 💡 实际场景

### 场景 1：仅捕获 API 请求（推荐生产）

```
# 排除静态资源
/\.(js|css|png|jpg|gif|webp|ico)$/i -

# 捕获 API
https://api.example.com/* whistle.jmeter-exporter://

# 其他不处理
* -
```

### 场景 2：捕获所有用于测试（推荐开发）

```
* whistle.jmeter-exporter://
```

### 场景 3：按环境区分

```
# 测试环境
test-api.example.com whistle.jmeter-exporter://

# 生产环境（不捕获）
prod-api.example.com -

# 本地
localhost whistle.jmeter-exporter://
```

---

## ⚠️ 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 请求未被捕获 | 规则不匹配 | 检查 rules.txt 语法 |
| 改了 rules.txt 没生效 | 未重启 Whistle | `w2 restart` |
| 看不到请求 | 浏览器未配置代理 | 设置代理为 127.0.0.1:8888 |
| 数据库爆满 | 捕获了过多请求 | 添加排除规则 |

---

## 🔗 完整文档

详细说明：[RULES_CONFIG.md](RULES_CONFIG.md)

---

**快速命令**：

```bash
# 查看当前规则
cat rules.txt

# 编辑规则
vim rules.txt

# 重启 Whistle 生效
w2 restart

# 在 Web 控制台编辑
# http://127.0.0.1:8899 → Rules
```

---

**最后更新**：2026-08-31
