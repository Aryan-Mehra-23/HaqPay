/* Local demo username/password accounts. This is not production authentication:
   accounts and password hashes are stored in this browser's local storage. */
const DEMO_ACCOUNTS_KEY = "haqpay-local-demo-accounts-v1";
const DEMO_SESSION_KEY = "haqpay-local-demo-session-v1";
let authMode = "signin";
let pendingAuthRoute = "#dashboard";

function setAuthFeedback(message, isError) {
  const feedback = document.getElementById("auth-feedback");
  if (!feedback) return;
  feedback.textContent = message || "";
  feedback.classList.toggle("is-error", Boolean(isError));
}

function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "signin";
  const signInTab = document.getElementById("auth-signin-tab");
  const signUpTab = document.getElementById("auth-signup-tab");
  const submit = document.getElementById("auth-submit");
  const password = document.getElementById("auth-password");
  if (signInTab) {
    signInTab.className = authMode === "signin" ? "btn s" : "btn g s";
    signInTab.setAttribute("aria-pressed", String(authMode === "signin"));
  }
  if (signUpTab) {
    signUpTab.className = authMode === "signup" ? "btn s" : "btn g s";
    signUpTab.setAttribute("aria-pressed", String(authMode === "signup"));
  }
  if (submit) submit.textContent = authMode === "signup" ? "Create account" : "Sign in";
  if (password) password.autocomplete = authMode === "signup" ? "new-password" : "current-password";
  setAuthFeedback("");
}

function openAuthModal(returnRoute) {
  const protectedRoutes = ["#dashboard", "#scan", "#cash", "#customers", "#bank", "#buyer", "#pricing"];
  pendingAuthRoute = protectedRoutes.includes(returnRoute) ? returnRoute : "#dashboard";
  const modal = document.getElementById("auth-modal");
  const username = document.getElementById("auth-username");
  const password = document.getElementById("auth-password");
  if (username) username.value = "";
  if (password) password.value = "";
  setAuthMode("signin");
  if (modal) modal.classList.add("show");
}

function closeAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (modal) modal.classList.remove("show");
}

function readDemoAccounts() {
  try {
    const accounts = JSON.parse(localStorage.getItem(DEMO_ACCOUNTS_KEY) || "{}");
    return accounts && typeof accounts === "object" && !Array.isArray(accounts) ? accounts : {};
  } catch (_) {
    return {};
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(function (byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

async function hashDemoPassword(password, saltHex) {
  if (!window.crypto || !window.crypto.subtle || !window.crypto.getRandomValues) {
    throw new Error("Password hashing needs a secure local address. Start the page with VS Code Live Server.");
  }
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{2}/g).map(function (part) { return parseInt(part, 16); }))
    : window.crypto.getRandomValues(new Uint8Array(16));
  const key = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await window.crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt, iterations: 150000, hash: "SHA-256" },
    key,
    256
  );
  return { salt: bytesToHex(salt), hash: bytesToHex(new Uint8Array(bits)) };
}

function renderAuthProfile(username) {
  const loginButton = document.getElementById("login-trigger");
  const profile = document.getElementById("dashboard-profile");
  const profileName = document.getElementById("profile-name");
  const profileIdentity = document.getElementById("profile-identity");
  const profileMenu = document.getElementById("profile-menu");
  if (loginButton) loginButton.hidden = Boolean(username);
  if (profile) profile.hidden = !username;
  if (profileMenu) profileMenu.hidden = !username;
  if (username) {
    if (profileName) profileName.textContent = username;
    if (profileIdentity) profileIdentity.textContent = "Local browser account";
  }
}

