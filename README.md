# AI智课平台（Chrome 插件 + FastAPI + Milvus RAG）

## 1. 项目名称

AI智课平台（AI智慧教学平台 / 课程知识库问答系统）

## 2. 项目简介

本项目面向智慧课堂与在线精品课程场景，提供教师端与学生端双端能力：教师上传课件并构建课程知识库，学生通过课程码加入课程并向 AI 提问，AI 基于课件内容进行检索增强回答（RAG），用于课堂答疑与课后学习辅导。

## 3. 功能介绍

### 教师端

- 教师登录/注册
- 创建课程并生成课程码
- 上传课件（PDF / DOCX）
- 解析课件、分块、向量化并写入向量库（Milvus）
- 课件管理：删除课件（同步删除向量库中该课件对应内容）

### 学生端

- 学生登录/注册
- 通过课程码加入课程
- 课程内向 AI 提问，AI 基于课程知识库回答并展示来源（课件名/页码）
- 课程管理：退出课程（仅移除学生与课程关系，不影响教师课程）

## 4. 技术架构

- 前端：Chrome 插件（Manifest V3）
  - `content.js`：页面注入 UI、学生/教师端交互、聊天渲染
  - `background.js`：service worker，负责与后端 API 通信
  - `widget.css`：暗色系 UI 主题与组件样式
- 后端：FastAPI（Python）
  - 认证、课程、课件上传/解析、RAG 问答、向量服务健康检查等 API
- 数据库：SQLite（项目默认，开箱即用）
- 向量库：Milvus（本地演示推荐）
- 嵌入模型：SentenceTransformers（默认 `all-MiniLM-L6-v2`）
- PDF 解析：pdfplumber（必要时可 OCR 回退）

## 5. 项目目录结构

```text
Polaris/
├── backend/
│   ├── app/                     # FastAPI 应用
│   │   ├── api/                 # API 路由（auth/course/material/chat/vector 等）
│   │   ├── core/                # 配置加载（读取 backend/.env）
│   │   └── platform/            # DB/鉴权依赖
│   ├── data/
│   │   ├── platform.db          # SQLite 数据库（默认）
│   │   └── materials/           # 课件上传目录（按 course_id 分目录）
│   ├── requirements.txt         # Python 依赖
│   └── .env                     # 环境变量（本项目已提供，可直接使用）
├── rag/
│   ├── loader.py                # PDF/DOCX/PPTX 解析（可含 OCR 回退）
│   ├── processor.py             # 文本分块
│   ├── vector_service.py        # embedding + Milvus 写入/检索
│   └── llm_handler.py           # 大模型调用与 Prompt
├── plugin/
│   ├── manifest.json            # Chrome 插件配置
│   ├── popup.html               # 插件弹窗入口
│   ├── content.js               # 插件主逻辑
│   ├── background.js            # 后台 API 调用
│   └── widget.css               # UI 样式
└── start.sh                     # 一键启动脚本（可选）
```

## 6. 环境要求

- Python：3.10+
- 浏览器：Chrome（或 Chromium 内核）
- Docker：用于启动 Milvus（推荐）
- 端口：
  - 后端：8000
  - Milvus：19530（必需），9091（可选 Web UI）

## 7. 安装步骤

### 7.1 后端 Python 依赖安装

```bash
cd /path/to/Polaris/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 7.2 环境变量说明（重要）

- 本项目的 `backend/.env` 已提供可直接运行的配置。
- **请不要修改 `.env` 内容**
- 后端启动时会自动读取该 `.env`，并使用你已提供的 API Key。

## 8. 启动方式（一步一步）


### Step 1：启动 Milvus（本地向量库）

推荐使用 Docker 启动 Milvus standalone（会暴露 19530 端口）。

方式 A：官方 standalone 脚本（推荐）

```bash
curl -sfL https://raw.githubusercontent.com/milvus-io/milvus/master/scripts/standalone_embed.sh -o standalone_embed.sh
bash standalone_embed.sh start
```

方式 B：Docker Compose

```bash
wget https://github.com/milvus-io/milvus/releases/download/v2.6.14/milvus-standalone-docker-compose.yml -O docker-compose.yml
docker compose up -d
```

验证 Milvus 必须可连通：

```bash
nc -vz 127.0.0.1 19530
```

### Step 2：启动后端 FastAPI

```bash
cd /path/to/Polaris/backend
source venv/bin/activate
PYTHONPATH=backend uvicorn app.main:app --host 127.0.0.1 --port 8000
```

验证后端：

- Health：`http://127.0.0.1:8000/health`
- Swagger：`http://127.0.0.1:8000/docs`
- 向量服务健康：`http://127.0.0.1:8000/api/vector/health?force=true`

### Step 3：加载 Chrome 插件（前端）

1. 打开 Chrome，进入：`chrome://extensions/`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择目录：`/path/to/Polaris/plugin/`
5. 浏览器工具栏出现插件图标，点击打开插件弹窗，选择「学生端 / 教师端」进入系统

### Step 4：打开网页进行演示

- 插件为内容脚本注入形式，可在任意网页演示（建议打开一个普通网页作为演示载体）
- 在插件弹窗中完成登录、课程、课件、问答流程即可

## 9. 默认测试账号

- 教师端：
  - 账号：tech1
  - 密码：123456
- 学生端：
  - 账号：stu1
  - 密码：123456

## 10. 演示流程

1. 教师端登录（tech1 / 123456）
2. 创建课程，获得课程码
3. 上传课件（PDF / DOCX）
4. 点击「解析」构建知识库（解析 → 分块 → 向量化 → Milvus 入库）
5. 学生端登录（stu1 / 123456）
6. 输入课程码加入课程
7. 进入课程问答，提问课件相关问题
8. AI 返回答案，并展示来源（课件名/页码）9.（可选）教师端删除课件；学生端退出课程

## 11. 常见问题处理

### 11.1 后端正常但向量服务不可用

- 访问：`/api/vector/health?force=true`
- 确认 Milvus 端口可连通：
  ```bash
  nc -vz 127.0.0.1 19530
  ```
- 确认 Milvus 容器运行（如用 Docker）：
  ```bash
  docker ps
  ```

### 11.2 课件上传成功但解析/入库失败

- 优先检查：`/api/vector/health?force=true` 是否为 connected=true
- 解析接口会返回明确错误信息（解析/分块/向量入库失败等），按返回提示处理即可

### 11.3 PDF 读取不到文本

- 可能为扫描版/图片型 PDF，`extract_text()` 会返回空
- 项目已支持逐页打印提取长度，并在必要时启用 OCR 回退（如已开启 OCR 依赖）
- 建议查看后端日志中的每页 `extract_text_len` / `ocr_len`

### 11.4 插件提示 “Extension context invalidated”

- 这是 Chrome 插件 service worker 重新加载导致
- 处理：刷新当前网页或在 `chrome://extensions/` 点击“重新加载”插件

## 12. 联系方式

- 项目作者：邶风
- 邮箱：3266140065@qq.com
- 仓库地址：https://github.com/qinbeifeng/Polaris
