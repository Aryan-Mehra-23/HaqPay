/**
 * HaqPay — Frontend Core Logic & Routing
 * Plain Vanilla JavaScript, Zero Dependencies
 */

// Backend configuration (Empty = standalone demo mode; Set to e.g. "http://127.0.0.1:8000/api/v1" if running with backend)
const API_BASE = "http://127.0.0.1:8000/api/v1";
const DEMO_SUPPLIER_ID = "demo-supplier-1";
// Public contact details used by the home-page Contact us menu.
const CONTACT_EMAIL = "dishoom116017@gmail.com";
// Digits only, including country code.
const CONTACT_PHONE = "918744032674";

// Application State
const PAYMENT_SOURCE_STORAGE_KEY = "haqpay-payment-sources-v1";
function loadPaymentSources() {
  try {
    const saved = JSON.parse(localStorage.getItem(PAYMENT_SOURCE_STORAGE_KEY) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch (_) {
    return {};
  }
}
function getActiveLocalUsername() {
  try {
    return typeof window.getCurrentDemoUsername === "function" ? window.getCurrentDemoUsername() : "";
  } catch (_) {
    return "";
  }
}

function dashboardWorkspaceKey(username) {
  return "haqpay-dashboard-workspace-v1:" + encodeURIComponent(username.toLowerCase());
}

function loadDashboardWorkspaceForUser(username) {
  try {
    const saved = JSON.parse(localStorage.getItem(dashboardWorkspaceKey(username)) || "null");
    state.customers = saved && Array.isArray(saved.customers) ? saved.customers : [];
    state.paymentSources = saved && saved.paymentSources && typeof saved.paymentSources === "object"
      ? saved.paymentSources
      : {};
  } catch (_) {
    state.customers = [];
    state.paymentSources = {};
  }
}

function initializeDashboardWorkspaceForUser(username) {
  try {
    const key = dashboardWorkspaceKey(username);
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ customers: [], paymentSources: {} }));
    }
  } catch (_) {
    // A new account still starts with the in-memory empty dashboard if storage is blocked.
  }
}
function saveDashboardWorkspaceForUser() {
  const username = getActiveLocalUsername();
  if (!username) return false;
  try {
    localStorage.setItem(dashboardWorkspaceKey(username), JSON.stringify({
      customers: state.customers,
      paymentSources: state.paymentSources
    }));
  } catch (_) {
    showToast("Could not save this account's dashboard in browser storage.");
  }
  return true;
}

function persistPaymentSources() {
  if (saveDashboardWorkspaceForUser()) return;
  try {
    localStorage.setItem(PAYMENT_SOURCE_STORAGE_KEY, JSON.stringify(state.paymentSources));
  } catch (_) {
    showToast("Payment source is selected for this session only.");
  }
}
const state = {
  activeRoute: "#home",
  customers: [
    { id: "c1", name: "Khanna Motors", amount: 210000, daysLate: 91, avgDelay: 84, isNew: false },
    { id: "c2", name: "Gupta Auto Parts", amount: 125000, daysLate: 72, avgDelay: 71, isNew: false },
    { id: "c3", name: "Bansal Stationery", amount: 50000, daysLate: 40, avgDelay: 44, isNew: false },
    { id: "c4", name: "Verma Garments", amount: 32500, daysLate: 18, avgDelay: 21, isNew: false },
    { id: "c5", name: "Jain Stationers", amount: 78000, daysLate: -6, avgDelay: 3, isNew: false }
  ],
  paymentSources: loadPaymentSources(),
  contactDraft: null,
  buyerInvoice: {
    accepted: false,
    disputeOpen: false
  },
  modal: {
    customerName: "Bansal Stationery",
    amount: 50000,
    daysLate: 40,
    interest: 949,
    activeTab: "friendly" // 'friendly' | 'legal'
  },
  scan: {
    isScanning: false,
    uploadedDataUrl: null,
    draftData: null
  }
};

/**
 * Format number with Indian numbering system (INR)
 */
function formatINR(amount) {
  const rounded = Math.round(amount);
  return "₹" + rounded.toLocaleString("en-IN");
}

/**
 * Calculate legal compound interest under MSMED Act, 2006
 * Formula: principal * ((1 + r/12)^(daysLate/30.4) - 1)
 * where r = 3 * 5.75% = 17.25% (0.1725)
 */
