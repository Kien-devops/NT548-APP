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
  return sessionStorage.getItem("nt548_access_token") || localStorage.getItem("nt548_access_token");
}

function clearAuthStorage() {
  for (const storage of [sessionStorage, localStorage]) {
    storage.removeItem("nt548_access_token");
    storage.removeItem("nt548_current_user");
  }
}

function redirectToLogin() {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  sessionStorage.setItem("nt548_return_to", currentPage);
  clearAuthStorage();
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
        <div class="product-media">
          <span class="product-glyph" aria-hidden="true">${escapeHtml(productGlyph(product.category))}</span>
          <span class="product-stock"><i aria-hidden="true"></i>Đang bán</span>
        </div>
        <div class="product-body">
          <div class="product-title"><span class="category-pill">${escapeHtml(product.category)}</span><strong>${escapeHtml(product.name)}</strong><small>Mã sản phẩm #${escapeHtml(product.id)}</small></div>
          <div class="product-card-foot"><span><small>Giá bán</small><strong class="product-price">${currency.format(Number(product.price))}</strong></span><span class="product-state">Sẵn sàng</span></div>
          <div class="crud-actions"><button type="button" class="secondary-action" data-edit="products" data-id="${escapeHtml(product.id)}">Sửa</button><button type="button" class="danger-action" data-delete="products" data-id="${escapeHtml(product.id)}">Xóa</button></div>
        </div>
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
      const actions = page === "orders" ? `<td data-label="Thao tác"><div class="crud-actions"><button type="button" class="secondary-action" data-edit="orders" data-id="${escapeHtml(order.order_id)}">Sửa</button><button type="button" class="danger-action" data-delete="orders" data-id="${escapeHtml(order.order_id)}">Xóa</button></div></td>` : "";
      return `<tr><td class="order-id" data-label="Mã đơn">${escapeHtml(order.order_id)}</td><td data-label="Khách hàng">${escapeHtml(order.customer)}</td><td class="money" data-label="Tổng tiền">${currency.format(Number(order.total))}</td><td data-label="Trạng thái"><span class="status-pill ${status.className}">${escapeHtml(status.label)}</span></td>${actions}</tr>`;
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
  const target = document.getElementById(section === "users" ? "user-list" : section === "products" ? "product-list" : "order-list");
  target?.removeAttribute("aria-busy");
}

function showLoading(section) {
  const target = document.getElementById(section === "users" ? "user-list" : section === "products" ? "product-list" : "order-list");
  if (!target) return;
  target.setAttribute("aria-busy", "true");
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

async function mutateResource(section, method, id, body) {
  const path = id === undefined ? endpoints[section] : `${endpoints[section]}/${encodeURIComponent(id)}`;
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${getAccessToken()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) return redirectToLogin();
  if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
  return payload;
}

function openCrudDialog(section, item = null) {
  const dialog = document.getElementById("crud-dialog");
  const fields = document.getElementById("crud-fields");
  const form = document.getElementById("crud-form");
  if (!dialog || !fields || !form) return;
  const editing = Boolean(item);
  document.getElementById("crud-title").textContent = `${editing ? "Sửa" : "Thêm"} ${section === "products" ? "sản phẩm" : "đơn hàng"}`;
  fields.innerHTML = section === "products" ? `
    <label>Mã sản phẩm<input name="id" type="number" min="1" required value="${item ? escapeHtml(item.id) : ""}" ${editing ? "readonly" : ""}></label>
    <label>Tên sản phẩm<input name="name" required value="${item ? escapeHtml(item.name) : ""}"></label>
    <label>Danh mục<input name="category" required value="${item ? escapeHtml(item.category) : ""}"></label>
    <label>Giá<input name="price" type="number" min="0" step="0.01" required value="${item ? escapeHtml(item.price) : ""}"></label>` : `
    <label>Mã đơn<input name="order_id" required value="${item ? escapeHtml(item.order_id) : ""}" ${editing ? "readonly" : ""}></label>
    <label>Khách hàng<input name="customer" required value="${item ? escapeHtml(item.customer) : ""}"></label>
    <label>Tổng tiền<input name="total" type="number" min="0" step="0.01" required value="${item ? escapeHtml(item.total) : ""}"></label>
    <label>Trạng thái<select name="status"><option>PENDING</option><option>PROCESSING</option><option>COMPLETED</option><option>CANCELLED</option></select></label>`;
  if (item && section === "orders") form.elements.status.value = item.status;
  form.dataset.section = section;
  form.dataset.id = item ? String(section === "products" ? item.id : item.order_id) : "";
  dialog.showModal();
}

document.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const create = target?.closest("[data-create]");
  const edit = target?.closest("[data-edit]");
  const remove = target?.closest("[data-delete]");
  if (create) return openCrudDialog(create.dataset.create);
  if (edit) {
    const item = state[edit.dataset.edit].find((entry) => String(edit.dataset.edit === "products" ? entry.id : entry.order_id) === edit.dataset.id);
    return openCrudDialog(edit.dataset.edit, item);
  }
  if (remove) {
    if (!window.confirm("Bạn có chắc muốn xóa mục này?")) return;
    try {
      await mutateResource(remove.dataset.delete, "DELETE", remove.dataset.id);
      await loadSection(remove.dataset.delete);
      showToast("Đã xóa thành công.");
    } catch (error) { showToast(error.message); }
  }
  if (target?.closest(".dialog-close")) document.getElementById("crud-dialog")?.close();
});

