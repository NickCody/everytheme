(() => {
  const vscode = acquireVsCodeApi();

  // --- State ---
  const state = {
    conversations: [], // summaries
    active: null,      // full conversation or null
    activeId: null,
    provider: { label: null, id: null },
    username: "you",
    generating: false,
    unreadByConv: new Set(),
    pickerOpen: false,
    toolsDuringGen: new Map(), // assistantMessageId -> [ToolInvocation]
  };

  // --- DOM ---
  const $ = (id) => document.getElementById(id);
  const elTranscript = $("transcript");
  const elMessages = $("messages");
  const elEmpty = $("empty-state");
  const elStatus = $("status");
  const elInput = $("composer-input");
  const elSend = $("btn-send");
  const elStop = $("btn-stop");
  const elProvider = $("btn-provider");
  const elList = $("conversation-list");
  const elPicker = $("conversation-picker");
  const btnNew = $("btn-new");
  const btnToggleList = $("btn-toggle-list");
  const btnMenu = $("btn-menu");

  // --- Markdown ---
  // `marked` is loaded via <script>. Keep HTML escaping conservative.
  function renderMarkdown(text) {
    if (!text) return "";
    const raw = typeof marked !== "undefined"
      ? marked.parse(text, { breaks: true, gfm: true, mangle: false, headerIds: false })
      : escapeHtml(text).replace(/\n/g, "<br>");
    // Strip anything risky that marked might pass through.
    return stripUnsafe(raw);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[ch]);
  }

  function stripUnsafe(html) {
    return html
      .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
      .replace(/javascript:/gi, "");
  }

  function relTime(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d`;
    return new Date(ts).toLocaleDateString();
  }

  // --- Rendering ---

  function renderEmpty() {
    const has = state.active && state.active.messages.length > 0;
    elEmpty.classList.toggle("hidden", Boolean(has));
  }

  function renderMessages() {
    elMessages.innerHTML = "";
    if (!state.active) { renderEmpty(); return; }
    for (const msg of state.active.messages) {
      elMessages.appendChild(renderMessage(msg));
    }
    renderEmpty();
    scrollToBottom();
  }

  function renderMessage(msg) {
    const wrap = document.createElement("div");
    wrap.className = `message ${msg.role}`;
    wrap.dataset.id = msg.id;

    const role = document.createElement("div");
    role.className = "role";
    role.textContent =
      msg.role === "system-error" ? "Error" :
      msg.role === "user" ? state.username :
      msg.role;
    wrap.appendChild(role);

    if (msg.role === "assistant" && msg.toolInvocations && msg.toolInvocations.length > 0) {
      const tools = document.createElement("div");
      tools.className = "tool-invocations";
      for (const inv of msg.toolInvocations) {
        tools.appendChild(renderTool(inv));
      }
      wrap.appendChild(tools);
    }

    const content = document.createElement("div");
    content.className = "content";
    if (msg.role === "assistant") {
      content.innerHTML = renderMarkdown(msg.text || "");
    } else {
      content.textContent = msg.text;
    }
    wrap.appendChild(content);

    return wrap;
  }

  function renderTool(inv) {
    const details = document.createElement("details");
    details.className = "tool-invocation" + (inv.ok ? "" : " err");
    const summary = document.createElement("summary");
    const name = document.createElement("span");
    name.className = "tool-name";
    name.textContent = inv.name;
    const desc = document.createElement("span");
    desc.className = "tool-summary";
    desc.textContent = toolSummary(inv);
    summary.appendChild(name);
    summary.appendChild(desc);
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "tool-body";

    const inLabel = document.createElement("div");
    inLabel.className = "tool-label";
    inLabel.textContent = "Input";
    const inPre = document.createElement("pre");
    inPre.textContent = safeJson(inv.input);
    body.appendChild(inLabel);
    body.appendChild(inPre);

    const outLabel = document.createElement("div");
    outLabel.className = "tool-label";
    outLabel.textContent = "Result";
    const outPre = document.createElement("pre");
    outPre.textContent = inv.result;
    body.appendChild(outLabel);
    body.appendChild(outPre);

    details.appendChild(body);
    return details;
  }

  function toolSummary(inv) {
    if (inv.name === "set_editor_colors") {
      const n = Object.keys((inv.input && inv.input.colors) || {}).length;
      return `${n} key${n === 1 ? "" : "s"}`;
    }
    if (inv.name === "set_token_colors") {
      const n = ((inv.input && inv.input.updates) || []).length;
      return `${n} rule${n === 1 ? "" : "s"}`;
    }
    if (inv.input && typeof inv.input === "object") {
      const keys = Object.keys(inv.input);
      if (keys.length === 1 && typeof inv.input[keys[0]] === "string") {
        return `${keys[0]}=${inv.input[keys[0]]}`;
      }
    }
    return "";
  }

  function safeJson(v) {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }

  function appendMessage(msg) {
    if (!state.active) return;
    state.active.messages.push(msg);
    elMessages.appendChild(renderMessage(msg));
    renderEmpty();
    scrollToBottom();
  }

  function updateAssistantMessage(messageId, patch) {
    if (!state.active) return;
    const idx = state.active.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    state.active.messages[idx] = { ...state.active.messages[idx], ...patch };
    const node = elMessages.querySelector(`.message[data-id="${messageId}"]`);
    if (node) node.replaceWith(renderMessage(state.active.messages[idx]));
  }

  function renderConversationList() {
    elList.innerHTML = "";
    for (const c of state.conversations) {
      const li = document.createElement("li");
      li.dataset.id = c.id;
      if (c.id === state.activeId) li.classList.add("active");

      if (state.unreadByConv.has(c.id)) {
        const dot = document.createElement("span");
        dot.className = "conv-unread";
        li.appendChild(dot);
      }

      const title = document.createElement("span");
      title.className = "conv-title";
      title.textContent = c.title;
      title.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        beginRename(li, title, c);
      });
      li.appendChild(title);

      const meta = document.createElement("span");
      meta.className = "conv-meta";
      meta.textContent = `${c.messageCount} · ${relTime(c.updatedAt)}`;
      li.appendChild(meta);

      const actions = document.createElement("span");
      actions.className = "conv-actions";
      const renameBtn = document.createElement("button");
      renameBtn.className = "icon-btn";
      renameBtn.textContent = "✎";
      renameBtn.title = "Rename";
      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        beginRename(li, title, c);
      });
      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn";
      delBtn.textContent = "✕";
      delBtn.title = "Delete";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: "delete-conversation", conversationId: c.id });
      });
      actions.appendChild(renameBtn);
      actions.appendChild(delBtn);
      li.appendChild(actions);

      li.addEventListener("click", () => {
        if (c.id === state.activeId) return;
        state.unreadByConv.delete(c.id);
        vscode.postMessage({ type: "switch-conversation", conversationId: c.id });
      });

      elList.appendChild(li);
    }
  }

  function beginRename(li, titleEl, conv) {
    titleEl.setAttribute("contenteditable", "true");
    titleEl.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    sel.removeAllRanges();
    sel.addRange(range);

    const commit = () => {
      titleEl.removeAttribute("contenteditable");
      const newTitle = titleEl.textContent.trim();
      if (newTitle && newTitle !== conv.title) {
        vscode.postMessage({
          type: "rename-conversation",
          conversationId: conv.id,
          title: newTitle,
        });
      } else {
        titleEl.textContent = conv.title;
      }
    };
    titleEl.addEventListener("blur", commit, { once: true });
    titleEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        titleEl.blur();
      } else if (e.key === "Escape") {
        titleEl.textContent = conv.title;
        titleEl.blur();
      }
    });
  }

  function scrollToBottom() {
    // Respect user scroll: only auto-scroll if near bottom.
    const distance = elTranscript.scrollHeight - elTranscript.scrollTop - elTranscript.clientHeight;
    if (distance < 80) {
      elTranscript.scrollTop = elTranscript.scrollHeight;
    }
  }

  function forceScrollToBottom() {
    elTranscript.scrollTop = elTranscript.scrollHeight;
  }

  function setGenerating(on, status) {
    state.generating = on;
    elSend.classList.toggle("hidden", on);
    elStop.classList.toggle("hidden", !on);
    elStatus.classList.toggle("hidden", !on);
    if (on) {
      elStatus.textContent = status || "Thinking...";
    }
  }

  function setProvider(label, id) {
    state.provider = { label, id };
    elProvider.textContent = label ?? "No provider";
  }

  function autoGrow() {
    elInput.style.height = "auto";
    elInput.style.height = Math.min(elInput.scrollHeight, 200) + "px";
  }

  // --- Input handling ---

  elInput.addEventListener("input", autoGrow);
  elInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape" && state.generating) {
      e.preventDefault();
      stop();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "n") {
      e.preventDefault();
      vscode.postMessage({ type: "new-conversation" });
    } else if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      elInput.value = "";
      autoGrow();
    }
  });

  elSend.addEventListener("click", send);
  elStop.addEventListener("click", stop);
  btnNew.addEventListener("click", () => vscode.postMessage({ type: "new-conversation" }));
  btnToggleList.addEventListener("click", () => {
    state.pickerOpen = !state.pickerOpen;
    elPicker.classList.toggle("hidden", !state.pickerOpen);
  });
  btnMenu.addEventListener("click", () => {
    vscode.postMessage({ type: "open-logs" });
  });
  elProvider.addEventListener("click", () => {
    vscode.postMessage({ type: "open-logs" });
  });

  document.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      elInput.value = btn.dataset.prompt || btn.textContent;
      autoGrow();
      elInput.focus();
    });
  });

  function send() {
    const text = elInput.value.trim();
    if (!text || state.generating) return;
    vscode.postMessage({
      type: "send",
      conversationId: state.activeId,
      text,
    });
    elInput.value = "";
    autoGrow();
  }

  function stop() {
    if (!state.generating || !state.activeId) return;
    vscode.postMessage({ type: "stop", conversationId: state.activeId });
  }

  // --- Message protocol from host ---

  window.addEventListener("message", (e) => {
    const m = e.data;
    switch (m.type) {
      case "init": {
        state.conversations = m.conversations || [];
        state.activeId = m.activeId || null;
        state.active = m.activeConversation || null;
        state.username = m.username || "you";
        setProvider(m.providerLabel, m.providerId);
        renderConversationList();
        renderMessages();
        // Auto-open picker if empty conversation
        if (state.conversations.length > 1 && (!state.active || state.active.messages.length === 0)) {
          state.pickerOpen = true;
          elPicker.classList.remove("hidden");
        }
        break;
      }
      case "conversation-list":
        state.conversations = m.conversations || [];
        state.activeId = m.activeId || state.activeId;
        renderConversationList();
        break;
      case "conversation-loaded": {
        state.active = m.conversation;
        state.activeId = m.conversation ? m.conversation.id : null;
        state.unreadByConv.delete(state.activeId);
        renderConversationList();
        renderMessages();
        forceScrollToBottom();
        break;
      }
      case "message-appended": {
        if (m.conversationId === state.activeId) {
          appendMessage(m.message);
        } else if (m.message.role === "assistant") {
          state.unreadByConv.add(m.conversationId);
          renderConversationList();
        }
        break;
      }
      case "generation-started":
        if (m.conversationId === state.activeId) setGenerating(true, `Thinking (${m.providerLabel})...`);
        break;
      case "generation-progress":
        if (m.conversationId === state.activeId && state.generating) {
          elStatus.textContent = m.status;
        }
        break;
      case "generation-tool": {
        if (m.conversationId !== state.activeId) break;
        const list = state.toolsDuringGen.get(m.messageId) || [];
        list.push(m.invocation);
        state.toolsDuringGen.set(m.messageId, list);
        // Show a lightweight running-tools status line
        elStatus.textContent = `Applied ${m.invocation.name}...`;
        break;
      }
      case "generation-finished":
        if (m.conversationId === state.activeId) {
          setGenerating(false);
          state.toolsDuringGen.delete(m.messageId);
          forceScrollToBottom();
        }
        break;
      case "generation-error":
        if (m.conversationId === state.activeId) setGenerating(false);
        break;
      case "provider-changed":
        setProvider(m.providerLabel, m.providerId);
        break;
      case "prefill":
        elInput.value = m.text || "";
        autoGrow();
        elInput.focus();
        break;
    }
  });

  // --- Ready ---
  autoGrow();
  vscode.postMessage({ type: "ready" });
})();