function calculateInterest(principal, daysLate) {
  if (principal <= 0 || daysLate <= 0) return 0;
  const annualRate = 3 * 0.0575; // 0.1725
  const accrued = principal * (Math.pow(1 + annualRate / 12, daysLate / 30.4) - 1);
  return Math.round(accrued);
}

/**
 * Toast Notification System
 */
let toastTimeout = null;
function showToast(message) {
  const toastEl = document.getElementById("app-toast");
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("show");
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 2400);
}

/**
 * Optional API fetcher (Only active when API_BASE is configured)
 */
async function fetchApi(endpoint, options = {}) {
  if (!API_BASE) return null;
  try {
    const url = API_BASE.replace(/\/$/, "") + endpoint;
    const headers = {
      "X-Supplier-Id": DEMO_SUPPLIER_ID,
      ...(options.headers || {})
    };
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.warn("API call failed, falling back to demo data:", err);
    showToast("API error: fell back to demo data");
    return null;
  }
}

/**
 * Hash Routing System
 */
const VALID_ROUTES = ["#home", "#how", "#dashboard", "#scan", "#cash", "#customers", "#bank", "#buyer", "#pricing"];

function handleRoute() {
  let hash = window.location.hash || "#home";
  if (!VALID_ROUTES.includes(hash)) {
    hash = "#home";
    window.location.hash = "#home";
    return;
  }
  const publicRoutes = ["#home", "#how"];
  const signedIn = typeof window.getCurrentDemoUsername === "function" && Boolean(window.getCurrentDemoUsername());
  if (!publicRoutes.includes(hash) && !signedIn) {
    const requestedRoute = hash;
    window.location.hash = "#home";
    if (typeof window.openAuthModal === "function") window.openAuthModal(requestedRoute);
    return;
  }

  state.activeRoute = hash;

  // Toggle Page Views
  VALID_ROUTES.forEach(route => {
    const pageId = "page-" + route.substring(1);
    const pageEl = document.getElementById(pageId);
    if (pageEl) {
      if (route === hash) {
        pageEl.classList.add("active");
      } else {
        pageEl.classList.remove("active");
      }
    }
  });

  // Toggle Navbar (hidden on #home)
  const navbarEl = document.getElementById("app-navbar");
  if (navbarEl) {
    navbarEl.style.display = hash === "#home" ? "none" : "flex";
  }

  // Update Active Nav Link
  const navLinks = document.querySelectorAll(".nav-link");
  navLinks.forEach(link => {
    if (link.getAttribute("href") === hash) {
      link.classList.add("active");
      link.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    } else {
      link.classList.remove("active");
    }
  });

  // Scroll to Top on every route change
  window.scrollTo({ top: 0, behavior: "smooth" });

  // Route-specific renderers
  if (hash === "#dashboard") {
    renderDashboard();
  } else if (hash === "#cash") {
    renderCashAlert();
  } else if (hash === "#customers") {
    renderCustomersList();
  } else if (hash === "#buyer") {
    renderBuyerView();
  }
}

/**
 * Count Up Animation for Big Numbers
 */
function animateCountUp(element, targetVal, durationMs = 1000) {
  if (!element) return;
  const start = 0;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    // Ease-out cubic
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const currentVal = Math.round(start + (targetVal - start) * easeOut);
    element.textContent = formatINR(currentVal);

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = formatINR(targetVal);
    }
  }

  requestAnimationFrame(update);
}

/**
 * PAGE 3: DASHBOARD RENDERING
 */
