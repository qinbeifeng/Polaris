// Background Script
// Listens for messages from content script to perform privileged actions like capturing the tab and API calls

const API_BASE = "http://127.0.0.1:8000/api";
const API_CHAT = `${API_BASE}/chat`;
const API_CHAT_ASK = `${API_BASE}/chat/ask`;
const API_COURSES = `${API_BASE}/courses`;
const API_COURSES_URL = `${API_BASE}/courses/url`;
const API_COURSES_UPLOAD = `${API_BASE}/courses/upload`;

const API_AUTH_REGISTER = `${API_BASE}/auth/register`;
const API_AUTH_LOGIN = `${API_BASE}/auth/login`;
const API_USER_PROFILE = `${API_BASE}/user/profile`;

const API_PLATFORM_COURSE_CREATE = `${API_BASE}/course/create`;
const API_PLATFORM_COURSE_JOIN = `${API_BASE}/course/join`;
const API_PLATFORM_COURSE_LIST = `${API_BASE}/course/list`;
const API_PLATFORM_COURSE_LEAVE = `${API_BASE}/course/leave`;

const API_MATERIAL_UPLOAD = `${API_BASE}/material/upload`;
const API_MATERIAL_ANALYZE = `${API_BASE}/material/analyze`;
const API_MATERIAL_LIST = `${API_BASE}/material/list`;
const API_MATERIAL_DELETE = `${API_BASE}/material/delete`;

