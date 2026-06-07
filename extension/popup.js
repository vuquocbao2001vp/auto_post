const supabaseUrlInput = document.getElementById("supabase-url");
const supabaseAnonKeyInput = document.getElementById("supabase-anon-key");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const browserIdInput = document.getElementById("browser-id");
const sessionStatus = document.getElementById("session-status");
const messageElement = document.getElementById("message");
const configForm = document.getElementById("config-form");
const signOutButton = document.getElementById("sign-out-button");
const pollNowButton = document.getElementById("poll-now-button");

function setMessage(message, kind = "") {
  messageElement.textContent = message || "";
  messageElement.className = kind ? `message ${kind}` : "message";
}

function setStatus(message) {
  sessionStatus.textContent = message;
}

async function loadState() {
  const state = await chrome.storage.local.get(["config", "session"]);
  const config = state.config || {};
  const session = state.session || null;

  supabaseUrlInput.value = config.supabaseUrl || "";
  supabaseAnonKeyInput.value = config.supabaseAnonKey || "";
  emailInput.value = config.email || "";
  browserIdInput.value = config.browserId || crypto.randomUUID();

  if (!config.browserId) {
    await chrome.storage.local.set({
      config: {
        ...config,
        browserId: browserIdInput.value
      }
    });
  }

  setStatus(session?.access_token ? `Signed in until ${new Date(session.expires_at * 1000).toLocaleString()}` : "Signed out");
}

async function saveConfig() {
  const currentState = await chrome.storage.local.get(["config"]);
  const config = currentState.config || {};

  const nextConfig = {
    ...config,
    supabaseUrl: supabaseUrlInput.value.trim(),
    supabaseAnonKey: supabaseAnonKeyInput.value.trim(),
    email: emailInput.value.trim(),
    browserId: browserIdInput.value.trim()
  };

  await chrome.storage.local.set({ config: nextConfig });
  return nextConfig;
}

async function signIn(event) {
  event.preventDefault();
  setMessage("");

  const config = await saveConfig();

  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.supabaseAnonKey
      },
      body: JSON.stringify({
        email: emailInput.value.trim(),
        password: passwordInput.value
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error_description || payload.msg || "Sign-in failed.");
    }

    await chrome.storage.local.set({ session: payload });
    setStatus(`Signed in until ${new Date(payload.expires_at * 1000).toLocaleString()}`);
    setMessage("Extension session saved.", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "Sign-in failed.", "error");
  }
}

async function signOut() {
  const state = await chrome.storage.local.get(["config", "session"]);
  const config = state.config || {};
  const session = state.session || null;

  if (session?.access_token) {
    try {
      await fetch(`${config.supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${session.access_token}`
        }
      });
    } catch (_error) {
      // Ignore remote logout errors and clear local state anyway.
    }
  }

  await chrome.storage.local.remove("session");
  setStatus("Signed out");
  setMessage("Local extension session cleared.", "success");
}

async function pollNow() {
  setMessage("");
  const response = await chrome.runtime.sendMessage({ type: "poll-now" });

  if (!response) {
    setMessage("No response from background worker.", "error");
    return;
  }

  if (!response.ok) {
    setMessage(response.error || "Poll failed.", "error");
    return;
  }

  setMessage(response.message || "Poll completed.", "success");
}

configForm.addEventListener("submit", signIn);
signOutButton.addEventListener("click", signOut);
pollNowButton.addEventListener("click", pollNow);

loadState().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load extension state.", "error"));