async function renderDashboard() {
  const tableBody = document.getElementById("dashboard-table-body");
  if (!tableBody) return;

  // Local demo accounts always use their own browser workspace.
  // Never load the shared development supplier's dashboard into a signed-in account.
  const localUsername = getActiveLocalUsername();
  if (localUsername) loadDashboardWorkspaceForUser(localUsername);

  // If no local demo account is signed in, retain the standalone/backend demo view.
  if (API_BASE && !localUsername) {
    const apiData = await fetchApi("/dashboard");
    if (apiData && Array.isArray(apiData.rows) && apiData.rows.length > 0) {
      // Map API rows (paise to rupees)
      state.customers = apiData.rows.map(r => ({
        id: r.invoice_id || ("c-" + Math.random()),
        name: r.customer_name,
        amount: Math.round(r.amount / 100),
        daysLate: r.days_late,
        avgDelay: r.days_late > 0 ? r.days_late : 0,
        isNew: false
      }));
    }
  }

  // Sort customers by most days late descending
  const sorted = [...state.customers].sort((a, b) => b.daysLate - a.daysLate);

  let totalPending = 0;
  let totalInterest = 0;
  let lateCount = 0;

  tableBody.innerHTML = "";

  sorted.forEach(c => {
    totalPending += c.amount;
    const interest = calculateInterest(c.amount, c.daysLate);
    if (c.daysLate > 0) {
      totalInterest += interest;
      lateCount++;
    }

    const tr = document.createElement("tr");
    if (c.isNew) {
      tr.classList.add("row-flash");
      setTimeout(() => { c.isNew = false; }, 2100);
    }

    // Status pill
    let statusPillHtml = "";
    if (c.daysLate > 60) {
      statusPillHtml = `<span class="pill pill-late">${c.daysLate} days late</span>`;
    } else if (c.daysLate >= 1) {
      statusPillHtml = `<span class="pill pill-warn">${c.daysLate} days late</span>`;
    } else {
      const dueDays = Math.abs(c.daysLate);
      statusPillHtml = `<span class="pill pill-ok">due in ${dueDays} days</span>`;
    }

    // Interest string
    const interestDisplay = c.daysLate > 0 
      ? `<strong style="color: var(--light-gold);">${formatINR(interest)}</strong>` 
      : `<span class="muted">—</span>`;

    // Action button
    const actionBtn = c.daysLate > 0 
      ? `<button class="btn s" onclick="openRecoveryModal('${c.name.replace(/'/g, "\\'")}', ${c.amount}, ${c.daysLate}, ${interest})">Recover</button>`
      : "";

    tr.innerHTML = `
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td style="color: var(--text-cream);">${formatINR(c.amount)}</td>
      <td>${statusPillHtml}</td>
      <td>${interestDisplay}</td>
      <td><select class="payment-source-select" aria-label="Payment source for ${escapeHtml(c.name)}">
        <option value="">Choose method</option>
        <option value="UPI">UPI</option>
        <option value="Cash">Cash</option>
        <option value="NetBanking">NetBanking</option>
        <option value="Cheque">Cheque</option>
      </select></td>
      <td class="contact-cell"></td>
      <td style="text-align: right;">${actionBtn}</td>
    `;

    const paymentSelect = tr.querySelector(".payment-source-select");
    paymentSelect.value = state.paymentSources[c.id] || "";
    paymentSelect.addEventListener("change", () => {
      state.paymentSources[c.id] = paymentSelect.value;
      persistPaymentSources();
    });

    const contactButton = document.createElement("button");
    contactButton.type = "button";
    contactButton.className = "btn g s contact-row-button";
    contactButton.textContent = "Contact";
    contactButton.setAttribute("aria-label", `Contact ${c.name} on WhatsApp`);
    contactButton.addEventListener("click", () => openContactComposer(c.name, c.amount, c.daysLate, interest));
    tr.querySelector(".contact-cell").appendChild(contactButton);
    tableBody.appendChild(tr);
  });

  saveDashboardWorkspaceForUser();

  // Update Stat Tiles
  const statPending = document.getElementById("stat-pending");
  if (statPending) statPending.textContent = formatINR(totalPending);

  const statLateCount = document.getElementById("stat-late-count");
  if (statLateCount) statLateCount.textContent = `${lateCount} of ${state.customers.length}`;

  const statInterest = document.getElementById("stat-interest");
  if (statInterest) {
    animateCountUp(statInterest, totalInterest, 1000);
  }
}

function openContactComposer(customerName, amount, daysLate, interest) {
  state.contactDraft = { customerName, amount, daysLate, interest };
  const customerLabel = document.getElementById("contact-compose-customer");
  const phoneInput = document.getElementById("contact-phone-number");
  const modal = document.getElementById("contact-compose-modal");
  if (customerLabel) customerLabel.textContent = `Preparing a WhatsApp message for ${customerName}.`;
  if (phoneInput) phoneInput.value = "";
  const friendlyChoice = document.querySelector('input[name="contact-message-type"][value="friendly"]');
  if (friendlyChoice) friendlyChoice.checked = true;
  if (modal) modal.classList.add("show");
  if (phoneInput) setTimeout(() => phoneInput.focus(), 0);
}

function closeContactComposer() {
  const modal = document.getElementById("contact-compose-modal");
  if (modal) modal.classList.remove("show");
}

