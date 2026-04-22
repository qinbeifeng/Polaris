document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("backend-status");
  const versionEl = document.getElementById("api-version");
  const refreshBtn = document.getElementById("refresh-btn");

  const BACKEND_URL = "http://127.0.0.1:8000/health";

  async function checkHealth() {
    statusEl.textContent = "Checking...";
    statusEl.className = "status-value"; // Reset classes
    versionEl.textContent = "-";

    try {
      const response = await fetch(BACKEND_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.status === "ok") {
        statusEl.textContent = "Connected ✅";
        statusEl.classList.add("status-ok");
        versionEl.textContent = data.version;
      } else {
        statusEl.textContent = "Error ❌";
        statusEl.classList.add("status-error");
      }
    } catch (error) {
      console.error("Health check failed:", error);
      statusEl.textContent = "Disconnected ❌";
      statusEl.classList.add("status-error");
      versionEl.textContent = "N/A";
    }
  }

  // Initial check
  checkHealth();

  // Button listener
  refreshBtn.addEventListener("click", checkHealth);
});