document.getElementById("crud-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const section = form.dataset.section;
  const data = Object.fromEntries(new FormData(form));
  try {
    await mutateResource(section, form.dataset.id ? "PUT" : "POST", form.dataset.id || undefined, data);
    document.getElementById("crud-dialog")?.close();
    await loadSection(section);
    showToast("Đã lưu thành công.");
  } catch (error) { showToast(error.message); }
});

function sectionsForPage() {
  if (page === "overview") return ["products", "orders"];
  if (page === "login") return [];
  return [page];
}

async function refreshPage() {
  const button = document.getElementById("refresh-all");
  if (button) { button.classList.add("is-loading"); button.disabled = true; button.setAttribute("aria-busy", "true"); }
  state.usesDemo = false;
  await Promise.all(sectionsForPage().map(loadSection));
  text("sync-time", new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
  if (button) { button.classList.remove("is-loading"); button.disabled = false; button.removeAttribute("aria-busy"); }
  showToast(state.usesDemo ? "Backend chưa sẵn sàng — đang hiển thị dữ liệu mẫu." : "Dữ liệu đã được cập nhật.");
}

document.getElementById("refresh-all")?.addEventListener("click", refreshPage);

const menuButton = document.querySelector(".menu-button");
function closeMenu() {
  document.body.classList.remove("menu-open");
  menuButton?.setAttribute("aria-expanded", "false");
  menuButton?.setAttribute("aria-label", "Mở menu");
}

menuButton?.addEventListener("click", () => {
  const isOpen = document.body.classList.toggle("menu-open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
  menuButton.setAttribute("aria-label", isOpen ? "Đóng menu" : "Mở menu");
});

document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", closeMenu));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("menu-open")) {
    closeMenu();
    menuButton?.focus();
  }
});
document.addEventListener("click", (event) => {
  if (!document.body.classList.contains("menu-open")) return;
  if (event.target instanceof Node && !document.querySelector(".sidebar")?.contains(event.target) && !menuButton?.contains(event.target)) closeMenu();
});

function initializeCurrentUser() {
  const rawUser = sessionStorage.getItem("nt548_current_user") || localStorage.getItem("nt548_current_user");
  if (!rawUser) return;
  try {
    const user = JSON.parse(rawUser);
    const displayName = user.name || user.email?.split("@")[0] || "Quản trị viên";
    document.querySelectorAll("[data-user-name]").forEach((element) => { element.textContent = displayName; });
    document.querySelectorAll("[data-user-avatar]").forEach((element) => { element.textContent = initials(displayName).slice(0, 2) || "QT"; });
  } catch {
    // Keep the safe default account label when stored profile data is malformed.
  }
}