function proceedWithWhatsApp() {
  const phoneInput = document.getElementById("contact-phone-number");
  const rawNumber = (phoneInput?.value || "").trim();
  const hasCountryCode = rawNumber.startsWith("+") || rawNumber.startsWith("00");
  let digits = rawNumber.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!hasCountryCode || digits.length < 8 || digits.length > 15) {
    showToast("Enter a valid number with country code, such as +91 98765 43210.");
    phoneInput?.focus();
    return;
  }
  if (!state.contactDraft) return;

  const { customerName, amount, daysLate, interest } = state.contactDraft;
  const selectedType = document.querySelector('input[name="contact-message-type"]:checked')?.value || "friendly";
  const timing = daysLate > 0 ? `${daysLate} days overdue` : daysLate === 0 ? "due today" : `due in ${Math.abs(daysLate)} days`;
  let message;
  if (selectedType === "legal") {
    message = `DRAFT PAYMENT NOTICE\n\nTo: ${customerName}\n\nOur records show an outstanding invoice of ${formatINR(amount)}, ${timing}. Illustrative interest to date is ${formatINR(interest)}. Please contact us to resolve the outstanding amount.\n\nThis is a draft for review. Verify the invoice details, legal eligibility, and wording before sending.`;
  } else {
    message = `Namaste ${customerName} ji,\n\nA friendly reminder that the invoice amount of ${formatINR(amount)} is ${timing}. Please let us know when payment can be expected.\n\nThank you.`;
  }

  const whatsappUrl = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  closeContactComposer();
}
window.refreshDashboardForCurrentUser = renderDashboard;
window.initializeDashboardWorkspaceForUser = initializeDashboardWorkspaceForUser;

function remindAllLate() {
  showToast("Demo: friendly reminders queued for all late customers");
}

/**
 * PAGE 4: SCAN A BILL
 */
function triggerScan() {
  if (state.scan.isScanning) return;
  state.scan.isScanning = true;

  const scanLine = document.getElementById("scan-line");
  const aiStatus = document.getElementById("ai-status");
  const aiCust = document.getElementById("ai-customer");
  const aiAmt = document.getElementById("ai-amount");
  const aiDate = document.getElementById("ai-date");
  const aiDue = document.getElementById("ai-due");
  const addBtn = document.getElementById("btn-add-dashboard");

  // Reset fields to "…"
  if (aiStatus) aiStatus.textContent = "Reading the bill…";
  if (aiCust) aiCust.textContent = "…";
  if (aiAmt) aiAmt.textContent = "…";
  if (aiDate) aiDate.textContent = "…";
  if (aiDue) aiDue.textContent = "…";
  if (addBtn) addBtn.style.display = "none";

  // Trigger scan line animation
  if (scanLine) {
    scanLine.classList.remove("scanning");
    void scanLine.offsetWidth; // trigger reflow
    scanLine.classList.add("scanning");
  }

  // Sequential reveal of extracted fields:
  // Mehra Hardware, ₹45,312, 14 Oct 2026, 13 Nov 2026 (30 days)
  setTimeout(() => {
    if (aiCust) aiCust.textContent = "Mehra Hardware";
  }, 700);

  setTimeout(() => {
    if (aiAmt) aiAmt.textContent = "₹45,312";
  }, 1120);

  setTimeout(() => {
    if (aiDate) aiDate.textContent = "14 Oct 2026";
  }, 1540);

  setTimeout(() => {
    if (aiDue) aiDue.textContent = "13 Nov 2026 (30 days)";
  }, 1960);

  setTimeout(() => {
    if (aiStatus) aiStatus.textContent = "Done. Check the details and add them.";
    if (addBtn) addBtn.style.display = "block";
    state.scan.draftData = {
      customer: "Mehra Hardware",
      invoice_number: "DEMO-1042",
      amount_paise: 4531200,
      invoice_date: "2026-10-14",
      credit_days: 30
    };
    state.scan.isScanning = false;
  }, 2500);
}

