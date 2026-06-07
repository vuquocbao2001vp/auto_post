const ALARM_NAME = "auto-post-poll";
const POLL_INTERVAL_MINUTES = 1;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: POLL_INTERVAL_MINUTES,
  });
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
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Poll failed.",
      }),
    );

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

  const response = await fetch(
    `${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.supabaseAnonKey,
      },
      body: JSON.stringify({
        refresh_token: session.refresh_token,
      }),
    },
  );

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
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function claimDueSchedule(config, session) {
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/rpc/claim_due_schedule`,
    {
      method: "POST",
      headers: getRestHeaders(config, session),
      body: JSON.stringify({
        p_browser_id: config.browserId || "browser",
      }),
    },
  );

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || "Failed to claim due schedule.");
  }

  return payload;
}

async function completeJobRun(
  config,
  session,
  jobRunId,
  status,
  errorMessage = null,
) {
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/rpc/complete_job_run`,
    {
      method: "POST",
      headers: getRestHeaders(config, session),
      body: JSON.stringify({
        p_job_run_id: jobRunId,
        p_status: status,
        p_error_message: errorMessage,
      }),
    },
  );

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
      Prefer: "return=minimal",
    },
    body: JSON.stringify(logPayload),
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
          message:
            loginState === "checkpoint"
              ? "Facebook checkpoint detected."
              : "Facebook login required.",
        });
        fatalError =
          loginState === "checkpoint"
            ? "Facebook checkpoint detected."
            : "Facebook login required.";
        failureCount += 1;
        break;
      }

      await ensureStep(
        tabId,
        moveToDiscussionSection,
        undefined,
        config,
        session,
        {
          job,
          groupUrl: group.url,
          status: "ui_not_found",
          step: "open_group",
          message: "Could not move into the group discussion section.",
        },
      );
      await pause(1800);

      await ensureStep(tabId, openComposer, undefined, config, session, {
        job,
        groupUrl: group.url,
        status: "ui_not_found",
        step: "open_composer",
        message: "Could not find the post composer on the group page.",
      });
      await pause(1500);

      let composerReady = await inject(tabId, detectComposerReady);
      if (!composerReady?.ok) {
        await pause(800);
        await inject(tabId, openComposer);

        for (let attempt = 0; attempt < 8; attempt += 1) {
          await pause(350);
          composerReady = await inject(tabId, detectComposerReady);
          if (composerReady?.ok) {
            break;
          }
        }

        if (!composerReady?.ok) {
          await insertExecutionLog(config, session, {
            job_run_id: job.job_run_id,
            schedule_id: job.schedule_id,
            user_id: await getUserId(config, session),
            group_url: group.url,
            status: "ui_not_found",
            step: "open_composer",
            message:
              composerReady?.message ||
              "Composer click happened, but dialog/editor did not open.",
          });

          throw new Error(
            composerReady?.message ||
              "Composer click happened, but dialog/editor did not open.",
          );
        }
      }

      await ensureStep(
        tabId,
        fillPostBody,
        {
          body: job.body || "",
        },
        config,
        session,
        {
          job,
          groupUrl: group.url,
          status: "ui_not_found",
          step: "fill_text",
          message: "Could not fill the post body.",
        },
      );
      await pause(1000);

      if (Array.isArray(job.media_files) && job.media_files.length > 0) {
        const mediaData = await Promise.all(
          job.media_files.map((file) => toUploadPayload(file)),
        );
        await ensureStep(
          tabId,
          uploadMediaFiles,
          {
            mediaFiles: mediaData,
          },
          config,
          session,
          {
            job,
            groupUrl: group.url,
            status: "upload_failed",
            step: "upload_media",
            message: "Could not upload media into the Facebook composer.",
          },
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
        message: submitResult.message,
      });

      successCount += 1;
    } catch (error) {
      failureCount += 1;
      const message =
        error instanceof Error ? error.message : "Unknown posting error.";
      await insertExecutionLog(config, session, {
        job_run_id: job.job_run_id,
        schedule_id: job.schedule_id,
        user_id: await getUserId(config, session),
        group_url: group.url,
        status: "unknown_error",
        step: "submit_post",
        message,
      });
    } finally {
      await closeTab(tabId);
    }
  }

  const finalStatus =
    failureCount === 0
      ? "success"
      : successCount > 0
        ? "partial_error"
        : "failed";
  await completeJobRun(
    config,
    session,
    job.job_run_id,
    finalStatus,
    fatalError,
  );
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
    message: result?.message || fallback.message,
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
      Authorization: `Bearer ${session.access_token}`,
    },
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
      reject(
        new Error("Timed out while waiting for Facebook group tab to load."),
      );
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
    args: args ? [args] : [],
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
    dataUrl,
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () =>
      reject(new Error("Could not convert media blob to data URL."));
    reader.readAsDataURL(blob);
  });
}

function detectFacebookSessionState() {
  const text = document.body?.innerText?.toLowerCase() || "";
  const path = window.location.pathname.toLowerCase();

  if (text.includes("checkpoint") || path.includes("checkpoint")) {
    return "checkpoint";
  }

  if (
    path.includes("/login") ||
    text.includes("log in to facebook") ||
    text.includes("password")
  ) {
    return "login_required";
  }

  return "ok";
}

function openComposer() {
  const normalizedText = (value) =>
    (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const isVisible = (node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return (
      rect.width > 20 &&
      rect.height > 12 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };

  const selectors = [
    'div[aria-label="Write something..."]',
    'div[aria-label="Write something"]',
    'div[role="button"][aria-label*="Write something"]',
    'div[role="button"][aria-label*="Create a public post"]',
    'div[role="button"][aria-label*="What\'s on your mind"]',
    'div[role="button"][aria-label*="Viết gì đó"]',
    'div[role="button"][aria-label*="Bạn viết gì đi"]',
    'div[role="button"][aria-label*="Tạo bài viết công khai"]',
    'div[role="button"][aria-label*="Create post"]',
    'div[role="button"][aria-label*="Tạo bài viết"]',
    'span[aria-label*="Write something"]',
    'span[aria-label*="Create post"]',
  ];
  const blockedPhrases = [
    "comment",
    "reply",
    "messenger",
    "profile",
    "friend",
    "story",
    "joined",
    "invite",
    "share group",
    "see recommended groups",
  ];

  const spanPrompts = Array.from(document.querySelectorAll("span"))
    .filter((node) => node instanceof HTMLElement)
    .filter((node) => {
      const text = normalizedText(node.textContent);
      return text === "write something..." || text === "write something";
    })
    .filter((node) => isVisible(node));

  for (const span of spanPrompts) {
    if (!(span instanceof HTMLElement)) {
      continue;
    }

    const clickable =
      span.closest('div[role="button"]') ||
      span.closest('div[tabindex="0"]') ||
      span.closest("button") ||
      span.parentElement;

    if (!(clickable instanceof HTMLElement) || !isVisible(clickable)) {
      continue;
    }

    const label = normalizedText(
      `${clickable.innerText || ""} ${clickable.getAttribute("aria-label") || ""}`,
    );

    if (blockedPhrases.some((phrase) => label.includes(phrase))) {
      continue;
    }

    clickable.click();
    return {
      ok: true,
      message: "Composer click via write-something span prompt.",
    };
  }

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLElement && isVisible(element)) {
      const label =
        `${normalizedText(element.innerText)} ${normalizedText(element.getAttribute("aria-label"))}`.trim();
      if (blockedPhrases.some((phrase) => label.includes(phrase))) {
        continue;
      }
      element.click();
      return { ok: true, message: `Composer click via selector: ${selector}` };
    }
  }

  const visibleTextTargets = Array.from(document.querySelectorAll("div, span"))
    .filter((node) => node instanceof HTMLElement)
    .filter((node) => isVisible(node))
    .filter((node) => {
      const text = normalizedText(node.textContent);
      if (!text) {
        return false;
      }

      return (
        text === "write something..." ||
        text === "write something" ||
        text === "what's on your mind?" ||
        text === "viết gì đó..." ||
        text === "bạn viết gì đi..."
      );
    });

  for (const node of visibleTextTargets) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }

    const clickableParent =
      node.closest('div[role="button"]') ||
      node.closest("button") ||
      node.closest("a") ||
      node.parentElement;

    if (!(clickableParent instanceof HTMLElement)) {
      continue;
    }

    if (!isVisible(clickableParent)) {
      continue;
    }

    const label =
      `${normalizedText(clickableParent.innerText)} ${normalizedText(
        clickableParent.getAttribute("aria-label"),
      )}`.trim();

    if (blockedPhrases.some((phrase) => label.includes(phrase))) {
      continue;
    }

    clickableParent.click();
    return {
      ok: true,
      message: `Composer click via visible prompt: ${normalizedText(node.textContent)}`,
    };
  }

  const clickableNodes = Array.from(
    document.querySelectorAll(
      'div[role="button"], a[role="button"], span[role="button"], button, a',
    ),
  );
  const composerPhrases = [
    "write something",
    "create post",
    "create public post",
    "what's on your mind",
    "what is on your mind",
    "viết gì đó",
    "bạn viết gì đi",
    "tạo bài viết",
    "tạo bài viết công khai",
    "thảo luận",
    "discussion",
  ];

  for (const node of clickableNodes) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }

    if (!isVisible(node)) {
      continue;
    }

    const text = normalizedText(node.innerText);
    const ariaLabel = normalizedText(node.getAttribute("aria-label"));
    const title = normalizedText(node.getAttribute("title"));
    const combined = `${text} ${ariaLabel} ${title}`;

    if (blockedPhrases.some((phrase) => combined.includes(phrase))) {
      continue;
    }

    if (composerPhrases.some((phrase) => combined.includes(phrase))) {
      node.click();
      return {
        ok: true,
        message: `Composer click via text match: ${combined.slice(0, 80)}`,
      };
    }
  }

  const debugButtons = clickableNodes
    .filter((node) => node instanceof HTMLElement)
    .map((node) => {
      const text = normalizedText(node.innerText);
      const ariaLabel = normalizedText(node.getAttribute("aria-label"));
      const title = normalizedText(node.getAttribute("title"));
      return `${text} ${ariaLabel} ${title}`.trim();
    })
    .filter(Boolean)
    .slice(0, 20);

  return {
    ok: false,
    message: `Composer button not found. Candidates seen: ${debugButtons.join(" | ") || "none"}`,
  };
}

function moveToDiscussionSection() {
  const normalizedText = (value) =>
    (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const clickableNodes = Array.from(
    document.querySelectorAll(
      'a, button, div[role="button"], [role="tab"], [role="link"]',
    ),
  );

  const discussionPhrases = ["discussion", "thảo luận", "bài viết", "posts"];

  for (const node of clickableNodes) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }

    const text = normalizedText(node.innerText);
    const ariaLabel = normalizedText(node.getAttribute("aria-label"));
    const combined = `${text} ${ariaLabel}`.trim();

    if (
      discussionPhrases.some(
        (phrase) =>
          combined === phrase ||
          combined.includes(` ${phrase}`) ||
          combined.startsWith(`${phrase} `),
      )
    ) {
      node.click();
      window.scrollTo({ top: 0, behavior: "instant" });
      return {
        ok: true,
        message: `Moved to discussion section via: ${combined}`,
      };
    }
  }

  window.scrollTo({ top: 500, behavior: "instant" });
  return {
    ok: true,
    message:
      "No discussion tab found, scrolled to try loading the feed composer.",
  };
}

function detectComposerReady() {
  const normalizedText = (value) =>
    (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const isCommentLikeEditor = (node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    const combined = normalizedText(
      `${node.getAttribute("aria-label") || ""} ${node.getAttribute("placeholder") || ""} ${node.textContent || ""}`,
    );

    return (
      combined.includes("comment") ||
      combined.includes("comment as") ||
      combined.includes("reply") ||
      combined.includes("bình luận") ||
      combined.includes("trả lời")
    );
  };

  const dialog = document.querySelector('div[role="dialog"]');
  const inlineEditor = document.querySelector(
    'div[role="dialog"] [contenteditable="true"], div[role="dialog"] textarea, div[role="dialog"] [data-lexical-editor="true"], div[role="dialog"] input[type="file"]',
  );

  if (inlineEditor && !isCommentLikeEditor(inlineEditor)) {
    return { ok: true, message: "Composer editor detected." };
  }

  const inlineComposerContainers = Array.from(
    document.querySelectorAll(
      '[contenteditable="true"], [role="textbox"], textarea, input[type="file"]',
    ),
  )
    .filter((node) => node instanceof HTMLElement)
    .map((node) => {
      const aria = normalizedText(node.getAttribute("aria-label"));
      const placeholder = normalizedText(node.getAttribute("placeholder"));
      const role = normalizedText(node.getAttribute("role"));
      return `${node.tagName.toLowerCase()} role=${role} aria=${aria} placeholder=${placeholder}`.trim();
    })
    .filter(Boolean)
    .slice(0, 12);

  const inlineQualifiedEditor = Array.from(
    document.querySelectorAll(
      '[contenteditable="true"], [data-lexical-editor="true"], textarea',
    ),
  )
    .filter((node) => node instanceof HTMLElement)
    .find((node) => {
      if (!(node instanceof HTMLElement) || isCommentLikeEditor(node)) {
        return false;
      }

      const combined = normalizedText(
        `${node.getAttribute("aria-label") || ""} ${node.getAttribute("placeholder") || ""} ${node.textContent || ""}`,
      );

      return (
        combined.includes("write something") ||
        combined.includes("what's on your mind") ||
        combined.includes("create post") ||
        combined.includes("viết gì") ||
        combined.includes("tạo bài viết")
      );
    });

  if (inlineQualifiedEditor) {
    return { ok: true, message: "Inline composer editor detected." };
  }

  if (!dialog) {
    return {
      ok: false,
      message: `Composer dialog not detected. Inline candidates: ${inlineComposerContainers.join(" | ") || "none"}`,
    };
  }

  const dialogText = (dialog.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const blockedPhrases = [
    "send this to",
    "post it on your profile",
    "friends",
    "profile",
    "messenger",
    "story",
    "comment",
    "reply",
    "bình luận",
  ];

  if (blockedPhrases.some((phrase) => dialogText.includes(phrase))) {
    return {
      ok: false,
      message: `Wrong dialog opened instead of post composer. Dialog text: ${dialogText.slice(0, 200)}`,
    };
  }

  const composerHints = [
    "write something",
    "what's on your mind",
    "create post",
    "create public post",
    "add to your post",
    "add to post",
    "thêm vào bài viết của bạn",
    "viết gì đó",
    "tạo bài viết",
    "discussion",
    "thảo luận",
    "photo/video",
    "ảnh/video",
  ];

  if (composerHints.some((phrase) => dialogText.includes(phrase))) {
    return {
      ok: true,
      message: `Composer dialog detected from text: ${dialogText.slice(0, 120)}`,
    };
  }

  return {
    ok: false,
    message: `Dialog found but no editor yet. Dialog text: ${dialogText.slice(0, 200)}. Inline candidates: ${inlineComposerContainers.join(" | ") || "none"}`,
  };
}

function fillPostBody({ body }) {
  const dialogRoot = document.querySelector('div[role="dialog"]') || document;
  const isEditableTarget = (node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    if (
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLInputElement
    ) {
      return true;
    }

    if (node.getAttribute("contenteditable") === "true") {
      return true;
    }

    return node.getAttribute("role") === "textbox";
  };

  const isCommentLikeEditor = (node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    const normalizedText = (value) =>
      (value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const combined = normalizedText(
      `${node.getAttribute("aria-label") || ""} ${node.getAttribute("placeholder") || ""} ${node.textContent || ""}`,
    );

    return (
      combined.includes("comment") ||
      combined.includes("comment as") ||
      combined.includes("reply") ||
      combined.includes("bình luận") ||
      combined.includes("trả lời")
    );
  };

  const fillEditableElement = (element, textBody) => {
    try {
      element.focus();

      if (
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLInputElement
      ) {
        element.value = textBody;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, message: "Post body filled via input element." };
      }

      const attempts = [];
      const selectEditable = () => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      };

      const dispatchCommonEvents = () => {
        element.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
        element.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            data: textBody,
            inputType: "insertText",
          }),
        );
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data: textBody,
            inputType: "insertText",
          }),
        );
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };

      element.innerHTML = "";
      element.textContent = "";
      selectEditable();

      const execInserted = document.execCommand("insertText", false, textBody);
      attempts.push(`execCommand=${execInserted}`);
      dispatchCommonEvents();

      const normalizedText = (element.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalizedText.includes(textBody.trim())) {
        return {
          ok: true,
          message: `Post body filled via execCommand. ${attempts.join(", ")}`,
        };
      }

      element.innerHTML = "";
      element.textContent = textBody;
      dispatchCommonEvents();
      const directText = (element.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      attempts.push(`textContent=${directText.length}`);
      if (directText.includes(textBody.trim())) {
        return {
          ok: true,
          message: `Post body filled via textContent. ${attempts.join(", ")}`,
        };
      }

      element.innerHTML = `<div>${textBody.replace(/\n/g, "<br>")}</div>`;
      dispatchCommonEvents();
      const htmlText = (element.textContent || "").replace(/\s+/g, " ").trim();
      attempts.push(`innerHTML=${htmlText.length}`);
      if (htmlText.includes(textBody.trim().slice(0, 20))) {
        return {
          ok: true,
          message: `Post body filled via innerHTML. ${attempts.join(", ")}`,
        };
      }

      return {
        ok: false,
        message: `Editable element found but Facebook did not accept inserted text. ${attempts.join(", ")} tag=${element.tagName.toLowerCase()} aria=${element.getAttribute("aria-label") || ""}`,
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not fill editable element.",
      };
    }
  };

  const focusedElement = document.activeElement;
  if (
    focusedElement instanceof HTMLElement &&
    dialogRoot.contains(focusedElement) &&
    isEditableTarget(focusedElement) &&
    !isCommentLikeEditor(focusedElement)
  ) {
    const focusedResult = fillEditableElement(focusedElement, body);
    if (focusedResult.ok) {
      return {
        ok: true,
        message: `Post body filled via focused editor. ${focusedResult.message}`,
      };
    }
  }

  const candidates = [
    'div[role="dialog"] div[contenteditable="true"][data-lexical-editor="true"]',
    'div[role="dialog"] div[contenteditable="true"]',
    'div[role="dialog"] [role="textbox"][contenteditable="true"]',
    'div[role="dialog"] [role="textbox"][aria-multiline="true"]',
    'div[role="dialog"] [contenteditable="true"][aria-label]',
    'div[role="dialog"] div[aria-label*="Write something"][contenteditable="true"]',
    'div[role="dialog"] div[aria-label*="Viết gì đó"][contenteditable="true"]',
    'div[role="dialog"] div[data-contents="true"][contenteditable="true"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    '[contenteditable="true"][role="textbox"]',
    "textarea[placeholder]",
  ];

  for (const selector of candidates) {
    const element = dialogRoot.querySelector(selector);
    if (element instanceof HTMLElement && !isCommentLikeEditor(element)) {
      const result = fillEditableElement(element, body);
      if (result.ok) {
        return result;
      }
    }
  }

  const textboxes = Array.from(
    dialogRoot.querySelectorAll(
      '[contenteditable="true"], textarea, [data-lexical-editor="true"]',
    ),
  );
  const normalizedText = (value) =>
    (value || "").replace(/\s+/g, " ").trim().toLowerCase();

  for (const node of textboxes) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }

    if (isCommentLikeEditor(node)) {
      continue;
    }

    const ariaLabel = normalizedText(node.getAttribute("aria-label"));
    const placeholder = normalizedText(node.getAttribute("placeholder"));
    const text = normalizedText(node.textContent);
    const combined = `${ariaLabel} ${placeholder} ${text}`;

    if (
      combined.includes("write something") ||
      combined.includes("viết gì") ||
      combined.includes("what's on your mind") ||
      combined.includes("tạo bài viết") ||
      combined.includes("discussion")
    ) {
      const result = fillEditableElement(node, body);
      if (result.ok) {
        return result;
      }
    }
  }

  const debugCandidates = textboxes
    .filter((node) => node instanceof HTMLElement)
    .map((node) => {
      const ariaLabel = normalizedText(node.getAttribute("aria-label"));
      const placeholder = normalizedText(node.getAttribute("placeholder"));
      const role = normalizedText(node.getAttribute("role"));
      return `${node.tagName.toLowerCase()} role=${role} aria=${ariaLabel} placeholder=${placeholder}`.trim();
    })
    .filter(Boolean)
    .slice(0, 10);

  const visibleButtons = Array.from(
    document.querySelectorAll(
      'div[role="button"], button, [role="button"], a[role="button"]',
    ),
  )
    .filter((node) => node instanceof HTMLElement)
    .map((node) => {
      const text = normalizedText(node.textContent);
      const ariaLabel = normalizedText(node.getAttribute("aria-label"));
      const label = `${text} ${ariaLabel}`.trim();
      return label;
    })
    .filter(Boolean)
    .slice(0, 15);

  return {
    ok: false,
    message: `Could not find text editor. Candidates seen: ${debugCandidates.join(" | ") || "none"}. Visible buttons: ${visibleButtons.join(" | ") || "none"}`,
  };
}

function fillEditableElement(element, body) {
  return {
    ok: false,
    message:
      "This helper should not be called directly outside injected page context.",
  };
}

function uploadMediaFiles({ mediaFiles }) {
  const dialogRoot = document.querySelector('div[role="dialog"]');
  const input =
    dialogRoot?.querySelector('input[type="file"]') ||
    document.querySelector('input[type="file"]');

  if (!(input instanceof HTMLInputElement)) {
    return { ok: false, message: "Media file input not found." };
  }

  const fileList = mediaFiles.map((media) => {
    const [meta, base64] = media.dataUrl.split(",");
    const mimeMatch = meta.match(/data:(.*);base64/);
    const mimeType = mimeMatch
      ? mimeMatch[1]
      : media.type || "application/octet-stream";
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const file = new File([bytes], media.name, { type: mimeType });
    return file;
  });

  const dataTransfer = new DataTransfer();
  fileList.forEach((file) => dataTransfer.items.add(file));
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  return { ok: true, message: `Attached ${fileList.length} media file(s).` };
}

function submitPost() {
  const selectors = [
    'div[role="dialog"] div[aria-label="Post"]',
    'div[role="dialog"] div[aria-label="Đăng"]',
    'div[role="dialog"] [role="button"][aria-label="Post"]',
    'div[role="dialog"] [role="button"][aria-label="Đăng"]',
    'div[role="dialog"] button[aria-label="Post"]',
    'div[role="dialog"] button[aria-label="Đăng"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLElement) {
      element.click();
      const bodyText = document.body?.innerText?.toLowerCase() || "";
      return {
        ok: true,
        pending:
          bodyText.includes("admin approval") ||
          bodyText.includes("quản trị viên phê duyệt"),
        message: "Submit button clicked.",
      };
    }
  }

  const isVisible = (node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return (
      rect.width >= 40 &&
      rect.height >= 20 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  };

  const isDisabled = (node) =>
    node.getAttribute("aria-disabled") === "true" ||
    node.getAttribute("disabled") !== null;

  const dialogNode = document.querySelector('div[role="dialog"]');
  if (dialogNode) {
    const spanCandidates = Array.from(dialogNode.querySelectorAll("span"))
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => {
        const text = (node.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        return text === "post" || text === "đăng";
      });

    for (const span of spanCandidates) {
      if (!(span instanceof HTMLElement)) {
        continue;
      }

      const clickable = span.closest(
        'div[role="button"], button, [role="button"]',
      );
      if (
        !(clickable instanceof HTMLElement) ||
        !isVisible(clickable) ||
        isDisabled(clickable)
      ) {
        continue;
      }

      clickable.click();
      const bodyText = document.body?.innerText?.toLowerCase() || "";
      return {
        ok: true,
        pending:
          bodyText.includes("admin approval") ||
          bodyText.includes("quản trị viên phê duyệt"),
        message: "Submit button clicked via footer span Post.",
      };
    }
  }

  const dialog = document.querySelector('div[role="dialog"]') || document;
  const clickableNodes = Array.from(
    dialog.querySelectorAll(
      'div[role="button"], button, [role="button"], span[role="button"]',
    ),
  );

  const normalizedText = (value) =>
    (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const submitPhrases = ["đăng", "post", "publish", "chia sẻ"];
  const blockedPhrases = [
    "comment",
    "bình luận",
    "reply",
    "trả lời",
    "message",
    "nhắn tin",
    "friends",
    "friend",
    "profile",
    "dòng thời gian",
    "timeline",
    "story",
    "gửi cho bạn bè",
    "send this to",
    "post it on your profile",
    "share to",
    "chia sẻ lên",
    "messenger",
  ];

  const belongsToComposer = (node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    const dialog = node.closest('div[role="dialog"]');
    if (!dialog) {
      return false;
    }

    const dialogText = normalizedText(dialog.textContent);
    return !blockedPhrases.some((phrase) => dialogText.includes(phrase));
  };

  for (const node of clickableNodes) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }

    const text = normalizedText(node.innerText);
    const ariaLabel = normalizedText(node.getAttribute("aria-label"));
    const combined = `${text} ${ariaLabel}`.trim();

    if (!combined) {
      continue;
    }

    if (
      blockedPhrases.some((phrase) => combined.includes(phrase)) ||
      !isVisible(node) ||
      !belongsToComposer(node)
    ) {
      continue;
    }

    if (submitPhrases.some((phrase) => combined === phrase)) {
      const disabled =
        node.getAttribute("aria-disabled") === "true" ||
        node.getAttribute("disabled") !== null;

      if (disabled) {
        return {
          ok: false,
          message: `Submit button found but disabled: ${combined}`,
        };
      }

      node.click();
      const bodyText = document.body?.innerText?.toLowerCase() || "";
      return {
        ok: true,
        pending:
          bodyText.includes("admin approval") ||
          bodyText.includes("quản trị viên phê duyệt"),
        message: `Submit button clicked via text match: ${combined}`,
      };
    }
  }

  const footerCandidates = Array.from(
    dialog.querySelectorAll('div[role="button"], button, [role="button"]'),
  ).filter((node) => node instanceof HTMLElement);
  const debugCandidates = [];

  for (const node of footerCandidates) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }

    const text = normalizedText(node.innerText);
    const ariaLabel = normalizedText(node.getAttribute("aria-label"));
    const combined = `${text} ${ariaLabel}`.trim();

    if (combined) {
      debugCandidates.push(combined.slice(0, 120));
    }

    if (
      !combined ||
      blockedPhrases.some((phrase) => combined.includes(phrase)) ||
      !isVisible(node) ||
      !belongsToComposer(node)
    ) {
      continue;
    }

    if (
      combined.includes("đăng") ||
      combined.includes("post") ||
      combined.includes("publish") ||
      combined.includes("chia sẻ")
    ) {
      const disabled =
        node.getAttribute("aria-disabled") === "true" ||
        node.getAttribute("disabled") !== null;

      if (disabled) {
        continue;
      }

      node.click();
      const bodyText = document.body?.innerText?.toLowerCase() || "";
      return {
        ok: true,
        pending:
          bodyText.includes("admin approval") ||
          bodyText.includes("quản trị viên phê duyệt"),
        message: `Submit button clicked via fallback match: ${combined}`,
      };
    }
  }

  const uniqueCandidates = Array.from(new Set(debugCandidates)).slice(0, 12);
  return {
    ok: false,
    message: `Submit button not found. Candidates seen: ${uniqueCandidates.join(" | ") || "none"}`,
  };
}