function initializeLogin() {
  const form = document.getElementById("login-form");
  const passwordInput = document.getElementById("password");
  const passwordToggle = document.querySelector(".password-toggle");
  const rememberInput = form?.elements.namedItem("remember");
  if (!form || !passwordInput) return;

  if (rememberInput instanceof HTMLInputElement) {
    rememberInput.checked = Boolean(localStorage.getItem("nt548_access_token"));
  }

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
    const submitLabel = submitButton?.querySelector(".login-button-label");
    const emailValid = Boolean(emailInput?.value.trim()) && emailInput.validity.valid;
    const passwordValid = passwordInput.value.length >= 6;

    emailInput?.setAttribute("aria-invalid", String(!emailValid));
    passwordInput.setAttribute("aria-invalid", String(!passwordValid));
    if (emailError) emailError.textContent = emailValid ? "" : "Vui lòng nhập một địa chỉ email hợp lệ.";
    if (passwordError) passwordError.textContent = passwordValid ? "" : "Mật khẩu cần có ít nhất 6 ký tự.";

    if (!emailValid || !passwordValid) {
      (emailValid ? passwordInput : emailInput)?.focus();
      return;
    }
    submitButton?.classList.add("is-loading");
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.setAttribute("aria-busy", "true");
    }
    if (submitLabel) submitLabel.textContent = "Đang đăng nhập...";

    try {
      const response = await fetch("/api/users/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: emailInput.value.trim(), password: passwordInput.value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (passwordError) passwordError.textContent = payload.message || "Không thể đăng nhập với thông tin này.";
        passwordInput.setAttribute("aria-invalid", "true");
        passwordInput.focus();
        return;
      }

      const requestedPage = sessionStorage.getItem("nt548_return_to");
      const allowedPages = new Set(["index.html", "products.html", "orders.html"]);
      const authStorage = rememberInput instanceof HTMLInputElement && rememberInput.checked ? localStorage : sessionStorage;
      clearAuthStorage();
      authStorage.setItem("nt548_access_token", payload.access_token);
      authStorage.setItem("nt548_current_user", JSON.stringify(payload.user));
      sessionStorage.removeItem("nt548_return_to");
      showToast("Đăng nhập thành công. Đang mở bảng điều khiển...");
      window.setTimeout(() => window.location.assign(allowedPages.has(requestedPage) ? requestedPage : "index.html"), 450);
    } catch {
      showToast("Không thể kết nối Auth Service. Hãy kiểm tra backend đang chạy.");
    } finally {
      submitButton?.classList.remove("is-loading");
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute("aria-busy");
      }
      if (submitLabel) submitLabel.textContent = "Đăng nhập";
    }
  });

  for (const input of [form.elements.namedItem("email"), passwordInput]) {
    if (!(input instanceof HTMLInputElement)) continue;
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      const error = document.getElementById(`${input.id}-error`);
      if (error) error.textContent = "";
    });
  }
}

function initializeRegister() {
  const form = document.getElementById("register-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = form.elements.namedItem("name").value.trim();
    const email = form.elements.namedItem("email").value.trim();
    const password = form.elements.namedItem("password").value;
    const confirmPassword = form.elements.namedItem("confirmPassword").value;
    const valid = name.length >= 2 && /^\S+@\S+\.\S+$/.test(email) && password.length >= 6 && password === confirmPassword;
    document.getElementById("name-error").textContent = name.length >= 2 ? "" : "Họ tên cần tối thiểu 2 ký tự.";
    document.getElementById("email-error").textContent = /^\S+@\S+\.\S+$/.test(email) ? "" : "Email không hợp lệ.";
    document.getElementById("password-error").textContent = password.length >= 6 ? "" : "Mật khẩu cần ít nhất 6 ký tự.";
    document.getElementById("confirm-password-error").textContent = password === confirmPassword ? "" : "Mật khẩu nhập lại không khớp.";
    if (!valid) return;
    const button = form.querySelector(".login-button");
    button.disabled = true;
    try {
      const response = await fetch("/api/users/register", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ name, email, password }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Không thể đăng ký tài khoản.");
      showToast("Đăng ký thành công. Đang chuyển đến đăng nhập...");
      window.setTimeout(() => window.location.assign("login.html"), 700);
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

function initializeAuthNavigation() {
  if (!getAccessToken()) return;
  document.querySelectorAll("[data-auth-link]").forEach((link) => {
    link.setAttribute("href", "#logout");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      clearAuthStorage();
      window.location.assign("login.html");
    });
  });
}

function initializeInteractionMotion() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const selector = "button, .nav-item, .sidebar-logout, a.metric-card, .text-link";

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const control = event.target.closest(selector);
    if (!(control instanceof HTMLElement) || control.matches(":disabled,[aria-disabled='true']")) return;

    const bounds = control.getBoundingClientRect();
    const size = Math.max(bounds.width, bounds.height) * 1.35;
    const ripple = document.createElement("span");
    ripple.className = "interaction-ripple";
    ripple.setAttribute("aria-hidden", "true");
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - bounds.left}px`;
    ripple.style.top = `${event.clientY - bounds.top}px`;

    control.querySelector(":scope > .interaction-ripple")?.remove();
    control.append(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  });
}

initializeInteractionMotion();

if (page === "login") initializeLogin();
else if (page === "register") initializeRegister();
else if (getAccessToken()) {
  initializeCurrentUser();
  initializeAuthNavigation();
  refreshPage();
}