async function addScannedBillToDashboard() {
  const draft = state.scan.draftData || {};
  const customerName = (draft.customer || "").trim();
  const amountPaise = draft.amount_paise ?? draft.amount;
  const invoiceDate = draft.invoice_date;
  const creditDays = Number.isInteger(draft.credit_days) ? draft.credit_days : 15;

  if (!customerName || !Number.isInteger(amountPaise) || amountPaise <= 0 || !invoiceDate) {
    showToast("Scan or enter the customer, amount, and invoice date before adding.");
    return;
  }

  if (API_BASE && !getActiveLocalUsername()) {
    try {
      const customersList = await fetchApi("/customers");
      let cust = (customersList || []).find(c => c.name === customerName);
      if (!cust) {
        cust = await fetchApi("/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: customerName, business_name: customerName, phone: null })
        });
      }
      if (!cust || !cust.id) {
        showToast("Could not save the customer. Check that the backend is running.");
        return;
      }

      const saved = await fetchApi("/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: cust.id,
          invoice_no: draft.invoice_number || `SCAN-${Date.now()}`,
          amount: amountPaise,
          invoice_date: invoiceDate,
          credit_days: creditDays,
          status: "sent",
          confirmed_by_user: true
        })
      });
      if (!saved || !saved.invoice_id) {
        showToast("Invoice was not saved. Check the backend terminal for the error.");
        return;
      }

      state.scan.draftData = null;
      showToast("Bill saved. Refreshing dashboard…");
      await renderDashboard();
      window.location.hash = "#dashboard";
      return;
    } catch (e) {
      console.warn("Backend invoice creation error:", e);
      showToast("Could not save the invoice. Check that the backend is running.");
      return;
    }
  }

  const numAmount = Math.round(amountPaise / 100);
  const [year, month, day] = invoiceDate.split("-").map(Number);
  const dueTimestamp = Date.UTC(year, month - 1, day) + Math.min(creditDays, 45) * 86400000;
  const now = new Date();
  const todayTimestamp = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const daysLate = Math.floor((todayTimestamp - dueTimestamp) / 86400000);
  state.customers.push({
    id: "local-invoice-" + Date.now(),
    name: customerName,
    amount: numAmount,
    daysLate: daysLate,
    avgDelay: 0,
    isNew: true
  });
  saveDashboardWorkspaceForUser();
  state.scan.draftData = null;
  showToast("Bill added to this account's dashboard");
  window.location.hash = "#dashboard";
  await renderDashboard();
}
function setupFileDropZone() {
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("bill-file-input");

  if (!dropZone || !fileInput) return;

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUploadedBillFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) {
      handleUploadedBillFile(fileInput.files[0]);
    }
  });
}

async function handleUploadedBillFile(file) {
  const billPreviewImg = document.getElementById("bill-preview-img");
  const billContent = document.getElementById("bill-content");

  if (file.type.startsWith("image/")) {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (billPreviewImg) {
        billPreviewImg.src = e.target.result;
        billPreviewImg.style.display = "block";
      }
      if (billContent) {
        billContent.style.display = "none";
      }
    };
    reader.readAsDataURL(file);
  } else {
    if (billContent) billContent.style.display = "block";
  }

  // If connected to API, call OCR extraction route
  if (API_BASE) {
    try {
      state.scan.isScanning = true;
      const scanLine = document.getElementById("scan-line");
      if (scanLine) {
        scanLine.classList.remove("scanning");
        void scanLine.offsetWidth;
        scanLine.classList.add("scanning");
      }
      const aiStatus = document.getElementById("ai-status");
      if (aiStatus) aiStatus.textContent = "Reading the bill with Gemini…";

      const formData = new FormData();
      formData.append("file", file);

      const resp = await fetch(API_BASE.replace(/\/$/, "") + "/scan/extract", {
        method: "POST",
        headers: { "X-Supplier-Id": DEMO_SUPPLIER_ID },
        body: formData
      });

      if (resp.ok) {
        const result = await resp.json();
        const custName = result.customer || "";
        const amtPaise = result.amount ?? result.amount_paise ?? null;
        const amtRupees = Number.isInteger(amtPaise) ? Math.round(amtPaise / 100) : null;
        const invDate = result.invoice_date || "";
        const creditDays = Number.isInteger(result.credit_days) ? result.credit_days : 15;
        const dueDate = result.due_date || (invDate
          ? new Date(new Date(`${invDate}T00:00:00Z`).getTime() + creditDays * 86400000).toISOString().slice(0, 10)
          : "");
        state.scan.draftData = { ...result, customer: custName, amount_paise: amtPaise, invoice_date: invDate, credit_days: creditDays };

        document.getElementById("ai-customer").textContent = custName || "Not detected — enter manually";
        document.getElementById("ai-amount").textContent = amtRupees !== null ? formatINR(amtRupees) : "Not detected — enter manually";
        document.getElementById("ai-date").textContent = invDate || "Not detected — enter manually";
        document.getElementById("ai-due").textContent = dueDate ? `${dueDate} (${creditDays} days)` : "Set invoice date before adding";
        document.getElementById("ai-status").textContent = "Done. Check the details and add them.";
        document.getElementById("btn-add-dashboard").style.display = "block";
        state.scan.isScanning = false;
        return;
      }
    } catch (e) {
      console.warn("Scan extract API failed, using demo simulation:", e);
    }
  }

  // Fallback demo simulation
  triggerScan();
}

