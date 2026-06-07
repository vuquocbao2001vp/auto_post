const ALARM_NAME = "auto-post-poll";
const POLL_INTERVAL_MINUTES = 1;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void pollDueSchedules();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "poll-now") {
    return false;
  }

  pollDueSchedules()
    .then((result) => sendResponse({ ok: true, message: result }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Poll failed." }));

  return true;
});

async function pollDueSchedules() {
  const state = await chrome.storage.local.get(["config", "session"]);
  const config = state.config;
  const session = state.session;

  if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
    return "Supabase config missing in extension popup.";
  }

  if (!session?.access_token) {
    return "Extension is signed out.";
  }

  const validSession = await ensureValidSession(config, session);
  if (!validSession?.access_token) {
    return "Could not refresh extension session.";
  }

  const job = await claimDueSchedule(config, validSession);
  if (!job) {
    return "No due schedule.";
  }

  await processClaimedJob(config, validSession, job);
  return `Processed schedule ${job.schedule_id}.`;
}

async function ensureValidSession(config, session) {
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - 60 > now) {
    return session;
  }

  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.supabaseAnonKey
    },
    body: JSON.stringify({
      refresh_token: session.refresh_token
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    await chrome.storage.local.remove("session");
    throw new Error(payload.error_description || "Session refresh failed.");
  }

  await chrome.storage.local.set({ session: payload });
  return payload;
}

