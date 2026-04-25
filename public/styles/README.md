# site-pages.css 样式拆分说明

`public/styles/site-pages.css` 之前是一整个超长文件，已经按功能拆成模块，但**页面引用入口不变**：

```html
<link rel="stylesheet" href="/public/styles/site-pages.css" />
```

也就是说：
- 模板层不用改引用
- 仍然只维护一个总入口文件
- 具体样式按功能落在 `public/styles/site-pages/` 目录里

## 目录结构

```text
public/styles/
├── site-pages.css              # 总入口，只保留 @import
├── shared-feedback.css         # 登录/错误/消息反馈页的独立样式
└── site-pages/
    ├── 00-core.css             # 变量、基础元素、导航、通用卡片、按钮、全局响应式
    ├── 10-home.css             # 首页
    ├── 20-admin.css            # 管理后台（总览 / providers / plans / prompts）
    ├── 30-character-editor.css # 创建/编辑角色页
    ├── 40-dashboard.css        # 控制台
    ├── 50-chat.css             # 聊天页基础布局与消息区
    ├── 60-auth.css             # 认证相关通用样式（历史遗留 auth 区）
    ├── 70-shared-utilities.css # 少量跨页面工具类
    ├── 80-chat-polish.css      # 聊天页动效与视觉增强
    └── 90-profile.css          # 个人资料页
```

## 维护约定

### 1) 新增样式放哪里

优先按**页面/功能**放：
- 首页相关 → `10-home.css`
- 管理后台相关 → `20-admin.css`
- 聊天基础结构 → `50-chat.css`
- 聊天视觉增强/流式状态/动效 → `80-chat-polish.css`
- 资料页相关 → `90-profile.css`

### 2) 什么情况下放到 core

只有这些东西才建议放 `00-core.css`：
- 设计变量（`--brand` / `--surface` 这类）
- 全局元素重置（`body` / `a` / `input` / `button`）
- 明显跨多个页面复用的基础块（如 `.container`、`.nav`、`.card`）

### 3) 什么情况下放到 shared-utilities

`70-shared-utilities.css` 只放**非常少量**、明确跨页面复用，但又不值得塞进 core 的工具类。
如果某个类已经演变成一组完整组件，就别继续塞工具文件，应该回到对应功能文件。

### 4) 关于顺序

`site-pages.css` 里的 `@import` 顺序就是最终层叠顺序：
- `00-core.css` 最先
- 页面模块其后
- `80-chat-polish.css` 这种增强层放在聊天基础之后
- `90-profile.css` 目前放最后，方便覆盖同名通用块

如果以后出现覆盖异常，先检查 import 顺序，不要急着堆选择器权重。

## 当前拆分原则

这次拆分是**结构重组**，不是视觉重构：
- 不主动改类名
- 不改模板引用路径
- 不大面积改选择器语义
- 先保证行为和样式尽量一致，再提高可维护性

## 后续建议

后面如果还要继续收拾，可以按这两个方向往下做：

1. **把 admin 再细拆**
   - `20-admin.css` 现在还比较大
   - 可以继续拆成 `admin-base / admin-providers / admin-plans / admin-prompts`

2. **把真正未使用的历史样式清掉**
   - 目前保守处理，优先保证不炸
   - 下一轮可以结合模板和 JS 做一次 unused selector 清理

## 注意

浏览器支持 `@import` 没问题，但如果后面要追求极致加载性能，可以再考虑：
- 构建阶段合并
- 或者按页面拆成多入口

当前这版的目标不是极限优化，而是：**先把 2000+ 行单文件拆到人还能维护的程度。**
