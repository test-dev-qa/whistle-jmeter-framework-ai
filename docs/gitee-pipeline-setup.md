# Gitee Go 流水线启用指南

仓库已包含流水线模板：`.gitee/pipelines/unit-test.yml`

## 1. 在 Gitee 后台启用

1. 打开 https://gitee.com/test-dev-qa/whistle-jmeter-framework-ai
2. 进入 **流水线** → **新建流水线**
3. 选择 **使用已有 YAML** 或 **从仓库导入**
4. 路径填写：`.gitee/pipelines/unit-test.yml`
5. 触发方式建议勾选：
   - **Push 到 master**
   - **Pull Request**（如有）
6. 保存并 **手动运行一次** 验证

## 2. 构建环境要求

- **Node.js ≥ 22.5**（项目依赖 `node:sqlite`）
- 若 Gitee 默认 Node 版本过低，在 YAML 中指定镜像或安装步骤

当前模板命令：

```yaml
script:
  - npm ci || npm install
  - npm run ci
```

`npm run ci` 等价于 `node test/run.js`（177+ 用例）。

## 3. 本地预检

```bash
npm run ci
node scripts/verify-ci-yml.js   # 校验 YAML 存在且含 npm run ci
```

## 4. 常见问题

| 现象 | 处理 |
|------|------|
| `node:sqlite` 报错 | 升级 Node 至 22.5+ |
| `npm ci` 失败 | 确保 `package-lock.json` 已提交；或仅用 `npm install` |
| 流水线找不到 YAML | 确认文件在默认分支且路径正确 |

## 5. 后续可扩展

- 增加 `npm run test:report` 产物归档
- 打 tag 时自动 `npm pack` 发布制品