// Store active abort controllers mapped by tab ID or a unique request ID
const activeRequests = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const requestKey = sender.tab ? sender.tab.id : "popup";

  function formatValidationDetail(detail) {
    const fieldLabel = (k) => {
      const map = {
        role: "身份",
        student: "学生信息",
        teacher: "教师信息",
        username: "账号",
        password: "密码",
        nickname: "昵称",
        school: "学校",
        student_no: "学号",
        major: "专业",
        grade: "年级",
        teacher_no: "工号",
        department: "院系",
        title: "职称",
      };
      return map[k] || k;
    };

    const simplifyMsg = (msg) => {
      if (!msg) return "格式不正确";
      const s = String(msg);
      if (s === "Field required") return "必填";
      const m1 = s.match(/ensure this value has at least (\d+) characters/i);
      if (m1) return `长度至少 ${m1[1]} 个字符`;
      const m2 = s.match(/ensure this value has at most (\d+) characters/i);
      if (m2) return `长度最多 ${m2[1]} 个字符`;
      return s;
    };

    if (!Array.isArray(detail)) return null;
    const lines = detail
      .map((e) => {
        if (!e) return null;
        const loc = Array.isArray(e.loc) ? e.loc : [];
        const path = loc
          .filter((p) => p !== "body")
          .map((p) => fieldLabel(String(p)))
          .join(" / ");
        const msg = simplifyMsg(e.msg);
        return path ? `${path}：${msg}` : msg;
      })
      .filter(Boolean);
    if (!lines.length) return null;
    return lines.join("\n");
  }

  async function buildBackendError(response) {
    const status = response.status;
    let text = "";
    let json = null;
    try {
      const ct = response.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        json = await response.json();
      } else {
        text = await response.text();
      }
    } catch (e) {
      try {
        text = await response.text();
      } catch (e2) {
        text = "";
      }
    }

    if (json && json.detail) {
      const formatted = formatValidationDetail(json.detail);
      if (formatted) return `注册信息有误：\n${formatted}`;
      if (typeof json.detail === "string") return json.detail;
    }

    const raw = text || (json ? JSON.stringify(json) : "");
    if (raw) return `Backend Error (${status}): ${raw}`;
    return `Backend Error (${status})`;
  }

  // 1. Capture Tab (Existing)
  if (request.action === "captureTab") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl });
      }
    });
    return true;
  }

  // 2. Chat (Text context only; OCR disabled)
  if (request.action === "analyzeImage" || request.action === "chat") {
    const controller = new AbortController();
    const signal = controller.signal;

    activeRequests.set(requestKey, controller);

    (async () => {
      try {
        const payload = {
          query: request.query,
          message: request.query,
          page_context: request.page_context, // Text context from innerText
          document_url: request.document_url,
          course_name: request.course_name,
          lecture_mode: request.lecture_mode,
          chat_history: request.chat_history,
        };

        const response = await fetch(API_CHAT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend Error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        sendResponse({
          success: true,
          answer: data.answer,
          sources: data.sources,
          course_name: data.course_name,
        });
      } catch (error) {
        if (error.name === "AbortError") {
          console.log("Request aborted by user");
          sendResponse({
            success: false,
            error: "Aborted by user",
            aborted: true,
          });
        } else {
          console.error("Chat Error:", error);
          sendResponse({ success: false, error: error.message });
        }
      } finally {
        activeRequests.delete(requestKey);
      }
    })();
    return true; // Keep channel open
  }

  // 3. Stop Generation
  if (request.action === "stopGeneration") {
    const controller = activeRequests.get(requestKey);
    if (controller) {
      controller.abort();
      activeRequests.delete(requestKey);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "No active request found" });
    }
    return true;
  }

  if (request.action === "authRegister") {
    (async () => {
      try {
        const response = await fetch(API_AUTH_REGISTER, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.payload),
        });
        if (!response.ok) {
          const errMsg = await buildBackendError(response);
          throw new Error(errMsg);
        }
        const data = await response.json();
        sendResponse({ success: true, token: data.token, role: data.role });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "authLogin") {
    (async () => {
      try {
        const response = await fetch(API_AUTH_LOGIN, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.payload),
        });
        if (!response.ok) {
          const errMsg = await buildBackendError(response);
          throw new Error(errMsg);
        }
        const data = await response.json();
        sendResponse({ success: true, token: data.token, role: data.role });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "getProfile") {
    (async () => {
      try {
        const token = request.token;
        const response = await fetch(API_USER_PROFILE, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend Error (${response.status}): ${errorText}`);
        }
        const profile = await response.json();
        sendResponse({ success: true, profile });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "updateProfile") {
    (async () => {
      try {
        const token = request.token;
        const response = await fetch(API_USER_PROFILE, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(request.payload || {}),
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend Error (${response.status}): ${errorText}`);
        }
        const profile = await response.json();
        sendResponse({ success: true, profile });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "platformCourseCreate") {
    (async () => {
      try {
        const response = await fetch(API_PLATFORM_COURSE_CREATE, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${request.token}`,
          },
          body: JSON.stringify(request.payload),
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend Error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        sendResponse({ success: true, course: data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "platformCourseJoin") {
    (async () => {
      try {
        const response = await fetch(API_PLATFORM_COURSE_JOIN, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${request.token}`,
          },
          body: JSON.stringify(request.payload),
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend Error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        sendResponse({ success: true, course: data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "platformCourseList") {
    (async () => {
      try {
        const response = await fetch(API_PLATFORM_COURSE_LIST, {
          headers: { Authorization: `Bearer ${request.token}` },
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend Error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        sendResponse({ success: true, courses: data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "platformCourseMembers") {
    (async () => {
      try {
        const response = await fetch(
          `${API_BASE}/course/${request.courseId}/members`,
          {
            headers: { Authorization: `Bearer ${request.token}` },
          },
        );
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend Error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        sendResponse({ success: true, members: data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "materialList") {
    (async () => {
      try {
        const response = await fetch(
          `${API_MATERIAL_LIST}?course_id=${encodeURIComponent(request.courseId)}`,
          {
            headers: { Authorization: `Bearer ${request.token}` },
          },
        );
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend Error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        sendResponse({ success: true, materials: data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "materialUpload") {
    (async () => {
      try {
        const res = await fetch(request.fileData);
        const blob = await res.blob();
        const formData = new FormData();
        formData.append("file", blob, request.fileName);
        formData.append("course_id", String(request.courseId));

        const response = await fetch(API_MATERIAL_UPLOAD, {
          method: "POST",
          headers: { Authorization: `Bearer ${request.token}` },
          body: formData,
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend Error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        sendResponse({ success: true, material: data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "materialAnalyze") {
    (async () => {
      try {
        const response = await fetch(API_MATERIAL_ANALYZE, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${request.token}`,
          },
          body: JSON.stringify({ material_id: request.materialId }),
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend Error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        sendResponse({ success: true, data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "materialDelete") {
    (async () => {
      try {
        const response = await fetch(API_MATERIAL_DELETE, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${request.token}`,
          },
          body: JSON.stringify({ material_id: request.materialId }),
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend Error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        sendResponse({ success: true, data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "platformCourseLeave") {
    (async () => {
      try {
        const response = await fetch(API_PLATFORM_COURSE_LEAVE, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${request.token}`,
          },
          body: JSON.stringify({ course_id: request.courseId }),
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend Error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        sendResponse({ success: true, data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "chatAsk") {
    const controller = new AbortController();
    const signal = controller.signal;
    activeRequests.set(requestKey, controller);
    (async () => {
      try {
        const response = await fetch(API_CHAT_ASK, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${request.token}`,
          },
          body: JSON.stringify(request.payload),
          signal,
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend Error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        sendResponse({
          success: true,
          answer: data.answer,
          sources: data.sources,
          course_name: data.course_name,
        });
      } catch (error) {
        if (error.name === "AbortError") {
          sendResponse({
            success: false,
            error: "Aborted by user",
            aborted: true,
          });
        } else {
          sendResponse({ success: false, error: error.message });
        }
      } finally {
        activeRequests.delete(requestKey);
      }
    })();
    return true;
  }

  // 4. Fetch Courses
  if (request.action === "fetchCourses") {
    (async () => {
      try {
        const response = await fetch(API_COURSES);
        if (!response.ok) throw new Error("Failed to fetch courses");
        const courses = await response.json();
        sendResponse({ success: true, courses });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  // 5. Add Course URL
  if (request.action === "addCourseUrl") {
    (async () => {
      try {
        const response = await fetch(API_COURSES_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: request.url,
            course_name: request.course_name,
          }),
        });
        const data = await response.json();
        sendResponse({ success: true, data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  // 6. Upload Course File
  if (request.action === "uploadCourseFile") {
    (async () => {
      try {
        // request.fileData should be base64 string
        // Convert base64 back to Blob/File
        const res = await fetch(request.fileData);
        const blob = await res.blob();

        const formData = new FormData();
        formData.append("file", blob, request.fileName);
        formData.append("course_name", request.course_name);

        const response = await fetch(API_COURSES_UPLOAD, {
          method: "POST",
          body: formData, // fetch automatically sets Content-Type to multipart/form-data with boundary
        });

        const data = await response.json();
        sendResponse({ success: true, data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});