/**
 * PAGE 5: CASH ALERT LOGIC & SVG CHART
 */
function calculateCashProjection() {
  const weeks = 12;
  const totals = Array.from({ length: weeks + 1 }, () => 0);
  let overdueTotal = 0;
  let dueSoonTotal = 0;
  let overdueCount = 0;

  state.customers.forEach(invoice => {
    const amount = Number(invoice.amount) || 0;
    const daysLate = Number(invoice.daysLate) || 0;
    const daysUntilDue = Math.max(0, -daysLate);
    const week = Math.min(weeks, Math.ceil(daysUntilDue / 7));
    totals[week] += amount;
    if (daysLate > 0) {
      overdueTotal += amount;
      overdueCount++;
    }
    if (daysUntilDue <= 30) dueSoonTotal += amount;
  });

  let collected = 0;
  const points = totals.map((amount, week) => {
    collected += amount;
    return { w: week, balance: collected };
  });
  return { points, overdueTotal, overdueCount, dueSoonTotal, total: collected };
}

function renderCashAlert() {
  const localUsername = getActiveLocalUsername();
  if (localUsername) loadDashboardWorkspaceForUser(localUsername);
  const { points, overdueTotal, overdueCount, dueSoonTotal, total } = calculateCashProjection();
  const verdictEl = document.getElementById("cash-verdict");
  const explEl = document.getElementById("cash-expl");
  const chartEl = document.getElementById("cash-chart");
  if (verdictEl) {
    verdictEl.textContent = overdueCount
      ? `${overdueCount} overdue invoice${overdueCount === 1 ? "" : "s"} · ${formatINR(overdueTotal)} outstanding`
      : "No overdue invoices";
    verdictEl.className = overdueCount ? "cash-verdict danger" : "cash-verdict safe";
  }
  if (explEl) {
    explEl.textContent = total
      ? `${formatINR(dueSoonTotal)} is due now or within 30 days. The chart shows cumulative invoice amounts by due date.`
      : "No invoices yet. Add or scan an invoice and this forecast will use its amount and due date.";
  }
  if (!chartEl) return;

  const maxValue = Math.max(total, 1);
  const top = maxValue * 1.15;
  const toX = week => 10 + (week / 12) * 680;
  const toY = value => 205 - (value / top) * 180;
  let pathD = `M ${toX(0).toFixed(1)} ${toY(0).toFixed(1)}`;
  points.forEach((point, index) => {
    if (index === 0) {
      pathD += ` L ${toX(0).toFixed(1)} ${toY(point.balance).toFixed(1)}`;
      return;
    }
    pathD += ` L ${toX(index).toFixed(1)} ${toY(points[index - 1].balance).toFixed(1)}`;
    pathD += ` L ${toX(index).toFixed(1)} ${toY(point.balance).toFixed(1)}`;
  });
  const areaD = `${pathD} L ${toX(12).toFixed(1)} 205 L ${toX(0).toFixed(1)} 205 Z`;
  chartEl.innerHTML = `
    <defs><linearGradient id="chartAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#3ddc97" stop-opacity="0.42"/><stop offset="100%" stop-color="#3ddc97" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${areaD}" fill="url(#chartAreaGrad)"/>
    <path d="${pathD}" fill="none" stroke="#3ddc97" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="10" y="225" fill="rgba(255,255,255,0.55)" font-size="11" font-family="'DM Sans', sans-serif">Due now</text>
    <text x="350" y="225" fill="rgba(255,255,255,0.55)" font-size="11" text-anchor="middle" font-family="'DM Sans', sans-serif">Week 6 · ${escapeHtml(formatINR(points[6].balance))}</text>
    <text x="690" y="225" fill="rgba(255,255,255,0.55)" font-size="11" text-anchor="end" font-family="'DM Sans', sans-serif">Week 12+ · ${escapeHtml(formatINR(total))}</text>
  `;
}