function getRestHeaders(config, session) {
  return {
    "Content-Type": "application/json",
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${session.access_token}`
  };
}

async function claimDueSchedule(config, session) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/claim_due_schedule`, {
    method: "POST",
    headers: getRestHeaders(config, session),
    body: JSON.stringify({
      p_browser_id: config.browserId || "browser"
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || "Failed to claim due schedule.");
  }

  return payload;
}

async function completeJobRun(config, session, jobRunId, status, errorMessage = null) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/complete_job_run`, {
    method: "POST",
    headers: getRestHeaders(config, session),
    body: JSON.stringify({
      p_job_run_id: jobRunId,
      p_status: status,
      p_error_message: errorMessage
    })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Could not complete job run.");
  }
}

async function insertExecutionLog(config, session, logPayload) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/execution_logs`, {
    method: "POST",
    headers: {
      ...getRestHeaders(config, session),
      Prefer: "return=minimal"
    },
    body: JSON.stringify(logPayload)
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Could not write execution log.");
  }
}

async function processClaimedJob(config, session, job) {
  const groups = Array.isArray(job.groups) ? job.groups : [];
  let successCount = 0;
  let failureCount = 0;
  let fatalError = null;

  for (const group of groups) {
    let tabId = null;

    try {
      const tab = await chrome.tabs.create({ url: group.url, active: false });
      tabId = tab.id;
      await waitForTab(tabId);

      const loginState = await inject(tabId, detectFacebookSessionState);
      if (loginState !== "ok") {
        await insertExecutionLog(config, session, {
          job_run_id: job.job_run_id,
          schedule_id: job.schedule_id,
          user_id: await getUserId(config, session),
          group_url: group.url,
          status: loginState === "checkpoint" ? "checkpoint" : "login_required",
          step: "open_group",
          message: loginState === "checkpoint" ? "Facebook checkpoint detected." : "Facebook login required."
        });
        fatalError = loginState === "checkpoint" ? "Facebook checkpoint detected." : "Facebook login required.";
        failureCount += 1;
        break;
      }

      await ensureStep(
        tabId,
        openComposer,
        undefined,
        config,
        session,
        {
          job,
          groupUrl: group.url,
          status: "ui_not_found",
          step: "open_composer",
          message: "Could not find the post composer on the group page."
        }
      );
      await pause(1500);

      await ensureStep(
        tabId,
        fillPostBody,
        {
          body: job.body || ""
        },
        config,
        session,
        {
          job,
          groupUrl: group.url,
          status: "ui_not_found",
          step: "fill_text",
          message: "Could not fill the post body."
        }
      );
      await pause(1000);

      if (Array.isArray(job.media_files) && job.media_files.length > 0) {
        const mediaData = await Promise.all(job.media_files.map((file) => toUploadPayload(file)));
        await ensureStep(
          tabId,
          uploadMediaFiles,
          {
            mediaFiles: mediaData
          },
          config,
          session,
          {
            job,
            groupUrl: group.url,
            status: "upload_failed",
            step: "upload_media",
            message: "Could not upload media into the Facebook composer."
          }
        );
        await pause(1500);
      }

      const submitResult = await inject(tabId, submitPost);
      if (!submitResult?.ok) {
        throw new Error(submitResult?.message || "Could not submit the post.");
      }

      await insertExecutionLog(config, session, {
        job_run_id: job.job_run_id,
        schedule_id: job.schedule_id,
        user_id: await getUserId(config, session),
        group_url: group.url,
        status: submitResult.pending ? "pending_approval" : "success",
        step: "submit_post",
        message: submitResult.message
      });

      successCount += 1;
    } catch (error) {
      failureCount += 1;
      const message = error instanceof Error ? error.message : "Unknown posting error.";
      await insertExecutionLog(config, session, {
        job_run_id: job.job_run_id,
        schedule_id: job.schedule_id,
        user_id: await getUserId(config, session),
        group_url: group.url,
        status: "unknown_error",
        step: "submit_post",
        message
      });
    } finally {
      await closeTab(tabId);
    }
  }

  const finalStatus = failureCount === 0 ? "success" : successCount > 0 ? "partial_error" : "failed";
  await completeJobRun(config, session, job.job_run_id, finalStatus, fatalError);
}

function pause(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function ensureStep(tabId, fn, args, config, session, fallback) {
  const result = await inject(tabId, fn, args);
  if (result?.ok) {
    return result;
  }

  await insertExecutionLog(config, session, {
    job_run_id: fallback.job.job_run_id,
    schedule_id: fallback.job.schedule_id,
    user_id: await getUserId(config, session),
    group_url: fallback.groupUrl,
    status: fallback.status,
    step: fallback.step,
    message: result?.message || fallback.message
  });

  throw new Error(result?.message || fallback.message);
}

async function getUserId(config, session) {
  if (session.user?.id) {
    return session.user.id;
  }

  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`
    }
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.msg || "Could not resolve user id.");
  }

  session.user = payload;
  await chrome.storage.local.set({ session });
  return payload.id;
}

function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out while waiting for Facebook group tab to load."));
    }, 30000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1500);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function closeTab(tabId) {
  if (typeof tabId === "number") {
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

async function inject(tabId, func, args) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args: args ? [args] : []
  });

  return result;
}

async function toUploadPayload(file) {
  const response = await fetch(file.url);
  if (!response.ok) {
    throw new Error(`Could not fetch media file ${file.name}.`);
  }

  const blob = await response.blob();
  const dataUrl = await blobToDataUrl(blob);
  return {
    name: file.name,
    type: file.type || blob.type,
    dataUrl
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not convert media blob to data URL."));
    reader.readAsDataURL(blob);
  });
}

function detectFacebookSessionState() {
  const text = document.body?.innerText?.toLowerCase() || "";
  const path = window.location.pathname.toLowerCase();

  if (text.includes("checkpoint") || path.includes("checkpoint")) {
    return "checkpoint";
  }

  if (path.includes("/login") || text.includes("log in to facebook") || text.includes("password")) {
    return "login_required";
  }

  return "ok";
}

function openComposer() {
  const selectors = [
    'div[role="button"][aria-label*="Write something"]',
    'div[role="button"][aria-label*="Create a public post"]',
    'div[role="button"][aria-label*="What\'s on your mind"]',
    'div[role="button"][aria-label*="Viết gì đó"]',
    'div[role="button"][aria-label*="Bạn viết gì đi"]'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLElement) {
      element.click();
      return { ok: true, message: "Composer opened." };
    }
  }

  return { ok: false, message: "Composer button not found." };
}

function fillPostBody({ body }) {
  const candidates = [
    'div[role="dialog"] div[contenteditable="true"][data-lexical-editor="true"]',
    'div[role="dialog"] div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]'
  ];

  for (const selector of candidates) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLElement) {
      element.focus();
      element.innerHTML = "";
      document.execCommand("insertText", false, body);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, data: body, inputType: "insertText" }));
      return { ok: true, message: "Post body filled." };
    }
  }

  return { ok: false, message: "Could not find text editor." };
}

function uploadMediaFiles({ mediaFiles }) {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    return { ok: false, message: "Media file input not found." };
  }

  const fileList = mediaFiles.map((media) => {
    const [meta, base64] = media.dataUrl.split(",");
    const mimeMatch = meta.match(/data:(.*);base64/);
    const mimeType = mimeMatch ? mimeMatch[1] : media.type || "application/octet-stream";
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const file = new File([bytes], media.name, { type: mimeType });
    return file;
  });

  const dataTransfer = new DataTransfer();
  fileList.forEach((file) => dataTransfer.items.add(file));
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));

  return { ok: true, message: `Attached ${fileList.length} media file(s).` };
}

function submitPost() {
  const selectors = [
    'div[role="dialog"] div[aria-label="Post"]',
    'div[role="dialog"] div[aria-label="Đăng"]',
    'div[role="dialog"] [role="button"][aria-label="Post"]',
    'div[role="dialog"] [role="button"][aria-label="Đăng"]'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLElement) {
      element.click();
      const bodyText = document.body?.innerText?.toLowerCase() || "";
      return {
        ok: true,
        pending: bodyText.includes("admin approval") || bodyText.includes("quản trị viên phê duyệt"),
        message: "Submit button clicked."
      };
    }
  }

  return { ok: false, message: "Submit button not found." };
}
