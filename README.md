# 楼阁

一个最简可用、但正在持续进化的在线 AI 角色对话网站。
站点名为“楼阁”，预定域名为 `https://aicafe.momentsofus.cn`，支持多用户注册登录、角色创建、会话聊天、MySQL 持久化、Redis 会话存储，以及树状分支对话。

## 当前能力

- 用户注册 / 登录 / 退出
- 角色创建 / 浏览
- 会话创建与历史消息持久化
- Redis Session
- 图形验证码 / 邮箱验证码 / 手机验证码
- 基础限流 / 安全头 / 压缩 / 访问日志
- 兼容 OpenAI Chat Completions 的 AI 接口接入
- 对话树：
  - 任意节点继续对话
  - 任意节点新建独立分支会话
  - AI 回复重新生成（同父节点候选）
  - AI 内容编辑为新分支变体
  - 输入优化、一键采用并发送
- Redis 消息树缓存

## 结构设计

### 对话树模型

`messages` 表不再只是线性日志，而是树：

- `parent_message_id`：父节点
- `branch_from_message_id`：来源节点
- `edited_from_message_id`：编辑源节点
- `prompt_kind`：normal / branch / regenerate / edit / optimized
- `metadata_json`：扩展调试与来源信息

### 性能策略

- 会话消息树优先从 Redis 读取
- 写消息后主动失效缓存
- 列表查询与消息树读取职责分离
- 路由层只做编排，结构逻辑下沉到 service

## 启动

1. 配置 `.env`
2. 初始化数据库：`npm run db:init`
3. 启动开发：`npm run dev`
4. 启动生产：`npm run start`

## 版本控制

项目已独立为 Git 仓库。

推荐流程：

```bash
git checkout -b feat/xxx
# 开发
git add .
git commit -m "feat: xxx"
```

已忽略：

- `node_modules/`
- `.env`
- `logs/`
- `*.log`

## 注释与调试约定

- 文件头必须说明职责
- 关键函数说明输入/输出/副作用
- DEBUG 信息优先写结构化日志，不直接暴露页面堆栈
- 页面只展示用户需要的状态，不暴露内部错误细节

## UI 方向

当前视觉方向参考 Claude / Anthropic 风格：

- 暖纸色背景
- 温暖中性色
- Serif 标题 + Sans UI
- ring shadow 替代厚重阴影
- 高圆角、编辑式留白、偏“阅读感”而非“控制台感”

## 说明

- 若未配置 AI 接口变量，聊天会返回 fallback 文本，便于流程联调。
- 默认监听 `0.0.0.0:3217`
- 对话树能力依赖最新数据库结构，部署前请执行一次 `npm run db:init`