/**
 * PAGE 6: CUSTOMERS RATING
 */
async function renderCustomersList() {
  const container = document.getElementById("customers-list");
  if (!container) return;

  if (API_BASE) {
    const scores = await fetchApi("/customer-scores");
    if (scores && Array.isArray(scores) && scores.length > 0) {
      scores.forEach(s => {
        const found = state.customers.find(c => c.name === s.customer_name);
        if (found) {
          found.avgDelay = s.avg_days_late;
        }
      });
    }
  }

  // Sorted by most overdue (daysLate descending)
  const sorted = [...state.customers].sort((a, b) => b.daysLate - a.daysLate);

  container.innerHTML = "";

  sorted.forEach(c => {
    const row = document.createElement("div");
    row.className = "customer-row";

    const avg = c.avgDelay;
    let label = "Safe";
    let pillClass = "pill-ok";
    let barColor = "var(--tulsi-green)";

    if (avg > 60) {
      label = "Risky";
      pillClass = "pill-late";
      barColor = "var(--kumkum-red)";
    } else if (avg > 30) {
      label = "Watch";
      pillClass = "pill-warn";
      barColor = "var(--marigold)";
    }

    const fillWidth = Math.min(100, Math.max(0, avg));

    row.innerHTML = `
      <div style="font-weight: bold; font-size: 15px; color: var(--text-cream);">${escapeHtml(c.name)}</div>
      <div class="meter-track" aria-label="${label} payment meter">
        <div class="meter-fill" style="width: ${fillWidth}%; background-color: ${barColor};"></div>
      </div>
      <div>
        <span class="pill ${pillClass}">${label} · ${avg} days avg</span>
      </div>
    `;
    container.appendChild(row);
  });
}

/**
 * PAGE 8: BUYER VIEW
 */
function renderBuyerView() {
  const statusPill = document.getElementById("buyer-status-pill");
  const acceptBtn = document.getElementById("btn-buyer-accept");

  if (statusPill) {
    if (state.buyerInvoice.accepted) {
      statusPill.textContent = "Invoice accepted";
      statusPill.className = "pill pill-ok";
    } else {
      statusPill.textContent = "Awaiting acceptance";
      statusPill.className = "pill pill-warn";
    }
  }

  if (acceptBtn) {
    if (state.buyerInvoice.accepted) {
      acceptBtn.disabled = true;
      acceptBtn.style.opacity = "0.6";
      acceptBtn.textContent = "Accepted ✓";
    } else {
      acceptBtn.disabled = false;
      acceptBtn.style.opacity = "1";
      acceptBtn.textContent = "Accept invoice and terms";
    }
  }
}

function acceptBuyerInvoice() {
  state.buyerInvoice.accepted = true;
  renderBuyerView();
  showToast("Accepted. Supplier notified");
}

function toggleDisputeOptions() {
  const row = document.getElementById("buyer-dispute-row");
  if (!row) return;
  state.buyerInvoice.disputeOpen = !state.buyerInvoice.disputeOpen;
  row.style.display = state.buyerInvoice.disputeOpen ? "flex" : "none";
}

function raiseDispute(reason) {
  showToast(`Dispute raised: ${reason}. Supplier notified`);
}

/**
 * RECOVERY MODAL
 */
function openRecoveryModal(name, amount, daysLate, interest) {
  state.modal.customerName = name;
  state.modal.amount = amount;
  state.modal.daysLate = daysLate;
  state.modal.interest = interest !== undefined ? interest : calculateInterest(amount, daysLate);
  state.modal.activeTab = "friendly";

  const modalEl = document.getElementById("recovery-modal");
  const titleEm = document.getElementById("modal-customer-name");

  if (titleEm) titleEm.textContent = name;
  updateModalContent();

  if (modalEl) modalEl.classList.add("show");
}

function closeRecoveryModal() {
  const modalEl = document.getElementById("recovery-modal");
  if (modalEl) modalEl.classList.remove("show");
}

