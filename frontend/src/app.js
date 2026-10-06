const demoData = {
  users: [
    { id: 1, name: "Nguyễn Văn A", email: "vana@uit.edu.vn", role: "DevOps Engineer" },
    { id: 2, name: "Trần Thị B", email: "thib@uit.edu.vn", role: "Cloud Architect" },
    { id: 3, name: "Lê Văn C", email: "vanc@uit.edu.vn", role: "Site Reliability Engineer" },
  ],
  products: [
    { id: 101, name: "AWS Fargate Cluster v2", category: "Cloud Computing", price: 49.99 },
    { id: 102, name: "Terraform Enterprise Blueprint", category: "DevOps Tools", price: 89 },
    { id: 103, name: "Docker & Kubernetes Master", category: "Containerization", price: 29.5 },
    { id: 104, name: "Prometheus & Grafana", category: "Observability", price: 35 },
  ],
  orders: [
    { order_id: "ORD-9021", customer: "Nguyễn Văn A", total: 49.99, status: "COMPLETED" },
    { order_id: "ORD-9022", customer: "Trần Thị B", total: 118.5, status: "PROCESSING" },
    { order_id: "ORD-9023", customer: "Lê Văn C", total: 35, status: "COMPLETED" },
  ],
};

const endpoints = { users: "/api/users", products: "/api/products", orders: "/api/orders" };
const page = document.body.dataset.page || "overview";
const protectedPages = new Set(["overview", "products", "orders"]);
const state = { users: [], products: [], orders: [], usesDemo: false };
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function getAccessToken() {
  return sessionStorage.getItem("nt548_access_token");
}

function redirectToLogin() {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  sessionStorage.setItem("nt548_return_to", currentPage);
  sessionStorage.removeItem("nt548_access_token");
  sessionStorage.removeItem("nt548_current_user");
  window.location.replace("login.html");
}

if (protectedPages.has(page) && !getAccessToken()) redirectToLogin();

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name) {
  return String(name).trim().split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase();
}

function productGlyph(category) {
  return ({ "Cloud Computing": "CL", "DevOps Tools": "DV", Containerization: "CT", Observability: "OB" })[category] || "SP";
}

