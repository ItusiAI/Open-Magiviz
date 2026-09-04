## 赞助商 | Sponsor

| **MiniMax H3 视频生成 API｜秘塔科技**<br><br>秘塔科技提供高性价比的 MiniMax H3 视频生成服务：**768P 仅 0.09 元/秒，2K 仅 0.15 元/秒**。支持原生 2K、音画同步，API 兼容 **OpenAI 协议**，同时支持 **ComfyUI**，无需自行部署 GPU。<br><br>通过 [Magiviz专属链接注册](https://metaso.cn/minimax-h3/?s=Magiviz)，即可领取赠送额度及专属优惠。 | [<img src="public/images/meta.jpg" alt="秘塔科技 - MiniMax H3" width="280"/>](https://metaso.cn/minimax-h3/?s=Magiviz) |

---

**Language: [中文](#) | [English](#english-version)**

---

# Magiviz

Magiviz Logo

**AI驱动的智能视频创作平台 | AI-Powered Intelligent Video Creation Platform**

[Next.js](https://nextjs.org/)
[TypeScript](https://www.typescriptlang.org/)
[Tailwind CSS](https://tailwindcss.com/)
[PostgreSQL](https://www.postgresql.org/)
[Stripe](https://stripe.com/)

[🌟 在线演示](https://magiviz.com) • [🚀 快速开始](#快速开始)

---

Magiviz 是一款 AI 驱动的智能视频创作平台，让每个人都能轻松创作专业级的视频内容。从创意构想到成品制作，只需数分钟——无需任何经验。支持好莱坞影视、动漫、故事剧情、广告、科普等多种视频类型。

## 目录

- [核心功能](#核心功能)
- [技术栈](#技术栈)
- [API 接口](#api-接口)
- [部署指南](#部署指南)



## 核心功能



### 🎬 AI 视频创作工作流

```
创意输入 → AI 剧情生成 → 角色设计 → 分镜生成 → 视频渲染 → 成品导出
```

- **AI 剧情生成**：输入故事大纲，AI 自动生成详细的场景分解、角色设定、导演指令和对话
- **自定义角色生成**：AI 根据文字描述生成风格一致的角色设计，支持自定义上传和重新生成
- **分镜图生成**：自动生成高保真分镜图，包含构图、光影、氛围等细节
- **多格式输出**：支持 16:9、9:16等多种画面比例
- **多模型支持**：集成 Veo、Kling、Seedance、Wan 等多个 AI 视频生成模型



### 🎬 核心五步工作流（详见 `components/operate.tsx`）

应用的核心交互组件 `AIFunction`（位于 `components/operate.tsx`，约 10,289 行）实现了一套完整的「五步串行 + 可中断可恢复」AI 视频生成流水线。

#### 整体流程

```
        ┌─────────────────────────────────────────────┐
        │   步骤1：AI 剧情生成 (script)                │
        │   /api/ai/generate-story-details            │
        └─────────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────────┐
        │   步骤2：主角生成 (character) [并行]         │
        │   /api/ai/generate-character-image          │
        └─────────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────────┐
        │   步骤3：分镜图生成 (storyboard) [并行]      │
        │   /api/ai/generate-storyboard-image         │
        └─────────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────────┐
        │   步骤4：剧情视频生成 (scenes) [并行]        │
        │   /api/ai/generate-story-video              │
        └─────────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────────┐
        │   步骤5：完整视频合成 (video)                │
        │   /api/ai/fal/compose-story-video           │
        └─────────────────────────────────────────────┘
```



#### 步骤详解

**步骤 1：AI 剧情生成**

- 输入：用户提示词、时长、比例、视频风格、视频模型、参考图
- 调 `generate-story-details` 生成结构化 JSON：标题、场景列表、角色列表（含主角描写与分镜/视频提示词）
- 内置分段时长规则：根据 `videoModel` 决定每段时长（Veo 固定 8s；Seedance 2.5 支持 4-30s；Seedance 2.0 系列 4-15s；Wan 3.0 支持 2-30s 等）
- 解析时使用 `tryParsePossiblyMalformedJson` 兼容 LLM 输出的非严格 JSON

**步骤 2：主角生成（并行）**

- 对 `scriptData.characters` 中每个角色调用 `generateCharacterForSingle`
- 支持图生图：如果用户上传了角色参考图，会作为 `referenceImage` 传入
- 错误处理：积分不足、其他 API 错误、JSON 解析失败均有独立分支
- 实时状态：每个完成的主角立即更新到 UI（带失败覆盖层）

**步骤 3：分镜图生成（并行）**

- 调用 `generateStoryboardForScene`，对每个场景并行生成
- 智能角色筛选：只把该场景 `characterIds` 引用的角色图片传给分镜图生成
- **首尾帧模式**（`generationMode === 'first-last-frame'`）：同时生成首帧和尾帧，使用 `firstFramePrompt` / `lastFramePrompt`
- 支持 `regenerateFrameType` 单帧重生成（仅重新生成首帧或尾帧）

**步骤 4：剧情视频生成（并行）**

- 调用 `generateSceneVideoForScene`，基于分镜图生成每个场景的视频
- 传递参数：`aspectRatio`、`duration`、`videoStyle`、`videoModel`
- 多模态参考：上传的视频/音频会作为 `videoUrls` / `audioUrls` 传入（仅 Seedance 模型支持）
- 首尾帧模式下，尾帧图作为 `additionalImageUrls` 传入
- 实时更新：每完成一段视频立即显示

**步骤 5：完整视频合成**

- 调用 `composeSceneVideosWithFAL`，使用 FAL AI 把所有剧情视频拼接为完整视频
- 计算每段视频的 `keyframes`（视频轨 + 音频轨）并合并
- 完整视频含总时长、缩略图、宽高比、文件大小



#### 关键状态机

```typescript
type WorkflowStep = 'idle' | 'script' | 'character' | 'storyboard' | 'scenes' | 'video'
```

每个步骤都有三种 UI 状态：当前（橙色高亮 + Loader）、已完成（绿色 ✓）、待开始（灰色）。

#### 可中断 & 可恢复

工作流支持在任意步骤暂停和恢复：

- **暂停**：积分不足时自动暂停，弹出购买弹窗；用户也可手动暂停
- **正在执行的 Pusher 任务**：暂停时先等待所有进行中的异步任务完成（最多 60s），再调用 `abortController.abort()` 取消新请求
- **恢复**：从中断的步骤继续（`resumeWorkflow` 按 `workflowStep` 分发），不丢失已有数据
- **项目恢复**：通过 `resumeProjectId` + `resumeVersionId` 加载历史项目，按完成度自动跳转到下一步



#### 版本组管理（`versionGroupId`）

每次重新生成（剧情/主角/分镜图/剧情视频/视频）都会生成新的 `versionGroupId`，用于：

- 关联同一批次的所有重新生成任务
- 数据库版本追踪
- 历史版本回溯（原版本不会被覆盖）



#### 参数面板

UI 面板提供完整的生成参数控制：


| 参数   | 选项                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 视频模型 | auto / veo31Lite / veo31Fast / veo31Quality / geminiOmni / seedance25 / seedance2Fast / seedance2Mini / seedance2 / kling3 / happyHorse / wan30 / wan30Prime / minimaxH3 |
| 生成模式 | auto（普通）/ first-last-frame（首尾帧）                                                                                                                             |
| 画面比例 | 16:9 / 9:16                                                                                                                                                 |
| 时长   | auto / 15s / 30s / 60s                                                                                                                                      |
| 视频风格 | auto / anime / hollywood / ads                                                                                                                              |


**媒体兼容性自动锁定**：当用户上传了视频/音频时，自动锁定为 Seedance 模型（`seedance2` / `seedance2Fast` / `seedance2Mini` / `seedance25`），其他模型被禁用。

#### 媒体校验（`validateSeedanceMedia`）

上传视频/音频后，自动调用 `probeMediaUrl` 探测元数据并校验：

- 视频/音频数量 ≤ `SEEDANCE_LIMITS.video.maxCount` / `audio.maxCount`
- 总时长 ≤ `maxTotalDuration`
- 单个文件格式/尺寸符合 Seedance 限制



#### 单个元素重新生成

工作流运行后，用户可针对每个元素重新生成：


| 操作       | 触发       | 流程                           |
| -------- | -------- | ---------------------------- |
| 重新生成剧情   | 步骤1按钮    | 完整 5 步重跑                     |
| 重新生成主角   | 步骤2按钮    | 单主角 → 找出受影响场景 → 重生成分镜+剧情+总视频 |
| 重新生成分镜图  | 步骤3按钮    | 单分镜 → 对应剧情视频 → 总视频           |
| 重新生成首/尾帧 | 步骤3首尾帧按钮 | 单帧 → 对应剧情视频 → 总视频            |
| 重新生成剧情视频 | 步骤4按钮    | 单视频 → 总视频                    |
| 重新生成完整视频 | 步骤5按钮    | 仅合成步骤                        |




#### 实时状态更新

每完成一个元素立即更新 UI：

- 正在生成：半透明黑色蒙层 + Loader2 转圈
- 生成失败：红色蒙层 + 错误信息
- 生成成功：图片/视频立即显示



### 📊 项目管理

Magiviz 提供完整的项目生命周期管理体系，覆盖从创作、保存、版本追溯到成果导出的全部环节。

#### 项目列表（`/projects`）

- **统一列表**：集中展示用户的所有项目，支持缩略图预览、标题、状态、创建时间、进度百分比
- **状态标签**：`已完成`（绿色 badge）/ `进行中`（灰色 badge）一目了然
- **进度可视化**：每个项目显示当前步骤（剧情/主角/分镜图/剧情视频/完整视频）的完成百分比
- **快速操作**：列表项支持继续生成、查看详情、删除等快捷操作
- **过滤与搜索**：按状态、模型、风格筛选，按关键词搜索项目标题



#### 项目详情页（`/projects/[id]`，由 `components/project-detail.tsx` 实现）

详情页是一个**多 Tab 复合视图**，包括：


| Tab                | 内容                                       |
| ------------------ | ---------------------------------------- |
| 概览（Overview）       | 项目元信息（比例/时长/风格/模型/生成模式/状态/当前步骤）+ 最终视频播放器 |
| 剧情（Script）         | 剧情标题、描述、每个场景的标题与文字描述，支持下载 JSON           |
| 角色（Characters）     | 主角列表，头像、名字、描述、角色标签，支持查看/下载/重新生成          |
| 分镜图（Storyboards）   | 各场景分镜图，首尾帧模式可左右切换预览                      |
| 剧情视频（Scene Videos） | 每个场景的剧情视频播放器                             |
| 完整视频（Final）        | 最终合成视频（含缩略图、时长、文件大小）                     |
| 历史版本（History）      | 所有版本时间线，支持查看/编辑/继续生成                     |




#### 五步进度跟踪

详情页顶部展示**五步进度条**，每个步骤对应不同图标：

```
  📝 剧情  →  👥 主角  →  🖼️ 分镜图  →  🎬 剧情视频  →  ✨ 完整视频
```

- 完成步骤：绿色 + 主色填充
- 当前步骤：高亮主色
- 待开始：灰色

进度数据由 `useProject` Hook 提供，进度百分比通过 `getProgressPercentage` 计算。

#### 元信息记录

每个项目自动保存完整的生成参数，便于回溯与复现：


| 字段                          | 说明                                                 |
| --------------------------- | -------------------------------------------------- |
| `originalPrompt`            | 用户原始提示词                                            |
| `aspectRatio`               | 画面比例（16:9 / 9:16）                                  |
| `duration`                  | 视频总时长（auto / 15s / 30s / 60s）                      |
| `videoStyle`                | 视频风格（auto / anime / hollywood / ads）               |
| `videoModel`                | 视频模型（auto / veo31Fast / seedance2 / kling3 等 12 种） |
| `generationMode`            | 生成模式（auto / first-last-frame）                      |
| `currentStep`               | 当前所处步骤                                             |
| `status`                    | 项目状态（completed / in_progress）                      |
| `createdAt` / `completedAt` | 创建时间 / 完成时间                                        |
| `versionGroupId`            | 当前激活版本组 ID                                         |
| `version`                   | 当前激活版本号                                            |




#### 版本管理（`versionGroupId` + `version`）

Magiviz 实现了一套**双层版本控制**：

- `versionGroupId`：每次「重新生成」（剧情/主角/分镜图/剧情视频/总视频）会生成新的 `versionGroupId`，把同一批次的所有重新生成任务关联起来
- `version`：每个版本组内的具体版本号（自增整数），用于版本时间线展示


| 操作          | versionGroupId | version | 版本更新 |
| ----------- | -------------- | ------- | ----- |
| 首次创建项目      | 初始 vgId        | 1       |       |
| 重新生成剧情      | 新 vgId         | 自增      |       |
| 单分镜图重生      | 新 vgId         | 自增      |       |
| 继续生成（未完成项目） | 复用原 vgId       | 保持      |       |




#### 历史版本时间线（History Tab）

详情页的「历史版本」Tab 提供：

- **完整版本列表**：显示版本号（v1、v2...）、创建时间、修改时间、是否当前查看
- **版本查看**：点击 `查看` 按钮切换前端展示的数据（仅前端状态，不改变真实激活版本）
- **版本继续生成**：未完成版本显示 `继续生成` 按钮
- **版本编辑**：已完成版本显示 `编辑` 按钮，可跳转到创作页面
- **状态标识**：高亮当前正在查看的版本



#### 项目恢复（Resume Project）

当用户从项目列表点击未完成项目时：

1. 详情页会展示项目状态和当前进度
2. 点击 `继续生成` 跳转到 `/create?projectId=xxx&versionId=yyy`
3. `AIFunction` 组件通过 `resumeProjectId` + `resumeVersionId` props 接收参数
4. `restoreProjectData` 调用 `/api/projects/:id` 和 `/api/projects/:id/data?version=:versionId` 恢复全部数据
5. `useEffect` 根据完成度自动跳转到对应步骤：

```
缺主角图 → 跳到步骤 2（character）
缺分镜图 → 跳到步骤 3（storyboard）
缺剧情视频 → 跳到步骤 4（scenes）
缺完整视频 → 跳到步骤 5（video）
全部完成 → 显示「全部完成」提示
```



#### 项目数据存储结构

每个项目版本在数据库中保存完整的生成结果：

```typescript
{
  id: string,                  // 版本 ID
  projectId: string,           // 所属项目
  version: number,              // 版本号
  versionGroupId: string,       // 版本组 ID

  // 步骤 1：剧情
  scriptTitle: string,
  scriptDescription: string,
  scriptScenes: Scene[],        // 场景列表

  // 步骤 2：主角
  characterData: Character[],   // 角色列表（含 imageUrl）

  // 步骤 3：分镜图
  storyboardData: Storyboard[], // 分镜图列表（含 imageUrl、firstFrameUrl、lastFrameUrl）

  // 步骤 4：剧情视频
  sceneVideoData: SceneVideo[], // 剧情视频列表（含 videoUrl）

  // 步骤 5：完整视频
  finalVideoUrl: string,
  finalVideoThumbnail: string,
  finalVideoDuration: number,
  finalVideoSize: number,
}
```



#### 素材库（`/library`）

独立的素材管理模块，集中管理用户上传的所有资源：

- **图片素材**：用户上传的参考图、按时间倒序展示、缩略图预览、删除操作
- **视频素材**：项目生成的剧情视频片段、最终视频
- **存储空间监控**：顶部展示已用/总配额/可用空间进度条（按订阅等级不同）
- **引用追踪**：每个素材显示被哪些项目使用
- **上传限额校验**：单文件 ≤ 订阅计划限制（Trial 50MB / Pro 100MB / Annual 无限制）
- **存储校验**：上传前调用 `/api/library/storage` 预检查剩余空间



#### 一键导出

详情页每个素材都支持一键下载：

- **剧情 JSON**：导出完整剧本结构（含 title、description、scenes）
- **主角图**：PNG 格式下载，文件名包含角色名
- **分镜图**：PNG 格式下载，支持首尾帧
- **剧情视频**：MP4 格式下载，文件名包含场景信息
- **完整视频**：MP4 格式下载，Kie.ai URL 自动转换为直链
- **下载进度**：流式下载带进度反馈，失败时降级为浏览器直链下载



#### 删除与归档

- 项目可一键删除（带确认弹窗）
- 删除会同时清理关联的所有素材数据
- 数据库层面使用级联删除保证一致性



### 💳 支付与积分系统

- **订阅计划**：Trial（试用）、Pro（月付）、Annual（年付）三种方案
- **积分购买**：灵活的积分充值系统，按量付费
- **积分折扣**：订阅用户享受 67 折积分消耗优惠
- **消费记录**：详细的积分使用历史和消费明细



### 🤝 推荐与分销

- **推荐计划**：通过推荐链接邀请好友，获得积分奖励
- **分销系统**：加入推广计划，通过推广获得收益
- **提现功能**：佣金可随时提现至账户



### 🔐 用户系统

- **多种登录方式**：邮箱密码、Google OAuth、GitHub OAuth
- **邮箱验证**：注册验证、密码重置
- **个人资料**：用户信息管理、账户安全设置
- **订阅管理**：查看订阅状态、管理计费



### 🛡️ 管理员后台

- **用户管理**：查看和管理所有用户、积分调整
- **订阅统计**：订阅数据分析、收入报表
- **分销管理**：推广订单、佣金结算
- **邮件订阅**：Newsletter 管理



### 🌍 国际化

- **多语言支持**：中文、英文，可轻松扩展
- **本地化**：完整的 UI 翻译和日期格式化
- **多语言 SEO**：多语言 URL 和元数据优化



## 技术栈



### 前端

- **Next.js 15** - React 全栈框架
- **TypeScript** - 类型安全
- **Tailwind CSS** - 原子化 CSS 框架
- **Radix UI** - 无障碍组件库
- **next-intl** - 国际化解决方案
- **Framer Motion** - 动画效果
- **React Hook Form + Zod** - 表单管理与验证



### 后端

- **Next.js API Routes** - 服务端 API
- **NextAuth.js** - 身份认证
- **Drizzle ORM** - 数据库 ORM
- **PostgreSQL** - 关系型数据库
- **Stripe** - 支付处理
- **Resend** - 邮件服务
- **Pusher** - 实时推送



### AI 服务

- **Kie.ai** - 集成多个视频生成模型
- **ZenMux** - AI 剧情生成



## 快速开始



### 环境要求

- Node.js 18+
- PostgreSQL 数据库
- Stripe 账户
- Kie.ai API Key



### 1. 克隆项目

```bash
git clone <https://github.com/ItusiAI/Open-Magiviz>
cd Magiviz
```



### 2. 安装依赖

```bash
npm install
```



### 3. 配置环境变量

复制 `.env.example` 到 `.env.local` 并配置以下环境变量：

```env
# 数据库
DATABASE_URL="postgresql://..."

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key"

# Stripe
STRIPE_SECRET_KEY="sk_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# AI 服务
KIE_API_KEY="your-kie-api-key"
ZENMUX_API_KEY="your-zenmux-api-key"
```



### 4. 数据库设置

```bash
npm run db:push
```



### 5. 启动开发服务器

```bash
npm run dev
```

访问 `http://localhost:3000`

## 项目结构

```
├── app/
│   ├── [locale]/                 # 国际化路由
│   │   ├── page.tsx             # 首页
│   │   ├── create/             # 创作页面
│   │   ├── projects/            # 项目列表
│   │   ├── library/             # 素材库
│   │   ├── pricing/             # 价格页面
│   │   ├── profile/             # 个人资料
│   │   ├── auth/                # 认证页面
│   │   └── admin/              # 管理后台
│   └── api/
│       ├── ai/                  # AI 相关 API
│       │   ├── generate-story-details/   # 剧情生成
│       │   ├── generate-story-video/     # 视频生成
│       │   └── ...
│       ├── stripe/              # 支付 API
│       ├── admin/               # 管理 API
│       └── auth/                # 认证 API
├── components/
│   ├── operate.tsx              # 核心创作组件
│   ├── project-detail.tsx       # 项目详情
│   ├── sidebar.tsx              # 侧边栏
│   ├── ui/                      # UI 组件库
│   └── ...
├── lib/
│   ├── auth.ts                  # 认证配置
│   ├── db.ts                    # 数据库连接
│   ├── schema.ts                # 数据模型
│   ├── stripe.ts                # Stripe 配置
│   └── ...
├── messages/
│   ├── en.json                  # 英文翻译
│   └── zh.json                  # 中文翻译
└── public/                      # 静态资源
```



## 商业模式



### 订阅计划


| 方案     | 价格      | 积分赠送 | 积分折扣 | 上传大小  | 存储空间  |
| ------ | ------- | ---- | ---- | ----- | ----- |
| Trial  | $19.9   | 200  | 67折  | 50MB  | 50GB  |
| Pro    | $49.9/月 | 550  | 67折  | 100MB | 100GB |
| Annual | $499/年  | 6600 | 67折  | 无限制   | 无限制   |




### 积分套餐


| 套餐      | 积分    | 价格  |
| ------- | ----- | --- |
| Starter | 200   | $20 |
| Popular | 500   | $50 |
| Premium | 1,000 | $98 |




### 积分消耗示例


| 模型                | 5秒视频 | 10秒视频 | 15秒视频 |
| ----------------- | ---- | ----- | ----- |
| Veo 3.1 Fast      | 10   | 20    | 30    |
| Veo 3.1 Lite      | 5    | 10    | 15    |
| Veo 3.1 Quality   | 15   | 30    | 45    |
| Seedance 2.0 Fast | 10   | 20    | 30    |
| Seedance 2.0 Mini | 7.5  | 15    | 22.5  |
| Seedance 2.0      | 15   | 30    | 45    |
| Kling 3.0         | 10   | 20    | 30    |
| Wan 3.0           | 15   | 30    | 45    |
| Wan 3.0 Prime     | 20   | 40    | 60    |
| HappyHorse        | 10   | 20    | 30    |
| Gemini Omni       | 5    | 10    | 15    |
| MiniMax H3        | 12.5 | 25    | 37.5  |




## API 接口



### 剧情生成

```typescript
POST /api/ai/generate-story-details
{
  prompt: string,           // 故事大纲
  duration?: number,        // 时长
  aspectRatio?: string,     // 画面比例
  videoStyle?: string,      // 视频风格
  videoModel?: string,      // 视频模型
  userImages?: string[]     // 参考图片
}
```



### 视频生成

```typescript
POST /api/ai/generate-story-video
{
  imageUrl?: string,              // 分镜图 URL
  prompt: string,                 // 视频提示词
  aspectRatio?: string,           // 画面比例
  duration?: string,              // 视频时长
  videoModel?: string,            // 视频模型
  videoStyle?: string,            // 视频风格
  additionalImageUrls?: string[], // 额外图片（尾帧等）
  generationType?: string,        // 生成模式（仅 Veo）
  videoUrls?: string[],          // 参考视频（仅 Seedance）
  audioUrls?: string[]           // 参考音频（仅 Seedance）
}
```



### 批量视频生成

```typescript
POST /api/ai/generate-story-video
{
  scenes: [
    {
      id: string,
      imageUrl: string,
      prompt: string,
      aspectRatio?: string,
      duration?: string,
      videoModel?: string,
      ...
    }
  ]
}
```



## 部署指南



### Vercel 部署（推荐）

1. Fork 本项目到 GitHub
2. 在 Vercel 中导入项目
3. 配置环境变量
4. 部署完成



### 环境变量清单

```env
# 数据库
DATABASE_URL

# NextAuth
NEXTAUTH_URL
NEXTAUTH_SECRET

# Stripe
STRIPE_SECRET_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_TRIAL_PRICE_ID
STRIPE_PRO_PRICE_ID
STRIPE_ANNUAL_PRICE_ID
STRIPE_POINTS_*

# OAuth
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GITHUB_ID
GITHUB_SECRET

# AI 服务
KIE_API_KEY
KIE_VEO_WEBHOOK_URL
KIE_VIDEO_WEBHOOK_URL
ZENMUX_API_KEY

# 邮件服务
RESEND_API_KEY
RESEND_FROM_EMAIL

# 应用
NEXT_PUBLIC_APP_URL
```



## 安全特性

- **数据加密**：密码 bcrypt 加密
- **会话管理**：JWT 令牌和安全会话
- **CSRF 保护**：内置 CSRF 防护
- **输入验证**：Zod 数据验证
- **环境隔离**：敏感配置环境变量管理



## SEO 优化

- 多语言 SEO 元数据
- 自动生成 sitemap.xml
- JSON-LD 结构化数据
- Open Graph 社交分享优化
- 图片自动优化

---



**让每个人都能成为影视创作者**

[官网](https://magiviz.com) • [联系](app@itusi.cn)

---

# English Version

## Sponsor

| **MiniMax H3 Video Generation API｜Metaso**<br><br>Cost-effective MiniMax H3 video generation service by Metaso: **768P at only ¥0.09/sec, 2K at only ¥0.15/sec**. Native 2K support, audio-video sync, **OpenAI-compatible API**, and **ComfyUI** support — no GPU deployment needed.<br><br>[Register via Magiviz exclusive link](https://metaso.cn/minimax-h3/?s=Magiviz) to claim free credits and exclusive discounts. | [<img src="public/images/meta.jpg" alt="Metaso - MiniMax H3" width="280"/>](https://metaso.cn/minimax-h3/?s=Magiviz) |

---

# Magiviz

Magiviz Logo

**AI-Powered Intelligent Video Creation Platform**

[Next.js](https://nextjs.org/)
[TypeScript](https://www.typescriptlang.org/)
[Tailwind CSS](https://tailwindcss.com/)
[PostgreSQL](https://www.postgresql.org/)
[Stripe](https://stripe.com/)

[🌟 Live Demo](https://magiviz.com) • [🚀 Quick Start](#quick-start)

---

Magiviz is an AI-driven intelligent video creation platform that enables everyone to easily produce professional-grade video content. From concept to finished product in just minutes — no experience required. Supports Hollywood films, anime, story-driven narratives, advertisements, educational content, and more.

## Table of Contents

- [Core Features](#core-features)
- [Tech Stack](#tech-stack)
- [API Reference](#api-reference)
- [Deployment Guide](#deployment-guide)



## Core Features



### 🎬 AI Video Creation Workflow

```
Creative Input → AI Script Generation → Character Design → Storyboard → Video Rendering → Export
```

- **AI Script Generation**: Input a story outline and AI automatically generates detailed scene breakdowns, character settings, director instructions, and dialogue
- **Custom Character Generation**: AI generates consistent character designs from text descriptions, with support for custom uploads and regeneration
- **Storyboard Generation**: Automatically generates high-fidelity storyboards with composition, lighting, atmosphere, and other details
- **Multi-format Output**: Supports 16:9, 9:16, and various other aspect ratios
- **Multi-model Support**: Integrates Veo, Kling, Seedance, Wan, and other AI video generation models



### 🎬 Core Five-Step Workflow (See `components/operate.tsx`)

The core interactive component `AIFunction` (located in `components/operate.tsx`, ~10,289 lines) implements a complete "five-step serial + interruptible & resumable" AI video generation pipeline.

#### Overall Flow

```
        ┌─────────────────────────────────────────────┐
        │   Step 1: AI Script Generation (script)    │
        │   /api/ai/generate-story-details            │
        └─────────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────────┐
        │   Step 2: Character Generation [Parallel]   │
        │   /api/ai/generate-character-image          │
        └─────────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────────┐
        │   Step 3: Storyboard Generation [Parallel]  │
        │   /api/ai/generate-storyboard-image         │
        └─────────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────────┐
        │   Step 4: Scene Video Generation [Parallel] │
        │   /api/ai/generate-story-video             │
        └─────────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────────┐
        │   Step 5: Complete Video Synthesis          │
        │   /api/ai/fal/compose-story-video          │
        └─────────────────────────────────────────────┘
```



#### Step Details

**Step 1: AI Script Generation**

- Input: User prompt, duration, aspect ratio, video style, video model, reference images
- Calls `generate-story-details` to generate structured JSON: title, scene list, character list (including main character descriptions and storyboard/video prompts)
- Built-in segment duration rules: determines per-segment duration based on `videoModel` (Veo fixed 8s; Seedance 2.5 supports 4-30s; Seedance 2.0 series 4-15s; Wan 3.0 supports 2-30s, etc.)
- Uses `tryParsePossiblyMalformedJson` to handle non-strict JSON output from LLMs

**Step 2: Character Generation (Parallel)**

- Calls `generateCharacterForSingle` for each character in `scriptData.characters`
- Supports image-to-image: if user uploads a character reference image, it's passed as `referenceImage`
- Error handling: independent branches for insufficient credits, other API errors, and JSON parsing failures
- Real-time status: each completed character immediately updates the UI (with failure overlay)

**Step 3: Storyboard Generation (Parallel)**

- Calls `generateStoryboardForScene` to generate storyboards for each scene in parallel
- Smart character filtering: only passes character images referenced by that scene's `characterIds` to storyboard generation
- **First-Last Frame Mode** (`generationMode === 'first-last-frame'`): Generates both first and last frames using `firstFramePrompt` / `lastFramePrompt`
- Supports `regenerateFrameType` for single frame regeneration (regenerate first or last frame only)

**Step 4: Scene Video Generation (Parallel)**

- Calls `generateSceneVideoForScene` to generate videos for each scene based on storyboards
- Parameters: `aspectRatio`, `duration`, `videoStyle`, `videoModel`
- Multimodal reference: uploaded videos/audio passed as `videoUrls` / `audioUrls` (Seedance model only)
- In first-last frame mode, last frame image passed as `additionalImageUrls`
- Real-time updates: each completed video immediately displays

**Step 5: Complete Video Synthesis**

- Calls `composeSceneVideosWithFAL` to splice all scene videos into a complete video using FAL AI
- Calculates `keyframes` for each video segment (video track + audio track) and merges
- Complete video includes total duration, thumbnail, aspect ratio, and file size



#### Key State Machine

```typescript
type WorkflowStep = 'idle' | 'script' | 'character' | 'storyboard' | 'scenes' | 'video'
```

Each step has three UI states: current (orange highlight + Loader), completed (green ✓), pending (gray).

#### Interruptible & Resumable

The workflow supports pausing and resuming at any step:

- **Pause**: Auto-pauses when credits are insufficient, showing purchase popup; users can also manually pause
- **Executing Pusher Tasks**: When pausing, first waits for all in-progress async tasks to complete (up to 60s), then calls `abortController.abort()` to cancel new requests
- **Resume**: Continues from the interrupted step (`resumeWorkflow` dispatches by `workflowStep`), no data loss
- **Project Resume**: Load historical projects via `resumeProjectId` + `resumeVersionId`, auto-jumps to the next step based on completion progress



#### Version Group Management (`versionGroupId`)

Each regeneration (script/character/storyboard/scene video/video) generates a new `versionGroupId`, used for:

- Associating all regeneration tasks in the same batch
- Database version tracking
- Historical version rollback (original versions are not overwritten)



#### Parameters Panel

The UI panel provides complete generation parameter controls:


| Parameter | Options                                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Video Model | auto / veo31Lite / veo31Fast / veo31Quality / geminiOmni / seedance25 / seedance2Fast / seedance2Mini / seedance2 / kling3 / happyHorse / wan30 / wan30Prime / minimaxH3 |
| Generation Mode | auto (normal) / first-last-frame                                                                                                                                |
| Aspect Ratio | 16:9 / 9:16                                                                                                                                                     |
| Duration | auto / 15s / 30s / 60s                                                                                                                                          |
| Video Style | auto / anime / hollywood / ads                                                                                                                                 |


**Media Compatibility Auto-Lock**: When user uploads video/audio, automatically locks to Seedance model (`seedance2` / `seedance2Fast` / `seedance2Mini` / `seedance25`), other models are disabled.

#### Media Validation (`validateSeedanceMedia`)

After uploading video/audio, automatically calls `probeMediaUrl` to probe metadata and validate:

- Video/audio count ≤ `SEEDANCE_LIMITS.video.maxCount` / `audio.maxCount`
- Total duration ≤ `maxTotalDuration`
- Individual file format/size meets Seedance limits



#### Individual Element Regeneration

After the workflow runs, users can regenerate individual elements:


| Action | Trigger | Flow |
| ------ | ------- | ---- |
| Regenerate Script | Step 1 button | Full 5-step rerun |
| Regenerate Character | Step 2 button | Single character → find affected scenes → regenerate storyboard + script + final video |
| Regenerate Storyboard | Step 3 button | Single storyboard → corresponding scene video → final video |
| Regenerate First/Last Frame | Step 3 first-last frame button | Single frame → corresponding scene video → final video |
| Regenerate Scene Video | Step 4 button | Single video → final video |
| Regenerate Complete Video | Step 5 button | Synthesis step only |



#### Real-time Status Updates

Each completed element immediately updates the UI:

- Generating: Semi-transparent black overlay + Loader2 spinning
- Generation failed: Red overlay + error message
- Generation successful: Image/video immediately displays



### 📊 Project Management

Magiviz provides a complete project lifecycle management system covering creation, saving, version tracking, and export.

#### Project List (`/projects`)

- **Unified List**: Centralized display of all user projects with thumbnail preview, title, status, creation time, progress percentage
- **Status Labels**: `Completed` (green badge) / `In Progress` (gray badge) at a glance
- **Progress Visualization**: Each project shows completion percentage for current step (script/character/storyboard/scene video/final video)
- **Quick Actions**: List items support continue generation, view details, delete, and other shortcuts
- **Filter & Search**: Filter by status, model, style; search project titles by keywords



#### Project Detail Page (`/projects/[id]`, implemented by `components/project-detail.tsx`)

The detail page is a **multi-tab composite view** including:


| Tab | Content |
| --- | ------- |
| Overview | Project metadata (aspect ratio/duration/style/model/generation mode/status/current step) + final video player |
| Script | Script title, description, each scene's title and text description, download JSON support |
| Characters | Character list with avatars, names, descriptions, character tags, view/download/regenerate support |
| Storyboards | Scene storyboards, first-last frame mode for switching preview |
| Scene Videos | Scene video players |
| Final | Final synthesized video (with thumbnail, duration, file size) |
| History | All version timeline, view/edit/continue generation support |



#### Five-Step Progress Tracking

The detail page top displays a **five-step progress bar** with different icons for each step:

```
  📝 Script  →  👥 Characters  →  🖼️ Storyboards  →  🎬 Scene Videos  →  ✨ Final Video
```

- Completed step: Green + primary color fill
- Current step: Highlighted primary color
- Pending: Gray

Progress data provided by `useProject` Hook, progress percentage calculated via `getProgressPercentage`.

#### Metadata Recording

Each project automatically saves complete generation parameters for tracing and reproduction:


| Field | Description |
| ----- | ----------- |
| `originalPrompt` | User's original prompt |
| `aspectRatio` | Aspect ratio (16:9 / 9:16) |
| `duration` | Total video duration (auto / 15s / 30s / 60s) |
| `videoStyle` | Video style (auto / anime / hollywood / ads) |
| `videoModel` | Video model (auto / veo31Fast / seedance2 / kling3, 12 models total) |
| `generationMode` | Generation mode (auto / first-last-frame) |
| `currentStep` | Current step |
| `status` | Project status (completed / in_progress) |
| `createdAt` / `completedAt` | Creation time / completion time |
| `versionGroupId` | Current active version group ID |
| `version` | Current active version number |



#### Version Management (`versionGroupId` + `version`)

Magiviz implements a **dual-layer version control**:

- `versionGroupId`: Each "regeneration" (script/character/storyboard/scene video/final video) generates a new `versionGroupId`, associating all regeneration tasks in the same batch
- `version`: Specific version number within each version group (auto-incrementing integer), used for version timeline display


| Action | versionGroupId | version |
| ------ | ------------- | ------- |
| Initial project creation | Initial vgId | 1 |
| Regenerate script | New vgId | Auto-increment |
| Regenerate single storyboard | New vgId | Auto-increment |
| Continue generation (incomplete project) | Reuse original vgId | Keep |



#### History Version Timeline (History Tab)

The "History" tab in the detail page provides:

- **Complete version list**: Version number (v1, v2...), creation time, modification time, current view status
- **Version view**: Click `View` button to switch frontend displayed data (frontend state only, doesn't change actual active version)
- **Version continue generation**: Incomplete versions show `Continue Generation` button
- **Version edit**: Completed versions show `Edit` button to jump to creation page
- **Status indicator**: Highlights the currently viewed version



#### Project Resume

When user clicks an incomplete project from the project list:

1. Detail page displays project status and current progress
2. Click `Continue Generation` to jump to `/create?projectId=xxx&versionId=yyy`
3. `AIFunction` component receives parameters via `resumeProjectId` + `resumeVersionId` props
4. `restoreProjectData` calls `/api/projects/:id` and `/api/projects/:id/data?version=:versionId` to restore all data
5. `useEffect` auto-jumps to corresponding step based on completion:

```
Missing character image → Jump to Step 2 (character)
Missing storyboard → Jump to Step 3 (storyboard)
Missing scene video → Jump to Step 4 (scenes)
Missing final video → Jump to Step 5 (video)
All complete → Show "All Complete" message
```



#### Project Data Storage Structure

Each project version saves complete generation results in the database:

```typescript
{
  id: string,                  // Version ID
  projectId: string,           // Project
  version: number,             // Version number
  versionGroupId: string,      // Version group ID

  // Step 1: Script
  scriptTitle: string,
  scriptDescription: string,
  scriptScenes: Scene[],        // Scene list

  // Step 2: Characters
  characterData: Character[],   // Character list (with imageUrl)

  // Step 3: Storyboards
  storyboardData: Storyboard[], // Storyboard list (with imageUrl, firstFrameUrl, lastFrameUrl)

  // Step 4: Scene Videos
  sceneVideoData: SceneVideo[], // Scene video list (with videoUrl)

  // Step 5: Final Video
  finalVideoUrl: string,
  finalVideoThumbnail: string,
  finalVideoDuration: number,
  finalVideoSize: number,
}
```



#### Asset Library (`/library`)

Independent asset management module for centralized management of all user-uploaded resources:

- **Image Assets**: User-uploaded reference images, sorted by time descending, thumbnail preview, delete operations
- **Video Assets**: Project-generated scene video clips and final videos
- **Storage Space Monitoring**: Top displays used/total quota/available space progress bar (varies by subscription tier)
- **Reference Tracking**: Each asset shows which projects use it
- **Upload Limit Validation**: Single file ≤ subscription plan limit (Trial 50MB / Pro 100MB / Annual unlimited)
- **Storage Validation**: Before upload, calls `/api/library/storage` to pre-check remaining space



#### One-Click Export

Each asset in the detail page supports one-click download:

- **Script JSON**: Export complete script structure (with title, description, scenes)
- **Character Images**: PNG format, filename includes character name
- **Storyboards**: PNG format, supports first-last frame
- **Scene Videos**: MP4 format, filename includes scene info
- **Final Video**: MP4 format, Kie.ai URL auto-converted to direct link
- **Download Progress**: Streaming download with progress feedback, fallback to browser direct link download on failure



#### Delete & Archive

- Projects can be deleted with one click (with confirmation popup)
- Deletion also cleans up all associated asset data
- Database uses cascading delete to ensure consistency



### 💳 Payment & Credits System

- **Subscription Plans**: Trial, Pro (monthly), Annual (yearly)
- **Credits Purchase**: Flexible credits top-up system, pay-per-use
- **Credits Discount**: Subscribers enjoy 67% off credits consumption
- **Usage Records**: Detailed credits usage history and consumption details



### 🤝 Referral & Distribution

- **Referral Program**: Invite friends via referral link and earn credits rewards
- **Distribution System**: Join promotion plan and earn revenue through promotion
- **Withdrawal**: Commissions can be withdrawn to account anytime



### 🔐 User System

- **Multiple Login Methods**: Email/password, Google OAuth, GitHub OAuth
- **Email Verification**: Registration verification, password reset
- **Profile**: User information management, account security settings
- **Subscription Management**: View subscription status, manage billing



### 🛡️ Admin Dashboard

- **User Management**: View and manage all users, credits adjustment
- **Subscription Statistics**: Subscription data analysis, revenue reports
- **Distribution Management**: Promotion orders, commission settlement
- **Email Subscription**: Newsletter management



### 🌍 Internationalization

- **Multi-language Support**: Chinese, English, easily extensible
- **Localization**: Complete UI translation and date formatting
- **Multi-language SEO**: Multi-language URLs and metadata optimization



## Tech Stack



### Frontend

- **Next.js 15** - React full-stack framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Atomic CSS framework
- **Radix UI** - Accessible component library
- **next-intl** - Internationalization solution
- **Framer Motion** - Animation effects
- **React Hook Form + Zod** - Form management and validation



### Backend

- **Next.js API Routes** - Server-side API
- **NextAuth.js** - Authentication
- **Drizzle ORM** - Database ORM
- **PostgreSQL** - Relational database
- **Stripe** - Payment processing
- **Resend** - Email service
- **Pusher** - Real-time push



### AI Services

- **Kie.ai** - Multiple video generation model integration
- **ZenMux** - AI script generation



## Quick Start



### Requirements

- Node.js 18+
- PostgreSQL database
- Stripe account
- Kie.ai API Key



### 1. Clone Project

```bash
git clone <https://github.com/ItusiAI/Open-Magiviz>
cd Magiviz
```



### 2. Install Dependencies

```bash
npm install
```



### 3. Configure Environment Variables

Copy `.env.example` to `.env.local` and configure the following environment variables:

```env
# Database
DATABASE_URL="postgresql://..."

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key"

# Stripe
STRIPE_SECRET_KEY="sk_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# AI Services
KIE_API_KEY="your-kie-api-key"
ZENMUX_API_KEY="your-zenmux-api-key"
```



### 4. Database Setup

```bash
npm run db:push
```



### 5. Start Development Server

```bash
npm run dev
```

Visit `http://localhost:3000`

## Project Structure

```
├── app/
│   ├── [locale]/                 # Internationalized routing
│   │   ├── page.tsx             # Home page
│   │   ├── create/             # Creation page
│   │   ├── projects/            # Project list
│   │   ├── library/             # Asset library
│   │   ├── pricing/             # Pricing page
│   │   ├── profile/             # Profile
│   │   ├── auth/                # Auth pages
│   │   └── admin/              # Admin dashboard
│   └── api/
│       ├── ai/                  # AI-related API
│       │   ├── generate-story-details/   # Script generation
│       │   ├── generate-story-video/     # Video generation
│       │   └── ...
│       ├── stripe/              # Payment API
│       ├── admin/               # Admin API
│       └── auth/                # Auth API
├── components/
│   ├── operate.tsx              # Core creation component
│   ├── project-detail.tsx       # Project detail
│   ├── sidebar.tsx              # Sidebar
│   ├── ui/                      # UI component library
│   └── ...
├── lib/
│   ├── auth.ts                  # Auth configuration
│   ├── db.ts                    # Database connection
│   ├── schema.ts                # Data models
│   ├── stripe.ts                # Stripe configuration
│   └── ...
├── messages/
│   ├── en.json                  # English translations
│   └── zh.json                  # Chinese translations
└── public/                      # Static assets
```



## Business Model



### Subscription Plans


| Plan | Price | Credits Included | Credits Discount | Max Upload | Storage |
| ---- | ----- | ---------------- | ---------------- | ---------- | ------- |
| Trial | $19.9 | 200 | 67% off | 50MB | 50GB |
| Pro | $49.9/mo | 550 | 67% off | 100MB | 100GB |
| Annual | $499/yr | 6600 | 67% off | Unlimited | Unlimited |




### Credits Packages


| Package | Credits | Price |
| ------- | ------- | ----- |
| Starter | 200 | $20 |
| Popular | 500 | $50 |
| Premium | 1,000 | $98 |




### Credits Consumption Examples


| Model | 5s Video | 10s Video | 15s Video |
| ----- | -------- | ---------- | ---------- |
| Veo 3.1 Fast | 10 | 20 | 30 |
| Veo 3.1 Lite | 5 | 10 | 15 |
| Veo 3.1 Quality | 15 | 30 | 45 |
| Seedance 2.0 Fast | 10 | 20 | 30 |
| Seedance 2.0 Mini | 7.5 | 15 | 22.5 |
| Seedance 2.0 | 15 | 30 | 45 |
| Kling 3.0 | 10 | 20 | 30 |
| Wan 3.0 | 15 | 30 | 45 |
| Wan 3.0 Prime | 20 | 40 | 60 |
| HappyHorse | 10 | 20 | 30 |
| Gemini Omni | 5 | 10 | 15 |
| MiniMax H3 | 12.5 | 25 | 37.5 |




## API Reference



### Script Generation

```typescript
POST /api/ai/generate-story-details
{
  prompt: string,           // Story outline
  duration?: number,        // Duration
  aspectRatio?: string,     // Aspect ratio
  videoStyle?: string,      // Video style
  videoModel?: string,      // Video model
  userImages?: string[]     // Reference images
}
```



### Video Generation

```typescript
POST /api/ai/generate-story-video
{
  imageUrl?: string,              // Storyboard URL
  prompt: string,                 // Video prompt
  aspectRatio?: string,           // Aspect ratio
  duration?: string,              // Video duration
  videoModel?: string,            // Video model
  videoStyle?: string,            // Video style
  additionalImageUrls?: string[], // Additional images (last frame, etc.)
  generationType?: string,        // Generation mode (Veo only)
  videoUrls?: string[],          // Reference videos (Seedance only)
  audioUrls?: string[]           // Reference audio (Seedance only)
}
```



### Batch Video Generation

```typescript
POST /api/ai/generate-story-video
{
  scenes: [
    {
      id: string,
      imageUrl: string,
      prompt: string,
      aspectRatio?: string,
      duration?: string,
      videoModel?: string,
      ...
    }
  ]
}
```



## Deployment Guide



### Vercel Deployment (Recommended)

1. Fork this project to GitHub
2. Import the project in Vercel
3. Configure environment variables
4. Deployment complete



### Environment Variables List

```env
# Database
DATABASE_URL

# NextAuth
NEXTAUTH_URL
NEXTAUTH_SECRET

# Stripe
STRIPE_SECRET_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_TRIAL_PRICE_ID
STRIPE_PRO_PRICE_ID
STRIPE_ANNUAL_PRICE_ID
STRIPE_POINTS_*

# OAuth
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GITHUB_ID
GITHUB_SECRET

# AI Services
KIE_API_KEY
KIE_VEO_WEBHOOK_URL
KIE_VIDEO_WEBHOOK_URL
ZENMUX_API_KEY

# Email Service
RESEND_API_KEY
RESEND_FROM_EMAIL

# Application
NEXT_PUBLIC_APP_URL
```



## Security Features

- **Data Encryption**: Password bcrypt encryption
- **Session Management**: JWT tokens and secure sessions
- **CSRF Protection**: Built-in CSRF protection
- **Input Validation**: Zod data validation
- **Environment Isolation**: Sensitive configuration via environment variables



## SEO Optimization

- Multi-language SEO metadata
- Auto-generated sitemap.xml
- JSON-LD structured data
- Open Graph social sharing optimization
- Image auto-optimization

---



**Empowering Everyone to Become a Film Creator**

[Website](https://magiviz.com) • [Contact](app@itusi.cn)

---

**语言: [中文](#) | [English](#english-version)**