function setModalTab(tabName) {
  state.modal.activeTab = tabName;
  const tabFriendly = document.getElementById("modal-tab-friendly");
  const tabLegal = document.getElementById("modal-tab-legal");

  if (tabName === "friendly") {
    if (tabFriendly) { tabFriendly.className = "btn s"; }
    if (tabLegal) { tabLegal.className = "btn g s"; }
  } else {
    if (tabFriendly) { tabFriendly.className = "btn g s"; }
    if (tabLegal) { tabLegal.className = "btn s"; }
  }

  updateModalContent();
}

function updateModalContent() {
  const box = document.getElementById("modal-msg-text");
  if (!box) return;

  const { customerName, amount, daysLate, interest } = state.modal;
  const formattedAmount = formatINR(amount);
  const formattedInterest = formatINR(interest);
  const totalAmount = formatINR(amount + interest);
  const todayStr = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  if (state.modal.activeTab === "friendly") {
    box.textContent = 
`Namaste ${customerName} ji,

A gentle reminder: our bill of ${formattedAmount} was due ${daysLate} days ago and is still pending. It would be a big help if you could clear it this week.

Under the MSMED Act, 2006, late payment carries interest, which stands at ${formattedInterest} so far. We would rather not charge it, so a quick payment keeps things smooth.

Thank you,
Sri Balaji Auto Spares`;
  } else {
    box.textContent = 
`LEGAL NOTICE UNDER THE MSMED ACT, 2006

To: ${customerName}

You owe us ${formattedAmount} for goods supplied, which is overdue by ${daysLate} days.

Under Sections 15 and 16 of the MSMED Act, 2006, you must pay compound interest at three times the RBI bank rate on the delayed amount. Interest due as of today: ${formattedInterest}.

Pay ${totalAmount} within 15 days of this notice. Otherwise we will file a reference with the MSME Facilitation Council.

Sri Balaji Auto Spares
${todayStr}`;
  }
}

function copyModalMessage() {
  const box = document.getElementById("modal-msg-text");
  if (!box) return;

  const text = box.textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast("Copied. Ready to send on WhatsApp");
    }).catch(() => {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    showToast("Copied. Ready to send on WhatsApp");
  } catch (err) {
    showToast("Please copy manually from the box");
  }
  document.body.removeChild(ta);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Initialization on DOM Ready
 */
function setupContactMenu() {
  const menu = document.getElementById("contact-menu");
  const trigger = document.getElementById("contact-trigger");
  const options = document.getElementById("contact-options");
  if (!menu || !trigger || !options) return;

  const emailLink = document.getElementById("contact-email");
  const whatsappLink = document.getElementById("contact-whatsapp");
  const callLink = document.getElementById("contact-call");
  const email = CONTACT_EMAIL.trim();
  const phone = CONTACT_PHONE.replace(/\D/g, "");
  if (email && emailLink) emailLink.href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;
  if (phone && whatsappLink) whatsappLink.href = `https://wa.me/${phone}`;
  if (phone && callLink) callLink.href = `tel:+${phone}`;

  const closeMenu = () => {
    options.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  trigger.addEventListener("click", () => {
    const open = trigger.getAttribute("aria-expanded") !== "true";
    trigger.setAttribute("aria-expanded", String(open));
    options.hidden = !open;
  });
  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target)) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
      trigger.focus();
    }
  });
}
document.addEventListener("DOMContentLoaded", () => {
  // Setup file drag and drop
  setupContactMenu();
  const contactForm = document.getElementById("contact-compose-form");
  if (contactForm) contactForm.addEventListener("submit", (event) => {
    event.preventDefault();
    proceedWithWhatsApp();
  });
  const contactBackdrop = document.getElementById("contact-compose-modal");
  if (contactBackdrop) contactBackdrop.addEventListener("click", (event) => {
    if (event.target === contactBackdrop) closeContactComposer();
  });
  setupFileDropZone();

  // Setup Cash Alert slider listener
  const slider = document.getElementById("credit-slider");
  if (slider) {
    slider.addEventListener("input", renderCashAlert);
  }

  // Setup Modal backdrop click to close
  const modalBackdrop = document.getElementById("recovery-modal");
  if (modalBackdrop) {
    modalBackdrop.addEventListener("click", (e) => {
      if (e.target === modalBackdrop) {
        closeRecoveryModal();
        closeContactComposer();
      }
    });
  }

  // Close modal on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeRecoveryModal();
      closeContactComposer();
    }
  });

  // Listen to hash change
  window.addEventListener("hashchange", handleRoute);

  // Initial Route Load
  handleRoute();
});
