(function () {
  // --- Configuration ---
  // Updated to a modern, abstract "Spark" logo representing AI intelligence
  const AI_LOGO_SVG = `
  <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sparkGradient" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#3B82F6"/>
        <stop offset="100%" stop-color="#2563EB"/>
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r="50" fill="url(#sparkGradient)"/>
    <path d="M50 20L58 42L80 50L58 58L50 80L42 58L20 50L42 42L50 20Z" fill="white"/>
    <path d="M75 20L78 28L86 31L78 34L75 42L72 34L64 31L72 28L75 20Z" fill="white" opacity="0.8"/>
    <path d="M25 70L27 76L33 78L27 80L25 86L23 80L17 78L23 76L25 70Z" fill="white" opacity="0.6"/>
  </svg>`;

  // Prevent duplicate injection
  if (document.getElementById("ai-assistant-container")) return;

  // --- State Management ---
  const State = {
    view: "entry", // 'entry' | 'mode_select' | 'class_select' | 'add_class' | 'chat' | 'auth' | 'student' | 'teacher' | 'me'
    mode: "free", // 'free' | 'classroom'
    currentCourse: null,
    isGenerating: false,
    courses: [], // Will fetch from backend
    coursesError: null,
    history: [], // Chat history
    dialogs: {},
    auth: {
      token: null,
      role: null,
      profile: null,
    },
    platform: {
      courseId: null,
      courses: [],
      coursesError: null,
      members: [],
      materials: [],
    },
  };

  const DIALOGS_STORAGE_KEY = "xiaoxing_dialogs_v2";
  const LEGACY_DIALOGS_STORAGE_KEY = "xiaoxing_dialogs_v1";
  const AUTH_STORAGE_KEY = "xiaoxing_auth_v1";

  function storageGet(key) {
    return new Promise((resolve) => {
      if (
        typeof chrome === "undefined" ||
        !chrome.storage ||
        !chrome.storage.local
      ) {
        resolve({});
        return;
      }
      chrome.storage.local.get([key], (result) => resolve(result || {}));
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      if (
        typeof chrome === "undefined" ||
        !chrome.storage ||
        !chrome.storage.local
      ) {
        resolve();
        return;
      }
      chrome.storage.local.set(obj, () => resolve());
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      if (
        typeof chrome === "undefined" ||
        !chrome.storage ||
        !chrome.storage.local
      ) {
        resolve();
        return;
      }
      chrome.storage.local.remove(keys, () => resolve());
    });
  }

  async function persistAuth() {
    await storageSet({
      [AUTH_STORAGE_KEY]: {
        token: State.auth.token,
        role: State.auth.role,
      },
    });
  }

  async function clearAuth() {
    State.auth.token = null;
    State.auth.role = null;
    State.auth.profile = null;
    const keys = [
      AUTH_STORAGE_KEY,
      "token",
      "currentUser",
      "roleSession",
      "role_session",
    ];
    await storageRemove(keys);
    try {
      if (
        typeof chrome !== "undefined" &&
        chrome.storage &&
        chrome.storage.sync
      ) {
        await new Promise((resolve) =>
          chrome.storage.sync.remove(keys, () => resolve()),
        );
      }
    } catch (e) {}
    try {
      window.localStorage &&
        keys.forEach((k) => window.localStorage.removeItem(k));
    } catch (e) {}
    try {
      window.sessionStorage &&
        keys.forEach((k) => window.sessionStorage.removeItem(k));
    } catch (e) {}
  }

  async function initAuth() {
    const stored = await storageGet(AUTH_STORAGE_KEY);
    const auth = stored[AUTH_STORAGE_KEY];
    if (!auth || !auth.token) return;
    State.auth.token = auth.token;
    State.auth.role = auth.role || null;
    try {
      const resp = await sendMessagePromise({
        action: "getProfile",
        token: auth.token,
      });
      if (resp && resp.success) {
        State.auth.profile = resp.profile;
        State.auth.role = resp.profile.role;
        await persistAuth();
      } else {
        await clearAuth();
      }
    } catch (e) {
      await clearAuth();
    }
  }

  function scopeIdFor(mode, courseName) {
    if (mode === "classroom") return `class:${courseName || ""}`;
    return "free:General";
  }

  function scopeTitleFor(mode, courseName) {
    if (mode === "classroom") return courseName || "课堂模式";
    return "自由模式";
  }

  async function initDialogs() {
    const stored = await storageGet(DIALOGS_STORAGE_KEY);
    const dialogs = stored[DIALOGS_STORAGE_KEY];
    if (dialogs && typeof dialogs === "object") {
      State.dialogs = dialogs;
      return;
    }
    const legacy = await storageGet(LEGACY_DIALOGS_STORAGE_KEY);
    const legacyDialogs = legacy[LEGACY_DIALOGS_STORAGE_KEY];
    if (legacyDialogs && typeof legacyDialogs === "object") {
      const migrated = {};
      Object.values(legacyDialogs).forEach((d) => {
        const mode = d.mode === "classroom" ? "classroom" : "free";
        const courseName = mode === "classroom" ? d.courseName : null;
        const scopeId = scopeIdFor(mode, courseName);
        const title = scopeTitleFor(mode, courseName);
        const sessionId = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
        migrated[scopeId] = {
          id: scopeId,
          mode,
          courseName: courseName || null,
          title,
          activeSessionId: sessionId,
          sessions: [
            {
              id: sessionId,
              title: d.title || "对话 1",
              updatedAt: d.updatedAt || Date.now(),
              messages: d.messages || [],
            },
          ],
        };
      });
      State.dialogs = migrated;
      await persistDialogs();
    }
  }

  async function persistDialogs() {
    await storageSet({ [DIALOGS_STORAGE_KEY]: State.dialogs });
  }

  function newSessionId() {
    return `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  }

  function ensureScope(mode, courseName) {
    const id = scopeIdFor(mode, courseName);
    if (!State.dialogs[id]) {
      State.dialogs[id] = {
        id,
        mode,
        courseName: mode === "classroom" ? courseName || null : null,
        title: scopeTitleFor(mode, courseName),
        activeSessionId: null,
        sessions: [],
      };
    }
    return State.dialogs[id];
  }

  function ensureSession(scope, preferredSessionId = null) {
    if (!scope.sessions) scope.sessions = [];
    if (preferredSessionId) {
      const found = scope.sessions.find((s) => s.id === preferredSessionId);
      if (found) {
        scope.activeSessionId = found.id;
        return found;
      }
    }
    if (scope.activeSessionId) {
      const active = scope.sessions.find((s) => s.id === scope.activeSessionId);
      if (active) return active;
    }
    if (scope.sessions.length) {
      const latest = scope.sessions
        .slice()
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
      scope.activeSessionId = latest.id;
      return latest;
    }
    const id = newSessionId();
    const idx = scope.sessions.length + 1;
    const session = {
      id,
      title: `对话 ${idx}`,
      updatedAt: Date.now(),
      messages: [],
    };
    scope.sessions.push(session);
    scope.activeSessionId = id;
    return session;
  }

  function createSession(scope) {
    const id = newSessionId();
    const idx = (scope.sessions || []).length + 1;
    const session = {
      id,
      title: `对话 ${idx}`,
      updatedAt: Date.now(),
      messages: [],
    };
    scope.sessions = scope.sessions || [];
    scope.sessions.push(session);
    scope.activeSessionId = id;
    return session;
  }

  function clearMessagesUI() {
    const box = document.getElementById("ai-messages-box");
    if (box) box.innerHTML = "";
  }

  function renderMessages(messages) {
    clearMessagesUI();
    (messages || []).forEach((m) => {
      appendMsg(m.role, m.text, false, m.sources || null);
    });
  }

  async function switchToDialog(mode, courseName, sessionId = null) {
    State.mode = mode;
    State.currentCourse = mode === "classroom" ? courseName : null;

    const title = scopeTitleFor(mode, courseName);
    const titleEl = document.getElementById("ai-chat-header-title");
    if (titleEl) titleEl.innerText = title;

    const scope = ensureScope(mode, courseName);
    const session = ensureSession(scope, sessionId);
    State.history = session.messages || [];
    renderMessages(State.history);

    if (!State.history.length) {
      if (mode === "classroom" && courseName) {
        appendSystemMsg(`已进入【${courseName}】课堂。`);
      } else {
        appendSystemMsg("已进入自由模式，请直接提问。");
      }
    }

    scope.sessions = scope.sessions || [];
    session.updatedAt = Date.now();
    await persistDialogs();
  }

  // Load courses from Backend (Background)
  function loadCourses() {
    if (typeof chrome !== "undefined" && chrome.runtime) {
      chrome.runtime.sendMessage({ action: "fetchCourses" }, (response) => {
        const lastErr =
          typeof chrome !== "undefined" &&
          chrome.runtime &&
          chrome.runtime.lastError
            ? chrome.runtime.lastError.message
            : null;
        if (lastErr) {
          State.courses = [];
          State.coursesError = lastErr.includes("Extension context invalidated")
            ? "插件已重新加载，请刷新页面后重试"
            : lastErr;
          if (State.view === "class_select") renderClassList();
          return;
        }
        if (response && response.success) {
          State.courses = response.courses || [];
          State.coursesError = null;
        } else {
          State.courses = [];
          State.coursesError = response ? response.error : "无法连接后端";
        }
        if (State.view === "class_select") renderClassList();
      });
    }
  }
  initDialogs();
  loadCourses();

  // --- DOM Structure ---
  // FAB
  const fab = document.createElement("div");
  fab.id = "ai-helper-fab";
  fab.innerHTML = AI_LOGO_SVG; // Use inline SVG directly
  document.body.appendChild(fab);

  // Panel
  const panel = document.createElement("div");
  panel.id = "ai-helper-panel";
  document.body.appendChild(panel);

  // --- Views ---

  const viewEntry = document.createElement("div");
  viewEntry.className = "ai-view active";
  viewEntry.innerHTML = `
    <div class="ai-panel-header ai-entry-header">
      <div class="ai-header-left">
        <div class="ai-entry-logo">${AI_LOGO_SVG}</div>
        <div class="ai-brand">
          <div class="ai-brand-title">AI智课平台</div>
          <div class="ai-brand-sub">智慧教学 · AI赋能课堂</div>
        </div>
      </div>
      <div class="ai-header-actions">
        <div class="ai-close-btn" title="关闭">×</div>
      </div>
    </div>
    <div class="ai-stage">
      <div class="ai-entry-hero">
        <div class="ai-entry-hero-title">选择你的身份</div>
        <div class="ai-entry-hero-sub">进入专属空间，开始智能教与学</div>
      </div>

      <div class="ai-entry-actions">
        <button class="ai-entry-card" id="ai-entry-student" type="button">
          <div class="ai-entry-card-icon">🎓</div>
          <div class="ai-entry-card-main">
            <div class="ai-entry-card-title">学生端</div>
            <div class="ai-entry-card-desc">加入课程 · AI问答 · 学习跟踪</div>
          </div>
          <div class="ai-entry-card-arrow">→</div>
        </button>

        <button class="ai-entry-card" id="ai-entry-teacher" type="button">
          <div class="ai-entry-card-icon">🧑‍🏫</div>
          <div class="ai-entry-card-main">
            <div class="ai-entry-card-title">教师端</div>
            <div class="ai-entry-card-desc">创建课程 · 课件管理 · 学情洞察</div>
          </div>
          <div class="ai-entry-card-arrow">→</div>
        </button>
      </div>
    </div>
  `;
  panel.appendChild(viewEntry);

  // 2. Class List
  const viewClass = document.createElement("div");
  viewClass.className = "ai-view";
  viewClass.innerHTML = `
    <div class="ai-panel-header">
      <div class="ai-header-left">
        <span class="ai-back-btn">←</span>
        <span class="ai-header-title">我的课堂</span>
      </div>
      <div class="ai-header-actions">
        <div class="ai-close-btn" title="关闭">×</div>
      </div>
    </div>
    <div class="ai-stage">
      <div id="ai-course-list-content" class="ai-scroll"></div>
      <div class="ai-bottom-action" id="ai-btn-add-class">+ 增添新课堂</div>
    </div>
  `;
  panel.appendChild(viewClass);

  // 3. Add Class
  const viewAdd = document.createElement("div");
  viewAdd.className = "ai-view";
  viewAdd.innerHTML = `
    <div class="ai-panel-header">
      <div class="ai-header-left">
        <span class="ai-back-btn">←</span>
        <span class="ai-header-title">添加课堂</span>
      </div>
      <div class="ai-header-actions">
        <div class="ai-close-btn" title="关闭">×</div>
      </div>
    </div>
    <div class="ai-stage">
      <div class="ai-scroll">
        <input type="text" class="ai-form-input" id="ai-add-name" placeholder="课程名称（例如：高等数学）" />
        <div class="ai-tab-group">
          <div class="ai-tab-btn active" data-target="url">URL 链接</div>
          <div class="ai-tab-btn" data-target="file">文件上传</div>
        </div>
        <div id="ai-add-url-box">
          <input type="text" class="ai-form-input" id="ai-add-url" placeholder="输入网课/资料链接" />
        </div>
        <div id="ai-add-file-box" style="display:none">
          <div class="ai-upload-zone" id="ai-upload-zone">
            点击选择 PDF/PPT
            <div id="ai-file-display" class="ai-file-display"></div>
          </div>
          <input type="file" id="ai-file-input" accept=".pdf,.pptx" style="display:none" />
        </div>
      </div>
      <div class="ai-bottom-action" id="ai-btn-confirm-add">确认添加</div>
    </div>
  `;
  panel.appendChild(viewAdd);

  // 4. Chat
  const viewChat = document.createElement("div");
  viewChat.className = "ai-view";
  viewChat.innerHTML = `
    <div class="ai-panel-header">
      <div class="ai-header-left">
        <span class="ai-back-btn">←</span>
        <div class="ai-brand">
          <div class="ai-brand-title" id="ai-chat-header-title">对话</div>
          <div class="ai-brand-sub">随问随答 · 连贯讲解</div>
        </div>
      </div>
      <div class="ai-header-actions">
        <div class="ai-menu-btn" id="ai-chat-menu-btn">⋯</div>
        <div class="ai-menu-btn" id="ai-chat-new-btn">✎</div>
        <div class="ai-close-btn">×</div>
        <div class="ai-menu-dropdown" id="ai-chat-menu" style="display:none">
          <div class="ai-menu-item" id="ai-menu-switch">切换对话</div>
          <div class="ai-menu-item danger" id="ai-menu-delete">删除对话</div>
        </div>
      </div>
    </div>
    <div class="ai-chat-container">
      <div class="ai-messages" id="ai-messages-box"></div>
      <div class="ai-input-area">
        <button class="ai-voice-btn" id="ai-voice-lecture" title="语音讲授">🎙️</button>
        <input type="text" class="ai-input" id="ai-chat-input" placeholder="问小星：比如“这节课讲到哪了？”" />
        <button class="ai-send-btn" id="ai-chat-send">➤</button>
      </div>
    </div>
  `;
  panel.appendChild(viewChat);

  // 5. Auth
  const viewAuth = document.createElement("div");
  viewAuth.className = "ai-view";
  viewAuth.innerHTML = `
    <div class="ai-panel-header">
      <div class="ai-header-left">
        <span class="ai-back-btn">←</span>
        <div class="ai-brand">
          <div class="ai-brand-title" id="ai-auth-title">账号</div>
          <div class="ai-brand-sub" id="ai-auth-sub">登录 / 注册</div>
        </div>
      </div>
      <div class="ai-header-actions">
        <div class="ai-close-btn" title="关闭">×</div>
      </div>
    </div>
    <div class="ai-stage">
      <div class="ai-scroll">
        <div class="ai-tab-group" id="ai-auth-tabs">
          <div class="ai-tab-btn active" data-target="login">登录</div>
          <div class="ai-tab-btn" data-target="register">注册</div>
        </div>

        <div id="ai-auth-login-box">
          <input class="ai-form-input" id="ai-login-username" placeholder="用户名" />
          <input class="ai-form-input" id="ai-login-password" placeholder="密码" type="password" />
        </div>

        <div id="ai-auth-register-box" style="display:none">
          <div class="ai-tab-group" id="ai-register-role">
            <div class="ai-tab-btn active" data-role="student">学生</div>
            <div class="ai-tab-btn" data-role="teacher">教师</div>
          </div>

          <input class="ai-form-input" id="ai-reg-username" placeholder="用户名" />
          <input class="ai-form-input" id="ai-reg-password" placeholder="密码（至少 6 位）" type="password" />
          <input class="ai-form-input" id="ai-reg-nickname" placeholder="昵称" />
          <input class="ai-form-input" id="ai-reg-school" placeholder="学校" />

          <div id="ai-reg-student-extra">
            <input class="ai-form-input" id="ai-reg-student-no" placeholder="学号" />
            <input class="ai-form-input" id="ai-reg-major" placeholder="专业" />
            <input class="ai-form-input" id="ai-reg-grade" placeholder="年级" />
          </div>

          <div id="ai-reg-teacher-extra" style="display:none">
            <input class="ai-form-input" id="ai-reg-teacher-no" placeholder="工号" />
            <input class="ai-form-input" id="ai-reg-dept" placeholder="院系" />
            <input class="ai-form-input" id="ai-reg-title" placeholder="职称（可选）" />
          </div>
        </div>

        <div class="ai-empty" style="margin-top: 10px;">
          登录后即可进入学生端 / 教师端
        </div>
      </div>
      <div class="ai-bottom-action" id="ai-auth-submit">继续</div>
    </div>
  `;
  panel.appendChild(viewAuth);

  // 6. Student
  const viewStudent = document.createElement("div");
  viewStudent.className = "ai-view";
  viewStudent.innerHTML = `
    <div class="ai-panel-header">
      <div class="ai-header-left">
        <span class="ai-back-btn">←</span>
        <div class="ai-brand">
          <div class="ai-brand-title" id="ai-student-title">学生端</div>
          <div class="ai-brand-sub" id="ai-student-sub">我的课程与学习</div>
        </div>
      </div>
      <div class="ai-header-actions">
        <div class="ai-icon-btn" id="ai-student-me" title="个人中心">👤</div>
        <div class="ai-close-btn" title="关闭">×</div>
      </div>
    </div>
    <div class="ai-stage">
      <div class="ai-scroll">
        <div class="ai-student-hero">
          <div class="ai-student-hero-title">我的课程</div>
          <div class="ai-student-hero-sub" id="ai-student-hero-sub">—</div>
          <div class="ai-student-hero-actions">
            <button class="ai-primary-btn" id="ai-student-ai" type="button">AI问答</button>
            <button class="ai-ghost-btn" id="ai-student-profile" type="button">个人中心</button>
          </div>
        </div>

        <div class="ai-join-card">
          <div class="ai-join-title">输入课程码加入课程</div>
          <div class="ai-input-row">
            <input class="ai-form-input ai-join-input" id="ai-student-join-code" placeholder="课程码（例如：A1B2C3）" />
            <button class="ai-join-btn" id="ai-student-join-btn" type="button">加入</button>
          </div>
          <div class="ai-join-hint">向任课老师获取课程码</div>
        </div>

        <div class="ai-section-title">已加入课程</div>
        <div id="ai-student-course-list" style="margin-top: 8px;"></div>
      </div>
    </div>
  `;
  panel.appendChild(viewStudent);

  // 7. Teacher
  const viewTeacher = document.createElement("div");
  viewTeacher.className = "ai-view";
  viewTeacher.innerHTML = `
    <div class="ai-panel-header">
      <div class="ai-header-left">
        <span class="ai-back-btn">←</span>
        <div class="ai-brand">
          <div class="ai-brand-title" id="ai-teacher-title">教师端</div>
          <div class="ai-brand-sub">课程 · 学生 · 课件</div>
        </div>
      </div>
      <div class="ai-header-actions">
        <div class="ai-icon-btn" id="ai-teacher-me" title="个人中心">👤</div>
        <div class="ai-close-btn" title="关闭">×</div>
      </div>
    </div>
    <div class="ai-stage">
      <div class="ai-scroll">
        <div class="ai-teacher-hero">
          <div class="ai-teacher-hero-title">我的课程</div>
          <div class="ai-teacher-hero-sub" id="ai-teacher-hero-sub">—</div>
          <div class="ai-teacher-hero-actions">
            <button class="ai-primary-btn" id="ai-teacher-create-btn" type="button">创建课程</button>
            <button class="ai-ghost-btn" id="ai-teacher-profile" type="button">个人中心</button>
          </div>
        </div>

        <div class="ai-section-title">课程列表</div>
        <div id="ai-teacher-course-list" style="margin-top: 8px;"></div>

        <div class="ai-section-title">课程管理</div>
        <div id="ai-teacher-course-detail" style="margin-top: 8px;"></div>
      </div>
    </div>
  `;
  panel.appendChild(viewTeacher);

  // 8. Me
  const viewMe = document.createElement("div");
  viewMe.className = "ai-view";
  viewMe.innerHTML = `
    <div class="ai-panel-header">
      <div class="ai-header-left">
        <span class="ai-back-btn">←</span>
        <div class="ai-brand">
          <div class="ai-brand-title">个人中心</div>
          <div class="ai-brand-sub">账号与数据</div>
        </div>
      </div>
      <div class="ai-header-actions">
        <div class="ai-close-btn" title="关闭">×</div>
      </div>
    </div>
    <div class="ai-stage">
      <div class="ai-scroll" id="ai-me-content"></div>
      <div class="ai-bottom-action" id="ai-me-logout">退出登录</div>
    </div>
  `;
  panel.appendChild(viewMe);

  // --- Logic ---

  // Draggable FAB
  let isDragging = false;
  let dragStartTime = 0;

  fab.addEventListener("mousedown", (e) => {
    isDragging = false;
    dragStartTime = Date.now();

    const shiftX = e.clientX - fab.getBoundingClientRect().left;
    const shiftY = e.clientY - fab.getBoundingClientRect().top;

    function moveAt(pageX, pageY) {
      isDragging = true;
      fab.style.left = pageX - shiftX + "px";
      fab.style.top = pageY - shiftY + "px";
      fab.style.right = "auto"; // Disable right positioning once dragged
      fab.style.bottom = "auto";
    }

    function onMouseMove(event) {
      moveAt(event.clientX, event.clientY);
    }

    document.addEventListener("mousemove", onMouseMove);

    fab.onmouseup = function () {
      document.removeEventListener("mousemove", onMouseMove);
      fab.onmouseup = null;
    };
  });

  fab.ondragstart = function () {
    return false;
  };

  fab.addEventListener("click", (e) => {
    if (Date.now() - dragStartTime < 200) {
      // Only toggle if it was a quick click, not a drag
      togglePanel();
    }
  });

  function togglePanel(show) {
    const isOpen = panel.classList.contains("open");
    if (show === undefined) show = !isOpen;
    if (show) panel.classList.add("open");
    else panel.classList.remove("open");
    if (show && !State.auth.token) {
      switchView(viewEntry);
    }
  }

  function switchView(viewElement) {
    [
      viewEntry,
      viewClass,
      viewAdd,
      viewChat,
      viewAuth,
      viewStudent,
      viewTeacher,
      viewMe,
    ].forEach((v) => v.classList.remove("active"));
    viewElement.classList.add("active");
    if (viewElement === viewEntry) State.view = "entry";
    if (viewElement === viewClass) State.view = "class_select";
    if (viewElement === viewAdd) State.view = "add_class";
    if (viewElement === viewChat) State.view = "chat";
    if (viewElement === viewAuth) State.view = "auth";
    if (viewElement === viewStudent) State.view = "student";
    if (viewElement === viewTeacher) State.view = "teacher";
    if (viewElement === viewMe) State.view = "me";
  }

  // Close & Back Handlers
  document
    .querySelectorAll(".ai-close-btn")
    .forEach((btn) => (btn.onclick = () => togglePanel(false)));

  viewClass.querySelector(".ai-back-btn").onclick = async () => {
    if (!State.auth.token) {
      switchView(viewEntry);
      return;
    }
    if (State.auth.role === "teacher") await enterTeacherHome();
    else await enterStudentHome();
  };
  viewAdd.querySelector(".ai-back-btn").onclick = () => switchView(viewClass);
  viewChat.querySelector(".ai-back-btn").onclick = () => {
    if (State.platform.courseId && State.auth.token) {
      if (State.auth.role === "teacher") switchView(viewTeacher);
      else switchView(viewStudent);
      return;
    }
    if (State.auth.token) {
      if (State.auth.role === "teacher") switchView(viewTeacher);
      else switchView(viewStudent);
      return;
    }
    switchView(viewEntry);
  };
  viewAuth.querySelector(".ai-back-btn").onclick = () => {
    if (!State.auth.token) {
      switchView(viewEntry);
      return;
    }
    if (State.auth.role === "teacher") switchView(viewTeacher);
    else switchView(viewStudent);
  };
  viewStudent.querySelector(".ai-back-btn").onclick = () => togglePanel(false);
  viewTeacher.querySelector(".ai-back-btn").onclick = () => togglePanel(false);
  viewMe.querySelector(".ai-back-btn").onclick = () => {
    if (!State.auth.token) {
      switchView(viewEntry);
      return;
    }
    if (State.auth.role === "teacher") switchView(viewTeacher);
    else switchView(viewStudent);
  };

  function refreshHeaderAuthUI() {
    const accountBtn = document.getElementById("ai-btn-account");
    const consoleBtn = document.getElementById("ai-btn-console");
    if (accountBtn) {
      accountBtn.title = State.auth.token ? "个人中心" : "登录 / 注册";
    }
    if (consoleBtn) {
      if (State.auth.token) {
        consoleBtn.classList.remove("ai-disabled");
        consoleBtn.removeAttribute("aria-disabled");
        consoleBtn.title = State.auth.role === "teacher" ? "教师端" : "学生端";
      } else {
        consoleBtn.classList.add("ai-disabled");
        consoleBtn.setAttribute("aria-disabled", "true");
        consoleBtn.title = "控制台（需登录）";
      }
    }
  }

  initAuth().then(async () => {
    refreshHeaderAuthUI();
    if (!State.auth.token) {
      switchView(viewEntry);
      return;
    }
    if (State.auth.role === "teacher") await enterTeacherHome();
    else await enterStudentHome();
  });

  async function openMe() {
    const box = document.getElementById("ai-me-content");
    if (box) box.innerHTML = "";
    if (!State.auth.token || !State.auth.profile) {
      const empty = document.createElement("div");
      empty.className = "ai-empty";
      empty.innerText = "你还没登录";
      if (box) box.appendChild(empty);
      switchView(viewMe);
      return;
    }
    const p = State.auth.profile;
    const roleText = p.role === "teacher" ? "教师" : "学生";
    const studentNo =
      p.role === "student" && p.student ? p.student.student_no || "" : "";
    const major =
      p.role === "student" && p.student ? p.student.major || "" : "";
    const grade =
      p.role === "student" && p.student ? p.student.grade || "" : "";
    const teacherNo =
      p.role === "teacher" && p.teacher ? p.teacher.teacher_no || "" : "";
    const department =
      p.role === "teacher" && p.teacher ? p.teacher.department || "" : "";
    const title =
      p.role === "teacher" && p.teacher ? p.teacher.title || "" : "";

    if (box) {
      box.innerHTML = `
        <div class="ai-profile-card">
          <div class="ai-profile-title">基本信息</div>
          <div class="ai-field">
            <div class="ai-field-label">角色</div>
            <div class="ai-field-static">${roleText}</div>
          </div>
          <div class="ai-field">
            <div class="ai-field-label">用户名</div>
            <div class="ai-field-static">${p.username || ""}</div>
          </div>
          <div class="ai-field">
            <div class="ai-field-label">昵称</div>
            <input class="ai-form-input" id="ai-me-nickname" value="${String(
              p.nickname || "",
            ).replaceAll('"', "&quot;")}" />
          </div>
          <div class="ai-field">
            <div class="ai-field-label">学校</div>
            <input class="ai-form-input" id="ai-me-school" value="${String(
              p.school || "",
            ).replaceAll('"', "&quot;")}" />
          </div>
        </div>

        ${
          p.role === "student"
            ? `
              <div class="ai-profile-card">
                <div class="ai-profile-title">学生信息</div>
                <div class="ai-field">
                  <div class="ai-field-label">学号</div>
                  <input class="ai-form-input" id="ai-me-student-no" value="${String(
                    studentNo,
                  ).replaceAll('"', "&quot;")}" />
                </div>
                <div class="ai-field">
                  <div class="ai-field-label">专业</div>
                  <input class="ai-form-input" id="ai-me-major" value="${String(
                    major,
                  ).replaceAll('"', "&quot;")}" />
                </div>
                <div class="ai-field">
                  <div class="ai-field-label">年级</div>
                  <input class="ai-form-input" id="ai-me-grade" value="${String(
                    grade,
                  ).replaceAll('"', "&quot;")}" />
                </div>
              </div>
            `
            : `
              <div class="ai-profile-card">
                <div class="ai-profile-title">教师信息</div>
                <div class="ai-field">
                  <div class="ai-field-label">工号</div>
                  <input class="ai-form-input" id="ai-me-teacher-no" value="${String(
                    teacherNo,
                  ).replaceAll('"', "&quot;")}" />
                </div>
                <div class="ai-field">
                  <div class="ai-field-label">院系</div>
                  <input class="ai-form-input" id="ai-me-department" value="${String(
                    department,
                  ).replaceAll('"', "&quot;")}" />
                </div>
                <div class="ai-field">
                  <div class="ai-field-label">职称</div>
                  <input class="ai-form-input" id="ai-me-title" value="${String(
                    title,
                  ).replaceAll('"', "&quot;")}" />
                </div>
              </div>
            `
        }

        <button class="ai-primary-btn ai-profile-save" id="ai-me-save" type="button">保存修改</button>
      `;
    }

    const btnSave = document.getElementById("ai-me-save");
    if (btnSave) {
      btnSave.onclick = async () => {
        if (!State.auth.token) return;
        btnSave.innerText = "保存中...";
        try {
          const nickname = document
            .getElementById("ai-me-nickname")
            .value.trim();
          const school = document.getElementById("ai-me-school").value.trim();
          let payload = { nickname, school };
          if (p.role === "student") {
            payload.student = {
              student_no: document
                .getElementById("ai-me-student-no")
                .value.trim(),
              major: document.getElementById("ai-me-major").value.trim(),
              grade: document.getElementById("ai-me-grade").value.trim(),
            };
          } else {
            payload.teacher = {
              teacher_no: document
                .getElementById("ai-me-teacher-no")
                .value.trim(),
              department: document
                .getElementById("ai-me-department")
                .value.trim(),
              title:
                document.getElementById("ai-me-title").value.trim() || null,
            };
          }
          const resp = await sendMessagePromise({
            action: "updateProfile",
            token: State.auth.token,
            payload,
          });
          if (!resp || !resp.success)
            throw new Error(resp ? resp.error : "保存失败");
          State.auth.profile = resp.profile;
          State.auth.role = resp.profile.role;
          await persistAuth();
          refreshHeaderAuthUI();
          if (State.auth.role === "teacher") await enterTeacherHome();
          else await enterStudentHome();
          switchView(viewMe);
        } catch (e) {
          alert(e.message || e);
        } finally {
          btnSave.innerText = "保存修改";
        }
      };
    }
    switchView(viewMe);
  }

  const accountBtn = document.getElementById("ai-btn-account");
  if (accountBtn) {
    accountBtn.onclick = async () => {
      if (!State.auth.token) {
        switchView(viewEntry);
        return;
      }
      await openMe();
    };
  }

  document.getElementById("ai-student-me").onclick = () => openMe();
  document.getElementById("ai-teacher-me").onclick = () => openMe();
  const teacherProfileBtn = document.getElementById("ai-teacher-profile");
  if (teacherProfileBtn) teacherProfileBtn.onclick = () => openMe();

  document.getElementById("ai-me-logout").onclick = async () => {
    await clearAuth();
    refreshHeaderAuthUI();
    switchView(viewEntry);
  };

  // Auth UI
  let authTab = "login";
  let registerRole = "student";

  function openRoleAuth(role) {
    const title = document.getElementById("ai-auth-title");
    const sub = document.getElementById("ai-auth-sub");
    if (title) title.innerText = role === "teacher" ? "教师认证" : "学生认证";
    if (sub) sub.innerText = "登录 / 注册";

    authTab = "login";
    document
      .querySelectorAll("#ai-auth-tabs .ai-tab-btn")
      .forEach((b) => b.classList.remove("active"));
    const loginTab = document.querySelector(
      '#ai-auth-tabs .ai-tab-btn[data-target="login"]',
    );
    if (loginTab) loginTab.classList.add("active");
    document.getElementById("ai-auth-login-box").style.display = "block";
    document.getElementById("ai-auth-register-box").style.display = "none";
    document.getElementById("ai-auth-submit").innerText = "登录";

    registerRole = role;
    const roleBox = document.getElementById("ai-register-role");
    if (roleBox) roleBox.style.display = "none";
    viewAuth
      .querySelectorAll("#ai-register-role .ai-tab-btn")
      .forEach((b) => b.classList.remove("active"));
    const activeRoleTab = viewAuth.querySelector(
      `#ai-register-role .ai-tab-btn[data-role="${role}"]`,
    );
    if (activeRoleTab) activeRoleTab.classList.add("active");
    document.getElementById("ai-reg-student-extra").style.display =
      role === "student" ? "block" : "none";
    document.getElementById("ai-reg-teacher-extra").style.display =
      role === "teacher" ? "block" : "none";

    switchView(viewAuth);
  }

  document.getElementById("ai-entry-student").onclick = () =>
    openRoleAuth("student");
  document.getElementById("ai-entry-teacher").onclick = () =>
    openRoleAuth("teacher");

  const studentProfileBtn = document.getElementById("ai-student-profile");
  if (studentProfileBtn) studentProfileBtn.onclick = () => openMe();

  viewAuth.querySelectorAll("#ai-auth-tabs .ai-tab-btn").forEach((btn) => {
    btn.onclick = () => {
      viewAuth
        .querySelectorAll("#ai-auth-tabs .ai-tab-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      authTab = btn.dataset.target;
      document.getElementById("ai-auth-login-box").style.display =
        authTab === "login" ? "block" : "none";
      document.getElementById("ai-auth-register-box").style.display =
        authTab === "register" ? "block" : "none";
      document.getElementById("ai-auth-submit").innerText =
        authTab === "login" ? "登录" : "注册";
    };
  });

  viewAuth.querySelectorAll("#ai-register-role .ai-tab-btn").forEach((btn) => {
    btn.onclick = () => {
      viewAuth
        .querySelectorAll("#ai-register-role .ai-tab-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      registerRole = btn.dataset.role;
      document.getElementById("ai-reg-student-extra").style.display =
        registerRole === "student" ? "block" : "none";
      document.getElementById("ai-reg-teacher-extra").style.display =
        registerRole === "teacher" ? "block" : "none";
    };
  });

  async function refreshPlatformCourses() {
    if (!State.auth.token) return;
    const resp = await sendMessagePromise({
      action: "platformCourseList",
      token: State.auth.token,
    });
    if (resp && resp.success) {
      State.platform.courses = resp.courses || [];
      State.platform.coursesError = null;
    } else {
      State.platform.courses = [];
      State.platform.coursesError = resp ? resp.error : "加载失败";
    }
  }

  function renderStudentCourses() {
    const box = document.getElementById("ai-student-course-list");
    box.innerHTML = "";
    if (State.platform.coursesError) {
      const empty = document.createElement("div");
      empty.className = "ai-empty";
      empty.innerText = `加载失败：${State.platform.coursesError}`;
      box.appendChild(empty);
      return;
    }
    if (!State.platform.courses.length) {
      const empty = document.createElement("div");
      empty.className = "ai-empty";
      empty.innerText = "你还没有加入任何课程";
      box.appendChild(empty);
      return;
    }
    State.platform.courses.forEach((c) => {
      const el = document.createElement("div");
      el.className = "ai-course-item has-actions";
      el.innerHTML = `<div class="ai-course-name">${c.name}</div>`;
      const right = document.createElement("div");
      right.className = "ai-course-actions";
      const btnLeave = document.createElement("button");
      btnLeave.className = "ai-mini-btn danger";
      btnLeave.innerText = "删除";
      btnLeave.onclick = async (e) => {
        e.stopPropagation();
        const ok = confirm(
          `确认从“${c.name}”中退出并删除该课程？（不会影响老师端课程）`,
        );
        if (!ok) return;
        await sendMessagePromise({
          action: "platformCourseLeave",
          token: State.auth.token,
          courseId: c.id,
        });
        await refreshPlatformCourses();
        renderStudentCourses();
      };
      right.appendChild(btnLeave);
      el.appendChild(right);
      el.onclick = () => {
        State.platform.courseId = c.id;
        switchView(viewChat);
        switchToDialog("classroom", c.name);
      };
      box.appendChild(el);
    });
  }

  function renderTeacherCourses() {
    const box = document.getElementById("ai-teacher-course-list");
    const detail = document.getElementById("ai-teacher-course-detail");
    box.innerHTML = "";
    if (detail) detail.innerHTML = "";
    if (State.platform.coursesError) {
      const empty = document.createElement("div");
      empty.className = "ai-empty";
      empty.innerText = `加载失败：${State.platform.coursesError}`;
      box.appendChild(empty);
      return;
    }
    if (!State.platform.courses.length) {
      const empty = document.createElement("div");
      empty.className = "ai-empty";
      empty.innerText = "你还没有创建课程";
      box.appendChild(empty);
      return;
    }
    State.platform.courses.forEach((c) => {
      const el = document.createElement("div");
      el.className = "ai-course-item";
      el.innerHTML = `
        <div class="ai-course-name">${c.name}</div>
        <div class="ai-course-right">
          <span class="ai-chip">学生 ${c.students_count ?? 0}</span>
          <span class="ai-chip">课件 ${c.materials_count ?? 0}</span>
        </div>
      `;
      el.onclick = async () => {
        State.platform.courseId = c.id;
        State.currentCourse = c.name;
        if (!detail) return;
        detail.innerHTML = "";
        detail.innerHTML = `
          <div class="ai-teacher-course-card">
            <div class="ai-teacher-course-top">
              <div class="ai-teacher-course-main">
                <div class="ai-teacher-course-name">${c.name}</div>
                <div class="ai-teacher-course-meta">
                  <span class="ai-chip ai-chip-strong">课程码 ${c.code}</span>
                  <button class="ai-ghost-btn ai-teacher-copy" id="ai-teacher-copy-code" type="button">复制</button>
                </div>
              </div>
            </div>

            <div class="ai-metric-grid">
              <div class="ai-metric">
                <div class="ai-metric-label">学生</div>
                <div class="ai-metric-value" id="ai-teacher-metric-students">${c.students_count ?? 0}</div>
              </div>
              <div class="ai-metric">
                <div class="ai-metric-label">课件</div>
                <div class="ai-metric-value" id="ai-teacher-metric-materials">${c.materials_count ?? 0}</div>
              </div>
              <div class="ai-metric">
                <div class="ai-metric-label">已解析</div>
                <div class="ai-metric-value" id="ai-teacher-metric-analyzed">—</div>
              </div>
            </div>

            <div class="ai-teacher-actions-row">
              <button class="ai-ghost-btn" id="ai-teacher-ai" type="button">AI问答</button>
              <button class="ai-primary-btn" id="ai-teacher-upload" type="button">上传课件</button>
              <button class="ai-ghost-btn" id="ai-teacher-refresh" type="button">刷新</button>
            </div>

            <div class="ai-tab-group ai-teacher-tabs" id="ai-teacher-tabs">
              <div class="ai-tab-btn active" data-tab="materials">课件</div>
              <div class="ai-tab-btn" data-tab="students">学生管理</div>
              <div class="ai-tab-btn" data-tab="analysis">教学分析</div>
            </div>

            <div class="ai-teacher-panels">
              <div class="ai-teacher-panel active" data-panel="materials">
                <div id="ai-teacher-materials" style="margin-top:8px;"></div>
              </div>
              <div class="ai-teacher-panel" data-panel="students">
                <div class="ai-teacher-inline-actions">
                  <button class="ai-ghost-btn" id="ai-teacher-copy-students" type="button">复制名单</button>
                </div>
                <div id="ai-teacher-members" style="margin-top:8px;"></div>
              </div>
              <div class="ai-teacher-panel" data-panel="analysis">
                <div id="ai-teacher-analysis" style="margin-top:8px;"></div>
              </div>
            </div>
          </div>
        `;

        const btnCopy = document.getElementById("ai-teacher-copy-code");
        if (btnCopy) {
          btnCopy.onclick = async () => {
            try {
              await navigator.clipboard.writeText(c.code);
            } catch (e) {}
          };
        }

        const btnAsk = document.getElementById("ai-teacher-ai");
        if (btnAsk) {
          btnAsk.onclick = () => {
            switchView(viewChat);
            switchToDialog("classroom", c.name);
          };
        }

        const btnUpload = document.getElementById("ai-teacher-upload");
        if (btnUpload) {
          btnUpload.onclick = () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".pdf,.pptx,.docx";
            input.onchange = async () => {
              const file = input.files && input.files[0];
              if (!file) return;
              const reader = new FileReader();
              const base64 = await new Promise((resolve) => {
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(file);
              });
              const resp = await sendMessagePromise({
                action: "materialUpload",
                token: State.auth.token,
                courseId: c.id,
                fileData: base64,
                fileName: file.name,
              });
              if (resp && resp.success) {
                await refreshTeacherMaterials(c.id);
                renderTeacherMetrics();
                renderTeacherAnalysis();
              }
            };
            input.click();
          };
        }

        const btnRefresh = document.getElementById("ai-teacher-refresh");
        if (btnRefresh) {
          btnRefresh.onclick = async () => {
            await refreshTeacherMaterials(c.id);
            await refreshTeacherMembers(c.id);
            renderTeacherMetrics();
            renderTeacherAnalysis();
          };
        }

        const btnCopyStudents = document.getElementById(
          "ai-teacher-copy-students",
        );
        if (btnCopyStudents) {
          btnCopyStudents.onclick = async () => {
            try {
              const names = (State.platform.members || [])
                .map((m) => m.nickname)
                .join("\n");
              await navigator.clipboard.writeText(names || "");
            } catch (e) {}
          };
        }

        function setTeacherTab(tab) {
          const tabs = document.querySelectorAll(
            "#ai-teacher-tabs .ai-tab-btn",
          );
          tabs.forEach((b) => b.classList.remove("active"));
          const active = document.querySelector(
            `#ai-teacher-tabs .ai-tab-btn[data-tab="${tab}"]`,
          );
          if (active) active.classList.add("active");
          const panels = detail.querySelectorAll(".ai-teacher-panel");
          panels.forEach((p) => p.classList.remove("active"));
          const panel = detail.querySelector(
            `.ai-teacher-panel[data-panel="${tab}"]`,
          );
          if (panel) panel.classList.add("active");
        }

        detail.querySelectorAll("#ai-teacher-tabs .ai-tab-btn").forEach((b) => {
          b.onclick = () => setTeacherTab(b.dataset.tab);
        });

        function renderTeacherMetrics() {
          const students = (State.platform.members || []).length;
          const materials = (State.platform.materials || []).length;
          const analyzed = (State.platform.materials || []).filter(
            (m) => m.status === "analyzed",
          ).length;
          const elStudents = document.getElementById(
            "ai-teacher-metric-students",
          );
          const elMaterials = document.getElementById(
            "ai-teacher-metric-materials",
          );
          const elAnalyzed = document.getElementById(
            "ai-teacher-metric-analyzed",
          );
          if (elStudents)
            elStudents.innerText = String(students || c.students_count || 0);
          if (elMaterials)
            elMaterials.innerText = String(materials || c.materials_count || 0);
          if (elAnalyzed) elAnalyzed.innerText = String(analyzed);
        }

        function renderTeacherAnalysis() {
          const boxA = document.getElementById("ai-teacher-analysis");
          if (!boxA) return;
          const students = (State.platform.members || []).length;
          const materials = (State.platform.materials || []).length;
          const analyzed = (State.platform.materials || []).filter(
            (m) => m.status === "analyzed",
          ).length;
          const uploaded = (State.platform.materials || []).filter(
            (m) => m.status === "uploaded",
          ).length;
          const failed = (State.platform.materials || []).filter(
            (m) => m.status === "failed",
          ).length;
          boxA.innerHTML = `
            <div class="ai-analysis-card">
              <div class="ai-analysis-title">教学分析</div>
              <div class="ai-analysis-grid">
                <div class="ai-analysis-item"><div class="ai-analysis-label">学生数</div><div class="ai-analysis-value">${students}</div></div>
                <div class="ai-analysis-item"><div class="ai-analysis-label">课件数</div><div class="ai-analysis-value">${materials}</div></div>
                <div class="ai-analysis-item"><div class="ai-analysis-label">已解析</div><div class="ai-analysis-value">${analyzed}</div></div>
                <div class="ai-analysis-item"><div class="ai-analysis-label">待解析</div><div class="ai-analysis-value">${uploaded}</div></div>
              </div>
              ${
                failed
                  ? `<div class="ai-analysis-warn">有 ${failed} 份课件解析失败，可重新上传或检查文件格式</div>`
                  : ""
              }
            </div>
          `;
        }

        await refreshTeacherMaterials(c.id);
        await refreshTeacherMembers(c.id);
        renderTeacherMetrics();
        renderTeacherAnalysis();
      };
      box.appendChild(el);
    });
  }

  async function refreshTeacherMembers(courseId) {
    const box = document.getElementById("ai-teacher-members");
    if (!box) return;
    box.innerHTML = "";
    const resp = await sendMessagePromise({
      action: "platformCourseMembers",
      token: State.auth.token,
      courseId,
    });
    if (!resp || !resp.success) {
      const empty = document.createElement("div");
      empty.className = "ai-empty";
      empty.innerText = resp ? resp.error : "加载失败";
      box.appendChild(empty);
      State.platform.members = [];
      return;
    }
    State.platform.members = resp.members || [];
    if (!resp.members.length) {
      const empty = document.createElement("div");
      empty.className = "ai-empty";
      empty.innerText = "暂无学生加入";
      box.appendChild(empty);
      return;
    }
    resp.members.forEach((m) => {
      const el = document.createElement("div");
      el.className = "ai-course-item";
      el.style.cursor = "default";
      el.innerHTML = `<div class="ai-course-name">${m.nickname}</div>`;
      box.appendChild(el);
    });
  }

  async function refreshTeacherMaterials(courseId) {
    const box = document.getElementById("ai-teacher-materials");
    if (!box) return;
    box.innerHTML = "";
    const resp = await sendMessagePromise({
      action: "materialList",
      token: State.auth.token,
      courseId,
    });
    if (!resp || !resp.success) {
      const empty = document.createElement("div");
      empty.className = "ai-empty";
      empty.innerText = resp ? resp.error : "加载失败";
      box.appendChild(empty);
      State.platform.materials = [];
      return;
    }
    State.platform.materials = resp.materials || [];
    if (!resp.materials.length) {
      const empty = document.createElement("div");
      empty.className = "ai-empty";
      empty.innerText = "暂无课件";
      box.appendChild(empty);
      return;
    }
    resp.materials.forEach((m) => {
      const el = document.createElement("div");
      el.className = "ai-course-item has-actions";
      el.style.cursor = "default";
      el.innerHTML = `<div class="ai-course-name">${m.filename}</div>`;
      const right = document.createElement("div");
      right.className = "ai-course-actions";
      const tag = document.createElement("div");
      tag.className = "ai-course-meta";
      tag.innerText = m.status;
      const btn = document.createElement("button");
      btn.className = "ai-mini-btn";
      btn.innerText = "解析";
      btn.onclick = async () => {
        await sendMessagePromise({
          action: "materialAnalyze",
          token: State.auth.token,
          materialId: m.id,
        });
        await refreshTeacherMaterials(courseId);
      };
      const btnDel = document.createElement("button");
      btnDel.className = "ai-mini-btn danger";
      btnDel.innerText = "删除";
      btnDel.onclick = async () => {
        const ok = confirm(
          `确认删除课件：${m.filename}？（会同时删除向量库中的该课件内容）`,
        );
        if (!ok) return;
        await sendMessagePromise({
          action: "materialDelete",
          token: State.auth.token,
          materialId: m.id,
        });
        await refreshTeacherMaterials(courseId);
      };
      right.appendChild(tag);
      right.appendChild(btn);
      right.appendChild(btnDel);
      el.appendChild(right);
      box.appendChild(el);
    });
  }

  document.getElementById("ai-auth-submit").onclick = async () => {
    const btn = document.getElementById("ai-auth-submit");
    if (btn.dataset.loading === "1") return;
    btn.dataset.loading = "1";
    btn.disabled = true;
    btn.innerText = "处理中...";
    try {
      if (authTab === "login") {
        const username = document
          .getElementById("ai-login-username")
          .value.trim();
        const password = document
          .getElementById("ai-login-password")
          .value.trim();
        const resp = await sendMessagePromise({
          action: "authLogin",
          payload: { username, password },
        });
        if (!resp || !resp.success)
          throw new Error(resp ? resp.error : "登录失败");
        State.auth.token = resp.token;
        State.auth.role = resp.role;
        await persistAuth();
        await initAuth();
      } else {
        const username = document
          .getElementById("ai-reg-username")
          .value.trim();
        const password = document
          .getElementById("ai-reg-password")
          .value.trim();
        const nickname = document
          .getElementById("ai-reg-nickname")
          .value.trim();
        const school = document.getElementById("ai-reg-school").value.trim();
        let payload = { role: registerRole };
        if (registerRole === "student") {
          payload.student = {
            username,
            password,
            nickname,
            school,
            student_no: document
              .getElementById("ai-reg-student-no")
              .value.trim(),
            major: document.getElementById("ai-reg-major").value.trim(),
            grade: document.getElementById("ai-reg-grade").value.trim(),
          };
        } else {
          payload.teacher = {
            username,
            password,
            nickname,
            school,
            teacher_no: document
              .getElementById("ai-reg-teacher-no")
              .value.trim(),
            department: document.getElementById("ai-reg-dept").value.trim(),
            title: document.getElementById("ai-reg-title").value.trim() || null,
          };
        }
        const resp = await sendMessagePromise({
          action: "authRegister",
          payload,
        });
        if (!resp || !resp.success)
          throw new Error(resp ? resp.error : "注册失败");
        State.auth.token = resp.token;
        State.auth.role = resp.role;
        await persistAuth();
        await initAuth();
      }

      refreshHeaderAuthUI();
      await refreshPlatformCourses();
      if (State.auth.role === "teacher") {
        renderTeacherCourses();
        switchView(viewTeacher);
      } else {
        renderStudentCourses();
        switchView(viewStudent);
      }
    } catch (e) {
      alert(e.message || e);
    } finally {
      btn.disabled = false;
      btn.dataset.loading = "0";
      btn.innerText = authTab === "login" ? "登录" : "注册";
    }
  };

  async function joinCourseByCode(code) {
    const v = (code || "").trim();
    if (!v) {
      alert("请输入课程码");
      return;
    }
    const resp = await sendMessagePromise({
      action: "platformCourseJoin",
      token: State.auth.token,
      payload: { code: v },
    });
    if (resp && resp.success) {
      const input = document.getElementById("ai-student-join-code");
      if (input) input.value = "";
      await refreshPlatformCourses();
      renderStudentCourses();
    } else {
      alert(resp ? resp.error : "加入失败");
    }
  }

  const joinBtn = document.getElementById("ai-student-join-btn");
  if (joinBtn) {
    joinBtn.onclick = async () => {
      const code = document.getElementById("ai-student-join-code")?.value || "";
      await joinCourseByCode(code);
    };
  }

  const joinInput = document.getElementById("ai-student-join-code");
  if (joinInput) {
    joinInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        await joinCourseByCode(joinInput.value || "");
      }
    });
  }

  document.getElementById("ai-student-ai").onclick = async () => {
    State.platform.courseId = null;
    switchView(viewChat);
    await switchToDialog("free", null);
  };

  document.getElementById("ai-teacher-create-btn").onclick = async () => {
    const name = window.prompt("输入课程名称");
    if (!name) return;
    const resp = await sendMessagePromise({
      action: "platformCourseCreate",
      token: State.auth.token,
      payload: { name },
    });
    if (!resp || !resp.success) {
      alert(resp ? resp.error : "创建失败");
      return;
    }
    await refreshPlatformCourses();
    renderTeacherCourses();
  };

  async function enterStudentHome() {
    await refreshPlatformCourses();
    if (State.auth.profile) {
      document.getElementById("ai-student-title").innerText =
        State.auth.profile.nickname || "学生端";
    }
    const heroSub = document.getElementById("ai-student-hero-sub");
    if (heroSub)
      heroSub.innerText = `已加入 ${State.platform.courses.length} 门课程`;
    renderStudentCourses();
    switchView(viewStudent);
  }

  async function enterTeacherHome() {
    await refreshPlatformCourses();
    if (State.auth.profile) {
      document.getElementById("ai-teacher-title").innerText =
        State.auth.profile.nickname || "教师端";
    }
    const heroSub = document.getElementById("ai-teacher-hero-sub");
    if (heroSub)
      heroSub.innerText = `共创建 ${State.platform.courses.length} 门课程`;
    renderTeacherCourses();
    switchView(viewTeacher);
  }

  const consoleBtn = document.getElementById("ai-btn-console");
  if (consoleBtn) {
    consoleBtn.onclick = async () => {
      if (!State.auth.token) {
        switchView(viewEntry);
        return;
      }
      if (State.auth.role === "teacher") await enterTeacherHome();
      else await enterStudentHome();
    };
  }

  // Course List Rendering
  function renderClassList() {
    const container = document.getElementById("ai-course-list-content");
    container.innerHTML = "";
    if (State.coursesError) {
      const wrap = document.createElement("div");
      wrap.className = "ai-empty";
      wrap.innerText = `课程加载失败：${State.coursesError}`;

      const retry = document.createElement("div");
      retry.className = "ai-retry-btn";
      retry.innerText = "重试";
      retry.onclick = () => loadCourses();

      container.appendChild(wrap);
      container.appendChild(retry);
      return;
    }
    if (State.courses.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ai-empty";
      empty.innerText = "暂无课程，先添加一门再开始吧";
      container.appendChild(empty);
      return;
    }
    State.courses.forEach((course) => {
      const el = document.createElement("div");
      el.className = "ai-course-item";
      const name = typeof course === "object" ? course.name : course;
      el.innerHTML = `<div class="ai-course-name">${name}</div>`;
      el.onclick = () => {
        State.platform.courseId = null;
        switchView(viewChat);
        switchToDialog("classroom", name);
      };
      container.appendChild(el);
    });
  }

  document.getElementById("ai-btn-add-class").onclick = () =>
    switchView(viewAdd);

  // Add Class Logic
  let addType = "url";
  viewAdd.querySelectorAll(".ai-tab-btn").forEach((btn) => {
    btn.onclick = () => {
      viewAdd
        .querySelectorAll(".ai-tab-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      addType = btn.dataset.target;
      document.getElementById("ai-add-url-box").style.display =
        addType === "url" ? "block" : "none";
      document.getElementById("ai-add-file-box").style.display =
        addType === "file" ? "block" : "none";
    };
  });

  const fileInput = document.getElementById("ai-file-input");
  document.getElementById("ai-upload-zone").onclick = () => fileInput.click();
  fileInput.onchange = () => {
    if (fileInput.files.length)
      document.getElementById("ai-file-display").innerText =
        fileInput.files[0].name;
  };

  document.getElementById("ai-btn-confirm-add").onclick = async () => {
    const name = document.getElementById("ai-add-name").value.trim();
    if (!name) return alert("请输入课程名称");

    const btn = document.getElementById("ai-btn-confirm-add");
    btn.innerText = "处理中...";

    try {
      if (addType === "url") {
        const url = document.getElementById("ai-add-url").value.trim();
        if (!url) throw new Error("请输入URL");
        await sendMessagePromise({
          action: "addCourseUrl",
          url,
          course_name: name,
        });
      } else {
        const file = fileInput.files[0];
        if (!file) throw new Error("请选择文件");
        const reader = new FileReader();
        const base64 = await new Promise((resolve) => {
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        await sendMessagePromise({
          action: "uploadCourseFile",
          fileData: base64,
          fileName: file.name,
          course_name: name,
        });
      }
      alert("添加成功");
      loadCourses();
      switchView(viewClass);
    } catch (e) {
      alert("失败: " + e.message || e);
    } finally {
      btn.innerText = "确认添加";
    }
  };

  function sendMessagePromise(payload) {
    return new Promise((resolve, reject) => {
      try {
        if (typeof chrome === "undefined" || !chrome.runtime) {
          reject(new Error("插件未就绪，请刷新页面后重试"));
          return;
        }
        chrome.runtime.sendMessage(payload, (resp) => {
          const lastErr =
            chrome.runtime && chrome.runtime.lastError
              ? chrome.runtime.lastError.message
              : null;
          if (lastErr) {
            if (lastErr.includes("Extension context invalidated")) {
              reject(new Error("插件已重新加载，请刷新页面后重试"));
              return;
            }
            reject(new Error(lastErr));
            return;
          }
          if (resp && resp.success) resolve(resp);
          else reject(new Error(resp ? resp.error : "Unknown error"));
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // Chat Logic
  const msgsBox = document.getElementById("ai-messages-box");
  const input = document.getElementById("ai-chat-input");
  const sendBtn = document.getElementById("ai-chat-send");
  const voiceBtn = document.getElementById("ai-voice-lecture");

  let isSpeaking = false;
  let isListening = false;
  let synth = window.speechSynthesis;
  let recognition = null;

  // Initialize Speech Recognition
  if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      isListening = true;
      voiceBtn.classList.add("speaking");
      voiceBtn.innerHTML = "🛑"; // Stop recording icon
      voiceBtn.title = "停止录音";
      input.placeholder = "正在聆听...";
    };

    recognition.onend = () => {
      isListening = false;
      if (!isSpeaking) {
        voiceBtn.classList.remove("speaking");
        voiceBtn.innerHTML = "🎙️";
        voiceBtn.title = "语音问答";
        input.placeholder = "输入问题...";
      }
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      input.value = transcript;
      handleSend(true); // Auto-send in lecture mode (TTS enabled)
    };

    recognition.onerror = (event) => {
      console.error("Recognition error:", event.error);
      isListening = false;
      voiceBtn.classList.remove("speaking");
      voiceBtn.innerHTML = "🎙️";
      input.placeholder = "输入问题...";
      if (event.error === "not-allowed") {
        alert("请允许麦克风权限以使用语音功能");
      }
    };
  } else {
    voiceBtn.style.display = "none"; // Hide if not supported
    console.warn("Speech Recognition API not supported in this browser.");
  }

  function appendMsg(role, text, persist = true, sources = null) {
    const div = document.createElement("div");
    div.className = `ai-message ${role}`;
    if (role === "ai" && persist) {
      if (cancelTyping) {
        cancelTyping();
        cancelTyping = null;
      }
      isTyping = true;
      updateSendBtn();
      cancelTyping = typewriterPrint(div, text, () => {
        if (cancelTyping) cancelTyping = null;
        isTyping = false;
        updateSendBtn();
        if (
          role === "ai" &&
          sources &&
          Array.isArray(sources) &&
          sources.length
        ) {
          appendSourcesBlock(sources);
        }
      });
    } else {
      div.innerText = text;
    }
    msgsBox.appendChild(div);
    msgsBox.scrollTop = msgsBox.scrollHeight;
    if (
      role === "ai" &&
      (!persist || !cancelTyping) &&
      sources &&
      Array.isArray(sources) &&
      sources.length
    ) {
      appendSourcesBlock(sources);
    }
    if (!persist) return;
    const scope = ensureScope(State.mode, State.currentCourse);
    const session = ensureSession(scope);
    const msg = { role, text, ts: Date.now() };
    if (role === "ai" && sources && Array.isArray(sources) && sources.length) {
      msg.sources = sources;
    }
    session.messages = session.messages || [];
    session.messages.push(msg);
    session.updatedAt = Date.now();
    if (
      role === "user" &&
      (!session.title || /^对话\s+\d+$/.test(session.title)) &&
      session.messages.filter((m) => m.role === "user").length === 1
    ) {
      session.title = String(text).slice(0, 16);
    }
    State.history = session.messages;
    persistDialogs();
  }

  function appendSourcesBlock(sources) {
    const items = (sources || [])
      .map((s) => {
        if (!s) return null;
        if (typeof s === "string") return null;
        return {
          fileName: String(s.fileName || s.file_name || ""),
          page: Number.isFinite(Number(s.page || s.page_num))
            ? Number(s.page || s.page_num)
            : 0,
          text: String(s.text || ""),
        };
      })
      .filter(
        (it) => it && (it.fileName || it.page) && it.text && it.text.trim(),
      );
    if (!items.length) return;

    const seen = new Set();
    const uniq = [];
    items.forEach((it) => {
      const k = `${it.fileName}#${it.page}`;
      if (seen.has(k)) return;
      seen.add(k);
      uniq.push(it);
    });
    if (!uniq.length) return;

    const box = document.createElement("div");
    box.className = "ai-source-block";
    uniq.slice(0, 5).forEach((it) => {
      const line = document.createElement("div");
      line.className = "ai-source-item";
      const name = it.fileName ? it.fileName : "课件";
      const page = it.page ? ` 第${it.page}页` : "";
      line.innerText = `来源：${name}${page}`;
      box.appendChild(line);
    });

    msgsBox.appendChild(box);
    msgsBox.scrollTop = msgsBox.scrollHeight;
  }
  function appendSystemMsg(text) {
    appendMsg("ai", text);
  }

  function speakText(text) {
    if (!synth) return alert("您的浏览器不支持语音合成");
    if (synth.speaking) synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 1.0;

    utterance.onstart = () => {
      isSpeaking = true;
      voiceBtn.classList.add("speaking");
      voiceBtn.innerHTML = "⏹"; // Stop icon
      voiceBtn.title = "停止朗读";
    };

    utterance.onend = () => {
      isSpeaking = false;
      voiceBtn.classList.remove("speaking");
      voiceBtn.innerHTML = "🎙️";
      voiceBtn.title = "语音问答";
    };

    utterance.onerror = (e) => {
      console.error("Speech error:", e);
      isSpeaking = false;
      voiceBtn.classList.remove("speaking");
      voiceBtn.innerHTML = "🎙️";
      voiceBtn.title = "语音问答";
    };

    synth.speak(utterance);
  }

  voiceBtn.onclick = () => {
    // 1. If AI is speaking, stop speaking
    if (isSpeaking) {
      synth.cancel();
      isSpeaking = false;
      voiceBtn.classList.remove("speaking");
      voiceBtn.innerHTML = "🎙️";
      voiceBtn.title = "语音问答";
      return;
    }

    // 2. If listening, stop listening
    if (isListening) {
      recognition.stop();
      isListening = false;
      return;
    }

    // 3. Start listening
    try {
      recognition.start();
    } catch (e) {
      console.error(e);
    }
  };

  let inFlight = false;
  let isTyping = false;
  let cancelTyping = null;
  let activeLoadingMsg = null;

  function updateSendBtn() {
    const busy = inFlight || isTyping;
    sendBtn.innerText = busy ? "⏹" : "➤";
    sendBtn.title = busy ? "停止" : "发送";
  }

  function stopCurrent() {
    const shouldAbort = inFlight;
    inFlight = false;
    fab.classList.remove("thinking");
    if (activeLoadingMsg) {
      activeLoadingMsg.remove();
      activeLoadingMsg = null;
    }
    if (cancelTyping) {
      cancelTyping();
      cancelTyping = null;
    }
    isTyping = false;
    if (shouldAbort && typeof chrome !== "undefined" && chrome.runtime) {
      try {
        chrome.runtime.sendMessage({ action: "stopGeneration" }, () => {});
      } catch (e) {}
    }
    if (synth && synth.speaking) synth.cancel();
    updateSendBtn();
  }

  function typewriterPrint(el, text, onDone) {
    el.innerText = "";
    let i = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (i < text.length) {
        el.innerText += text[i++];
        msgsBox.scrollTop = msgsBox.scrollHeight;
        setTimeout(tick, 15);
      } else {
        el.innerText = text;
        msgsBox.scrollTop = msgsBox.scrollHeight;
        if (onDone) onDone();
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }

  function buildChatHistoryText(maxChars = 1600, maxMessages = 10) {
    const scope = ensureScope(State.mode, State.currentCourse);
    const session = ensureSession(scope);
    const msgs = (session.messages || []).slice(-maxMessages);
    const lines = msgs
      .filter((m) => m && (m.role === "user" || m.role === "ai"))
      .map((m) => `${m.role === "user" ? "用户" : "小星"}：${m.text}`);
    let out = lines.join("\n").trim();
    if (out.length > maxChars) out = out.slice(out.length - maxChars);
    return out;
  }

  async function handleSend(isLecture = false) {
    const text = input.value.trim();
    if (!text) return;

    if (inFlight || isTyping) stopCurrent();
    inFlight = true;
    updateSendBtn();

    appendMsg("user", text);
    input.value = "";

    const loadingMsg = document.createElement("div");
    loadingMsg.className = "ai-message ai ai-loading";
    loadingMsg.innerText = isLecture ? "正在准备讲义..." : "思考中...";
    msgsBox.appendChild(loadingMsg);
    activeLoadingMsg = loadingMsg;

    // Start Thinking Animation
    fab.classList.add("thinking");

    try {
      const chatHistory = buildChatHistoryText();
      let resp;

      if (State.platform.courseId && State.auth.token) {
        const askPayload = {
          query: text,
          course_id: State.platform.courseId,
          lecture_mode: isLecture,
          chat_history: chatHistory,
        };
        resp = await sendMessagePromise({
          action: "chatAsk",
          token: State.auth.token,
          payload: askPayload,
        });
      } else {
        let payload = {
          action: "analyzeImage",
          query: text,
          document_url: window.location.href,
          course_name:
            State.mode === "classroom" ? State.currentCourse : "General",
          lecture_mode: isLecture,
          chat_history: chatHistory,
        };

        if (State.mode === "classroom") {
          payload.page_context = document.body.innerText.substring(0, 20000);
        }

        resp = await sendMessagePromise(payload);
      }
      inFlight = false;
      if (activeLoadingMsg) {
        activeLoadingMsg.remove();
        activeLoadingMsg = null;
      }
      appendMsg("ai", resp.answer, true, resp.sources || null);

      if (isLecture) {
        speakText(resp.answer);
      }
    } catch (e) {
      loadingMsg.innerText = "出错: " + (e.message || e);
    } finally {
      inFlight = false;
      updateSendBtn();
      // Stop Thinking Animation
      fab.classList.remove("thinking");
    }
  }

  updateSendBtn();
  sendBtn.onclick = () => {
    if (inFlight || isTyping) {
      stopCurrent();
      return;
    }
    handleSend(false);
  };
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      if (inFlight || isTyping) {
        stopCurrent();
        return;
      }
      handleSend(false);
    }
  };

  const chatMenuBtn = document.getElementById("ai-chat-menu-btn");
  const chatNewBtn = document.getElementById("ai-chat-new-btn");
  const chatMenu = document.getElementById("ai-chat-menu");
  const menuSwitch = document.getElementById("ai-menu-switch");
  const menuDelete = document.getElementById("ai-menu-delete");

  function hideChatMenu() {
    if (chatMenu) chatMenu.style.display = "none";
  }
  function toggleChatMenu() {
    if (!chatMenu) return;
    chatMenu.style.display =
      chatMenu.style.display === "none" ? "block" : "none";
  }

  if (chatMenuBtn) {
    chatMenuBtn.onclick = (e) => {
      e.stopPropagation();
      toggleChatMenu();
    };
  }

  document.addEventListener("click", () => hideChatMenu());

  if (chatNewBtn) {
    chatNewBtn.onclick = async (e) => {
      e.stopPropagation();
      hideChatMenu();
      const scope = ensureScope(State.mode, State.currentCourse);
      const session = createSession(scope);
      await persistDialogs();
      renderMessages(session.messages || []);
      State.history = session.messages || [];
      if (!State.history.length) {
        if (State.mode === "classroom" && State.currentCourse) {
          appendSystemMsg(`已进入【${State.currentCourse}】课堂。`);
        } else {
          appendSystemMsg("已进入自由模式，请直接提问。");
        }
      }
    };
  }

  function openDialogSwitcher() {
    hideChatMenu();
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.25)";
    overlay.style.zIndex = "999999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    const card = document.createElement("div");
    card.style.width = "320px";
    card.style.maxHeight = "70vh";
    card.style.overflow = "hidden";
    card.style.background = "#fff";
    card.style.borderRadius = "14px";
    card.style.boxShadow = "0 18px 40px rgba(0,0,0,0.25)";
    card.style.display = "flex";
    card.style.flexDirection = "column";

    const header = document.createElement("div");
    header.style.padding = "14px 14px";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.borderBottom = "1px solid #EEF2F7";

    const title = document.createElement("div");
    title.style.fontSize = "14px";
    title.style.fontWeight = "700";
    title.style.color = "#0F172A";
    title.innerText = "切换对话";

    const close = document.createElement("div");
    close.style.cursor = "pointer";
    close.style.width = "28px";
    close.style.height = "28px";
    close.style.borderRadius = "50%";
    close.style.display = "flex";
    close.style.alignItems = "center";
    close.style.justifyContent = "center";
    close.style.background = "#F1F5F9";
    close.innerText = "×";
    close.onclick = () => overlay.remove();

    header.appendChild(title);
    header.appendChild(close);

    const list = document.createElement("div");
    list.style.padding = "10px";
    list.style.overflowY = "auto";

    const scope = ensureScope(State.mode, State.currentCourse);
    const items = (scope.sessions || [])
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!items.length) {
      const empty = document.createElement("div");
      empty.style.padding = "18px 10px";
      empty.style.textAlign = "center";
      empty.style.color = "#64748B";
      empty.innerText = "暂无历史对话";
      list.appendChild(empty);
    } else {
      items.forEach((s) => {
        const row = document.createElement("div");
        row.style.padding = "10px 10px";
        row.style.borderRadius = "12px";
        row.style.cursor = "pointer";
        row.style.border = "1px solid #EEF2F7";
        row.style.marginBottom = "10px";
        row.onmouseenter = () => (row.style.background = "#F8FAFC");
        row.onmouseleave = () => (row.style.background = "#fff");
        if (s.id === scope.activeSessionId) row.style.background = "#F8FAFC";

        const t = document.createElement("div");
        t.style.fontSize = "13px";
        t.style.fontWeight = "700";
        t.style.color = "#0F172A";
        t.innerText = s.title || "对话";

        const sub = document.createElement("div");
        sub.style.marginTop = "4px";
        sub.style.fontSize = "12px";
        sub.style.color = "#64748B";
        sub.innerText =
          scope.title || (State.mode === "classroom" ? "课堂模式" : "自由模式");

        row.onclick = async () => {
          overlay.remove();
          switchView(viewChat);
          await switchToDialog(State.mode, State.currentCourse, s.id);
        };

        row.appendChild(t);
        row.appendChild(sub);
        list.appendChild(row);
      });
    }

    card.appendChild(header);
    card.appendChild(list);
    overlay.appendChild(card);
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
    document.body.appendChild(overlay);
  }

  if (menuSwitch) menuSwitch.onclick = () => openDialogSwitcher();

  if (menuDelete) {
    menuDelete.onclick = async () => {
      hideChatMenu();
      const ok = window.confirm("确定删除当前对话记录吗？");
      if (!ok) return;
      const scope = ensureScope(State.mode, State.currentCourse);
      const sid = scope.activeSessionId;
      scope.sessions = (scope.sessions || []).filter((s) => s.id !== sid);
      scope.activeSessionId = null;
      const session = ensureSession(scope);
      await persistDialogs();
      renderMessages(session.messages || []);
      State.history = session.messages || [];
      if (!State.history.length) {
        if (State.mode === "classroom" && State.currentCourse) {
          appendSystemMsg(`已进入【${State.currentCourse}】课堂。`);
        } else {
          appendSystemMsg("已进入自由模式，请直接提问。");
        }
      }
    };
  }
})();
