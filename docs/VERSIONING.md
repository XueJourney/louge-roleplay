# 版本管理规范

楼阁使用 Git + SemVer 做版本管理。目标是：每次线上状态都有清晰来源、可回退、可说明。

## 版本号

版本号采用：`MAJOR.MINOR.PATCH`。

- `PATCH`：修 bug、文案、小兼容改动，例如 `1.0.1`
- `MINOR`：新增兼容功能，例如 `1.1.0`
- `MAJOR`：破坏性改动、数据库不可逆迁移、重大架构调整，例如 `2.0.0`

当前版本来源：`package.json` 的 `version` 字段。

## 分支

- `master`：稳定主线，应该对应可部署状态。
- `feature/<name>`：新功能。
- `fix/<name>`：修复。
- `chore/<name>`：部署、文档、依赖、工程化。
- `release/<version>`：必要时用于发布前收口。

不要直接把未验证的大改动混进稳定主线。

## 标签

每个正式发布版本使用 Git tag：

```bash
git tag -a v1.0.0 -m "release: v1.0.0"
```

标签必须指向已经通过基础检查的提交。推送远端前先确认没有 `.env`、真实密钥、日志或本地数据库被提交。

## 推荐发布流程

1. 确认工作区状态：

   ```bash
   git status --short --branch
   ```

2. 按变更类型更新版本号：

   ```bash
   npm run version:bump:patch
   # 或 npm run version:bump:minor
   # 或 npm run version:bump:major
   ```

3. 更新 `CHANGELOG.md`，补充对应版本条目。

4. 运行基础检查：

   ```bash
   npm run version:check
   npm run health:check
   npm run test:think
   npm run test:prompt-route
   npm run admin-logs:test
   ```

   `npm run full-flow:test` 会真实调用外部 LLM Provider，适合发布前人工确认；模型不可用或响应慢时不作为唯一阻断项。

5. 提交：

   ```bash
   git add package.json package-lock.json CHANGELOG.md docs/VERSIONING.md scripts/version-check.js src/config.js src/routes/web-routes.js src/server.js
   git commit -m "chore(release): vX.Y.Z"
   ```

6. 打标签：

   ```bash
   git tag -a vX.Y.Z -m "release: vX.Y.Z"
   ```

7. 如需推送远端：

   ```bash
   git push origin <branch>
   git push origin vX.Y.Z
   ```

## 回退

优先回退到上一个稳定 tag：

```bash
git checkout vX.Y.Z
npm ci
npm run health:check
```

生产环境回退前要先备份数据库；涉及数据库迁移时，不要只回退代码。

## 检查点

- `.env` 不提交。
- `logs/` 不提交。
- `node_modules/` 不提交。
- `package.json` 与 `package-lock.json` 版本一致。
- `CHANGELOG.md` 必须有当前版本条目。
- 重要发布必须有 `vX.Y.Z` tag。