async function submitCredentials(event) {
  event.preventDefault();
  const usernameInput = document.getElementById("auth-username");
  const passwordInput = document.getElementById("auth-password");
  const username = (usernameInput ? usernameInput.value : "").trim();
  const password = passwordInput ? passwordInput.value : "";
  const normalizedUsername = username.toLowerCase();

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    setAuthFeedback("Use 3–32 letters, numbers, dots, underscores, or hyphens for the username.", true);
    if (usernameInput) usernameInput.focus();
    return;
  }
  if (password.length < 8) {
    setAuthFeedback("Use a password with at least 8 characters.", true);
    if (passwordInput) passwordInput.focus();
    return;
  }

  const accounts = readDemoAccounts();
  try {
    if (authMode === "signup") {
      if (accounts[normalizedUsername]) {
        setAuthFeedback("That username already exists in this browser. Sign in instead.", true);
        return;
      }
      const credential = await hashDemoPassword(password);
      accounts[normalizedUsername] = { username: username, salt: credential.salt, hash: credential.hash };
      localStorage.setItem(DEMO_ACCOUNTS_KEY, JSON.stringify(accounts));
      if (typeof window.initializeDashboardWorkspaceForUser === "function") {
        window.initializeDashboardWorkspaceForUser(normalizedUsername);
      }
    } else {
      const account = accounts[normalizedUsername];
      if (!account) {
        setAuthFeedback("No account with that username exists in this browser. Sign up first.", true);
        return;
      }
      const credential = await hashDemoPassword(password, account.salt);
      if (credential.hash !== account.hash) {
        setAuthFeedback("Username or password is incorrect.", true);
        return;
      }
    }

    sessionStorage.setItem(DEMO_SESSION_KEY, normalizedUsername);
    renderAuthProfile(username);
    closeAuthModal();
    if (typeof window.refreshDashboardForCurrentUser === "function") {
      await window.refreshDashboardForCurrentUser();
    }
    window.location.hash = pendingAuthRoute;
    pendingAuthRoute = "#dashboard";
  } catch (error) {
    setAuthFeedback(error.message || "Could not save this local demo account.", true);
  }
}

function signOutUser() {
  try {
    sessionStorage.removeItem(DEMO_SESSION_KEY);
  } catch (_) {
    // Keep the current view usable if browser storage is unavailable.
  }
  renderAuthProfile(null);
  if (!["#home", "#how"].includes(window.location.hash)) window.location.hash = "#home";
  pendingAuthRoute = "#dashboard";
  const menu = document.getElementById("profile-menu");
  const button = document.getElementById("profile-button");
  if (menu) menu.hidden = true;
  const profileControl = document.getElementById("dashboard-profile");
  if (profileControl) profileControl.classList.remove("is-open");
  if (button) button.setAttribute("aria-expanded", "false");
}

function initializeLocalDemoAuth() {
  try {
    const username = sessionStorage.getItem(DEMO_SESSION_KEY);
    const account = username ? readDemoAccounts()[username] : null;
    renderAuthProfile(account ? account.username : null);
  } catch (_) {
    renderAuthProfile(null);
  }

  const profileControl = document.getElementById("dashboard-profile");
  const profileButton = document.getElementById("profile-button");
  const profileMenu = document.getElementById("profile-menu");
  if (profileButton && profileControl) {
    profileButton.addEventListener("click", function () {
      const isOpen = profileControl.classList.toggle("is-open");
      profileButton.setAttribute("aria-expanded", String(isOpen));
    });
    profileControl.addEventListener("pointerenter", function () {
      profileButton.setAttribute("aria-expanded", "true");
    });
    profileControl.addEventListener("pointerleave", function () {
      if (!profileControl.classList.contains("is-open")) profileButton.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("click", function (event) {
      if (!profileControl.contains(event.target)) {
        profileControl.classList.remove("is-open");
        profileButton.setAttribute("aria-expanded", "false");
      }
    });
  }
  const form = document.getElementById("auth-credentials-form");
  if (form) form.addEventListener("submit", submitCredentials);
  const modal = document.getElementById("auth-modal");
  if (modal) modal.addEventListener("click", function (event) {
    if (event.target === modal) closeAuthModal();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeAuthModal();
  });
}

document.addEventListener("DOMContentLoaded", initializeLocalDemoAuth);
window.setAuthMode = setAuthMode;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.signOutUser = signOutUser;
window.getCurrentDemoUsername = function () {
  try { return sessionStorage.getItem(DEMO_SESSION_KEY) || ""; } catch (_) { return ""; }
};