function text(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function statusMeta(status) {
  if (status === "COMPLETED") return { className: "status-completed", label: "Hoàn tất" };
  if (status === "PROCESSING") return { className: "status-processing", label: "Đang xử lý" };
  return { className: "status-other", label: status };
}

function renderUsers() {
  const target = document.getElementById("user-list");
  if (!target) return;
  target.innerHTML = state.users.length
    ? state.users.map((user) => `
      <tr>
        <td><div class="user-cell"><span class="avatar" aria-hidden="true">${escapeHtml(initials(user.name))}</span><div><strong>${escapeHtml(user.name)}</strong><small>Tài khoản #${escapeHtml(user.id)}</small></div></div></td>
        <td class="hide-mobile">#${escapeHtml(user.id)}</td>
        <td>${escapeHtml(user.email)}</td>
        <td><span class="role-pill">${escapeHtml(user.role)}</span></td>
      </tr>`).join("")
    : '<tr><td colspan="4" class="empty-state">Chưa có người dùng.</td></tr>';
  text("user-count", state.users.length);
  text("role-count", new Set(state.users.map((user) => user.role)).size);
  text("user-total-label", `${state.users.length} tài khoản`);
}

function renderProducts() {
  const target = document.getElementById("product-list");
  if (!target) return;
  target.innerHTML = state.products.length
    ? state.products.map((product) => `
      <article class="product-card">
        <span class="product-glyph" aria-hidden="true">${escapeHtml(productGlyph(product.category))}</span>
        <div class="product-title"><strong>${escapeHtml(product.name)}</strong><small>Mã sản phẩm #${escapeHtml(product.id)}</small><span class="category-pill">${escapeHtml(product.category)}</span></div>
        <span class="product-price">${currency.format(Number(product.price))}</span>
      </article>`).join("")
    : '<div class="empty-state">Chưa có sản phẩm.</div>';
  const average = state.products.length ? state.products.reduce((sum, product) => sum + Number(product.price || 0), 0) / state.products.length : 0;
  text("product-count", state.products.length);
  text("category-count", new Set(state.products.map((product) => product.category)).size);
  text("average-price", currency.format(average));
  text("product-total-label", `${state.products.length} sản phẩm`);
}

function renderOrders() {
  const target = document.getElementById("order-list");
  if (!target) return;
  const visibleOrders = page === "overview" ? state.orders.slice(0, 3) : state.orders;
  target.innerHTML = visibleOrders.length
    ? visibleOrders.map((order) => {
      const status = statusMeta(order.status);
      return `<tr><td class="order-id">${escapeHtml(order.order_id)}</td><td>${escapeHtml(order.customer)}</td><td class="money">${currency.format(Number(order.total))}</td><td><span class="status-pill ${status.className}">${escapeHtml(status.label)}</span></td></tr>`;
    }).join("")
    : '<tr><td colspan="4" class="empty-state">Chưa có đơn hàng.</td></tr>';
  text("order-count", state.orders.length);
  text("completed-count", state.orders.filter((order) => order.status === "COMPLETED").length);
  text("processing-count", state.orders.filter((order) => order.status === "PROCESSING").length);
  text("order-total-label", `${state.orders.length} đơn hàng`);
  text("revenue-total", currency.format(state.orders.reduce((sum, order) => sum + Number(order.total || 0), 0)));
}

function renderOverviewMetrics() {
  text("user-count", state.users.length);
  text("product-count", state.products.length);
  text("order-count", state.orders.length);
  text("revenue-total", currency.format(state.orders.reduce((sum, order) => sum + Number(order.total || 0), 0)));
}

function updateModeBadge() {
  const badge = document.getElementById("data-mode-badge");
  if (!badge) return;
  badge.classList.toggle("is-demo", state.usesDemo);
  const label = badge.querySelector("span:last-child");
  if (label) label.textContent = state.usesDemo ? "Đang dùng dữ liệu mẫu" : "Đã kết nối API";
}

function renderSection(section) {
  if (section === "users") renderUsers();
  if (section === "products") renderProducts();
  if (section === "orders") renderOrders();
  if (page === "overview") renderOverviewMetrics();
}

function showLoading(section) {
  const target = document.getElementById(section === "users" ? "user-list" : section === "products" ? "product-list" : "order-list");
  if (!target) return;
  if (target.tagName === "TBODY") target.innerHTML = '<tr><td colspan="4"><div class="skeleton"></div><div class="skeleton"></div></td></tr>';
  else target.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
}

async function loadSection(section) {
  showLoading(section);
  try {
    const token = getAccessToken();
    const response = await fetch(endpoints[section], {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) {
      redirectToLogin();
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("Dữ liệu API không hợp lệ");
    state[section] = payload;
  } catch (error) {
    state[section] = demoData[section];
    state.usesDemo = true;
    console.info(`[NT548] ${section} API chưa sẵn sàng, sử dụng dữ liệu mẫu.`, error.message);
  }
  renderSection(section);
  updateModeBadge();
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function sectionsForPage() {
  if (page === "overview") return ["products", "orders"];
  if (page === "login") return [];
  return [page];
}

async function refreshPage() {
  const button = document.getElementById("refresh-all");
  if (button) { button.classList.add("is-loading"); button.disabled = true; }
  state.usesDemo = false;
  await Promise.all(sectionsForPage().map(loadSection));
  text("sync-time", new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
  if (button) { button.classList.remove("is-loading"); button.disabled = false; }
  showToast(state.usesDemo ? "Backend chưa sẵn sàng — đang hiển thị dữ liệu mẫu." : "Dữ liệu đã được cập nhật.");
}

document.getElementById("refresh-all")?.addEventListener("click", refreshPage);

const menuButton = document.querySelector(".menu-button");
menuButton?.addEventListener("click", () => {
  const isOpen = document.body.classList.toggle("menu-open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
  menuButton.setAttribute("aria-label", isOpen ? "Đóng menu" : "Mở menu");
});

document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => document.body.classList.remove("menu-open")));

function initializeLogin() {
  const form = document.getElementById("login-form");
  const passwordInput = document.getElementById("password");
  const passwordToggle = document.querySelector(".password-toggle");
  if (!form || !passwordInput) return;

  passwordToggle?.addEventListener("click", () => {
    const shouldShow = passwordInput.type === "password";
    passwordInput.type = shouldShow ? "text" : "password";
    passwordToggle.setAttribute("aria-pressed", String(shouldShow));
    passwordToggle.setAttribute("aria-label", shouldShow ? "Ẩn mật khẩu" : "Hiện mật khẩu");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const emailInput = document.getElementById("email");
    const emailError = document.getElementById("email-error");
    const passwordError = document.getElementById("password-error");
    const submitButton = form.querySelector(".login-button");
    const emailValid = Boolean(emailInput?.value.trim()) && emailInput.validity.valid;
    const passwordValid = passwordInput.value.length >= 6;

    emailInput?.setAttribute("aria-invalid", String(!emailValid));
    passwordInput.setAttribute("aria-invalid", String(!passwordValid));
    if (emailError) emailError.textContent = emailValid ? "" : "Vui lòng nhập một địa chỉ email hợp lệ.";
    if (passwordError) passwordError.textContent = passwordValid ? "" : "Mật khẩu cần có ít nhất 6 ký tự.";

    if (!emailValid || !passwordValid) return;
    submitButton?.classList.add("is-loading");
    if (submitButton) submitButton.disabled = true;

    try {
      const response = await fetch("/api/users/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: emailInput.value.trim(), password: passwordInput.value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (passwordError) passwordError.textContent = payload.message || "Không thể đăng nhập với thông tin này.";
        return;
      }

      sessionStorage.setItem("nt548_access_token", payload.access_token);
      sessionStorage.setItem("nt548_current_user", JSON.stringify(payload.user));
      showToast("Đăng nhập thành công. Đang mở bảng điều khiển...");
      const requestedPage = sessionStorage.getItem("nt548_return_to");
      const allowedPages = new Set(["index.html", "products.html", "orders.html"]);
      sessionStorage.removeItem("nt548_return_to");
      window.setTimeout(() => window.location.assign(allowedPages.has(requestedPage) ? requestedPage : "index.html"), 450);
    } catch {
      showToast("Không thể kết nối Auth Service. Hãy kiểm tra backend đang chạy.");
    } finally {
      submitButton?.classList.remove("is-loading");
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function initializeAuthNavigation() {
  if (!getAccessToken()) return;
  document.querySelectorAll('.nav-item[href="login.html"]').forEach((link) => {
    const label = link.querySelector("span");
    if (label) label.textContent = "Đăng xuất";
    link.setAttribute("href", "#logout");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      sessionStorage.removeItem("nt548_access_token");
      sessionStorage.removeItem("nt548_current_user");
      window.location.assign("login.html");
    });
  });
}

if (page === "login") initializeLogin();
else if (getAccessToken()) {
  initializeAuthNavigation();
  refreshPage();
}
