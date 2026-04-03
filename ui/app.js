(function () {
  'use strict'

  // --- Icons ---
  const ICON_COMMENT = '<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>'
  const ICON_COPY = '<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>'

  // --- Theme ---

  const themeToggle = document.getElementById('theme-toggle')
  const hljsLight = document.getElementById('hljs-light')
  const hljsDark = document.getElementById('hljs-dark')

  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    themeToggle.textContent = dark ? '\u2600' : '\u263E'
    themeToggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode'
    hljsLight.disabled = dark
    hljsDark.disabled = !dark
  }

  const savedTheme = localStorage.getItem('marginalia-theme')
  const prefersDark = savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)
  applyTheme(prefersDark)

  themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    applyTheme(!isDark)
    localStorage.setItem('marginalia-theme', !isDark ? 'dark' : 'light')
  })

  // --- State ---
  const threads = {} // thread_id -> { el, messages }
  const viewedFiles = {} // filename -> diff hash (to detect changes)
  let pendingPermission = null
  let chatExpanded = false

  // --- Elements ---
  const diffContainer = document.getElementById('diff-container')
  const loadingState = document.getElementById('loading-state')
  const emptyState = document.getElementById('empty-state')
  const projectDirEl = document.getElementById('project-dir')
  const fileCountEl = document.getElementById('file-count')
  const statusEl = document.getElementById('status')
  const permissionBar = document.getElementById('permission-bar')
  const permissionText = document.getElementById('permission-text')
  const permissionApprove = document.getElementById('permission-approve')
  const permissionDeny = document.getElementById('permission-deny')
  const chatToggle = document.getElementById('chat-toggle')
  const chatIndicator = document.getElementById('chat-indicator')
  const chatHistory = document.getElementById('chat-history')
  const generalInput = document.getElementById('general-input')
  const generalSend = document.getElementById('general-send')

  // --- WebSocket ---

  let ws
  function connect() {
    ws = new WebSocket('ws://' + location.host + '/')
    ws.onopen = () => { statusEl.textContent = 'watching' }
    ws.onclose = () => {
      statusEl.textContent = 'disconnected'
      setTimeout(connect, 2000)
    }
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      switch (msg.type) {
        case 'init':
          projectDirEl.textContent = msg.projectDir
          renderDiff(msg.diff)
          break
        case 'diff':
          renderDiff(msg.diff)
          dismissPermission()
          break
        case 'permission_dismiss':
          dismissPermission()
          break
        case 'reply':
          appendReply(msg.thread_id, msg.text, msg.ephemeral)
          dismissPermission()
          break
        case 'status':
          statusEl.textContent = msg.text
          dismissPermission()
          break
        case 'comment_ack':
          if (msg.file) {
            confirmInlineComment(msg.thread_id, msg.file, parseInt(msg.line, 10), msg.side, msg.text)
          } else {
            confirmGeneralComment(msg.thread_id, msg.text)
          }
          break
        case 'permission':
          showPermission(msg)
          break
      }
    }
  }
  connect()

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  // --- Diff Rendering ---

  let lastFileDiffs = {}

  function renderDiff(diffText) {
    loadingState.classList.add('hidden')

    if (!diffText || diffText.trim() === '') {
      diffContainer.innerHTML = ''
      diffContainer.appendChild(emptyState)
      emptyState.classList.remove('hidden')
      fileCountEl.textContent = '0 files'
      return
    }

    emptyState.classList.add('hidden')
    const scrollTop = diffContainer.scrollTop

    // Split diff into per-file chunks to detect changes
    const currentFileDiffs = {}
    const chunks = diffText.split(/(?=^diff --git )/m)
    for (const chunk of chunks) {
      const nameMatch = chunk.match(/^diff --git a\/(.+?) b\//)
      if (nameMatch) currentFileDiffs[nameMatch[1]] = chunk
    }

    // Unmark viewed files whose diff content changed
    for (const file of Object.keys(viewedFiles)) {
      if (currentFileDiffs[file] && currentFileDiffs[file] !== lastFileDiffs[file]) {
        delete viewedFiles[file]
      }
    }
    lastFileDiffs = currentFileDiffs

    const fileHeaders = Object.keys(currentFileDiffs).length
    fileCountEl.textContent = fileHeaders + ' file' + (fileHeaders !== 1 ? 's' : '')

    // eslint-disable-next-line no-undef
    const diff2htmlUi = new Diff2HtmlUI(diffContainer, diffText, {
      outputFormat: 'line-by-line',
      drawFileList: false,
      matching: 'lines',
      renderNothingWhenEmpty: false,
      highlight: true
    })
    // Save open comment inputs before re-render destroys the DOM
    const openInputs = saveOpenInputs()

    diff2htmlUi.draw()
    diff2htmlUi.highlightCode()

    injectViewedToggles()
    attachGutterHandlers()
    reinjectThreads()
    restoreOpenInputs(openInputs)
    diffContainer.scrollTop = scrollTop
  }

  // --- File header controls ---

  function injectViewedToggles() {
    const wrappers = diffContainer.querySelectorAll('.d2h-file-wrapper')
    wrappers.forEach((wrapper) => {
      const nameEl = wrapper.querySelector('.d2h-file-name')
      const fileName = nameEl?.textContent?.trim()
      if (!fileName) return

      const header = wrapper.querySelector('.d2h-file-name-wrapper')
      if (!header || header.querySelector('.mg-viewed-toggle')) return

      const viewedBtn = document.createElement('button')
      viewedBtn.className = 'mg-viewed-toggle'
      viewedBtn.textContent = 'Viewed'
      viewedBtn.type = 'button'

      if (viewedFiles[fileName]) {
        viewedBtn.classList.add('viewed')
        wrapper.classList.add('mg-collapsed')
      }

      viewedBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const isViewed = viewedBtn.classList.toggle('viewed')
        if (isViewed) {
          viewedFiles[fileName] = true
          wrapper.classList.add('mg-collapsed')
          wrapper.scrollIntoView({ block: 'start', behavior: 'instant' })
        } else {
          delete viewedFiles[fileName]
          wrapper.classList.remove('mg-collapsed')
        }
      })

      const commentBtn = document.createElement('button')
      commentBtn.className = 'mg-file-comment'
      commentBtn.innerHTML = ICON_COMMENT
      commentBtn.type = 'button'
      commentBtn.title = 'Comment on file'
      commentBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const diffBody = wrapper.querySelector('.d2h-diff-tbody')
        if (!diffBody) return
        const firstRow = diffBody.querySelector('tr')
        if (!firstRow) return
        if (firstRow.previousElementSibling?.classList.contains('comment-input-row')) return
        openFileCommentInput(diffBody, firstRow, fileName)
      })

      const copyBtn = document.createElement('button')
      copyBtn.className = 'mg-copy-path'
      copyBtn.innerHTML = ICON_COPY
      copyBtn.type = 'button'
      copyBtn.title = 'Copy file path'
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        copyToClipboard(fileName).then(() => {
          copyBtn.classList.add('mg-copied')
          setTimeout(() => copyBtn.classList.remove('mg-copied'), 1500)
        })
      })

      header.appendChild(copyBtn)
      header.appendChild(viewedBtn)
      header.appendChild(commentBtn)
    })
  }

  // --- Comment input persistence across re-renders ---

  function saveOpenInputs() {
    const inputs = []
    diffContainer.querySelectorAll('.comment-input-row').forEach((row) => {
      const textarea = row.querySelector('textarea')
      if (!textarea) return
      const context = row.querySelector('.comment-input-context')
      const contextText = context?.textContent ?? ''
      // Parse "file:line" or "file" from context label
      const match = contextText.match(/^(.+):(\d+)$/)
      const file = match ? match[1] : contextText
      const line = match ? parseInt(match[2], 10) : 0
      inputs.push({ file, line, text: textarea.value })
    })
    return inputs
  }

  function restoreOpenInputs(inputs) {
    for (const { file, line, text } of inputs) {
      if (line === 0) {
        // File-level: find the file wrapper and re-open
        const wrappers = diffContainer.querySelectorAll('.d2h-file-wrapper')
        for (const wrapper of wrappers) {
          const nameEl = wrapper.querySelector('.d2h-file-name')
          if (nameEl?.textContent?.trim() !== file) continue
          const diffBody = wrapper.querySelector('.d2h-diff-tbody')
          const firstRow = diffBody?.querySelector('tr')
          if (!diffBody || !firstRow) continue
          const inputRow = createCommentInputRow(file, null)
          diffBody.insertBefore(inputRow.el, firstRow)
          inputRow.el.querySelector('textarea').value = text
          break
        }
      } else {
        // Line-level: find the row and re-open
        const row = findDiffRow(file, line, 'right') || findDiffRow(file, line, 'left')
        if (!row) continue
        const inputRow = createCommentInputRow(file, line)
        row.parentNode.insertBefore(inputRow.el, row.nextSibling)
        row.classList.add('mg-commenting')
        inputRow.onCleanup = () => row.classList.remove('mg-commenting')
        inputRow.el.querySelector('textarea').value = text
      }
    }
  }

  // --- Comment inputs ---

  function openFileCommentInput(tbody, beforeRow, file) {
    const inputRow = createCommentInputRow(file, null)
    tbody.insertBefore(inputRow.el, beforeRow)
    inputRow.focus()
  }

  function openCommentInput(afterRow, file, line, side) {
    const existingInput = afterRow.nextElementSibling
    if (existingInput?.classList.contains('comment-input-row')) return

    const inputRow = createCommentInputRow(file, line)
    afterRow.parentNode.insertBefore(inputRow.el, afterRow.nextSibling)
    afterRow.classList.add('mg-commenting')
    inputRow.onCleanup = () => afterRow.classList.remove('mg-commenting')
    inputRow.focus()
  }

  function createCommentInputRow(file, line) {
    const isFileLevel = line === null || line === 0
    const tr = document.createElement('tr')
    tr.className = 'comment-input-row'
    const cell = document.createElement('td')
    cell.colSpan = 3
    cell.innerHTML = `
      <div class="comment-input-box">
        <div class="comment-input-context">${escapeHtml(file)}${isFileLevel ? '' : ':' + line}</div>
        <textarea class="mg-textarea" rows="3" placeholder="${isFileLevel ? 'Comment on this file...' : 'Leave a comment...'}"></textarea>
        <div class="comment-input-actions">
          <button class="small" data-action="submit">Comment</button>
          <button class="small secondary" data-action="cancel">Cancel</button>
        </div>
      </div>
    `
    tr.appendChild(cell)

    const textarea = cell.querySelector('textarea')
    let onCleanup = null

    function cleanup() {
      tr.remove()
      if (onCleanup) onCleanup()
    }

    function submit() {
      const text = textarea.value.trim()
      if (!text) return
      send({ type: 'comment', file, line: isFileLevel ? 0 : line, side: 'right', text })
      cleanup()
    }

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() }
      if (e.key === 'Escape') cleanup()
    })

    cell.querySelector('[data-action="submit"]').addEventListener('click', submit)
    cell.querySelector('[data-action="cancel"]').addEventListener('click', cleanup)

    return {
      el: tr,
      focus: () => textarea.focus(),
      set onCleanup(fn) { onCleanup = fn }
    }
  }

  // --- Gutter click handlers ---

  function attachGutterHandlers() {
    diffContainer.querySelectorAll('.d2h-code-linenumber').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        const row = el.closest('tr')
        if (!row || row.classList.contains('d2h-info')) return

        const fileWrapper = el.closest('.d2h-file-wrapper')
        const file = fileWrapper?.querySelector('.d2h-file-name')?.textContent?.trim() ?? ''
        const lineInfo = parseLineInfo(el)
        if (!lineInfo) return

        openCommentInput(row, file, lineInfo.line, lineInfo.side)
      })
    })
  }

  function parseLineInfo(lineNumEl) {
    const text = lineNumEl.textContent.trim()
    const nums = text.split(/\s+/).filter(Boolean)
    if (nums.length === 0) return null

    const row = lineNumEl.closest('tr')
    if (!row) return null
    const isDelete = row.querySelector('.d2h-del') !== null
    const isInsert = row.querySelector('.d2h-ins') !== null

    let line, side
    if (isDelete) {
      line = parseInt(nums[0], 10)
      side = 'left'
    } else if (isInsert) {
      line = nums.length > 1 ? parseInt(nums[1], 10) : parseInt(nums[0], 10)
      side = 'right'
    } else {
      line = nums.length > 1 ? parseInt(nums[1], 10) : parseInt(nums[0], 10)
      side = 'right'
    }

    if (isNaN(line)) return null
    return { line, side }
  }

  // --- Comment threads ---

  function confirmInlineComment(threadId, file, line, side, text) {
    threads[threadId] = { file, line, side, messages: [{ from: 'user', text }], el: null }
    injectThread(threadId)
  }

  function confirmGeneralComment(threadId, text) {
    threads[threadId] = { file: null, line: null, side: null, messages: [{ from: 'user', text }], el: null }
    addChatMessage('you', text)
  }

  function appendReply(threadId, text, ephemeral) {
    const thread = threads[threadId]
    if (thread) {
      thread.messages = thread.messages.filter(m => !m.ephemeral)
      thread.messages.push({ from: 'assistant', text, ephemeral })
      if (thread.file) {
        renderThreadEl(thread)
      } else {
        addChatMessage('claude', text, ephemeral)
      }
    } else {
      addChatMessage('claude', text, ephemeral)
    }
  }

  function injectThread(threadId) {
    const thread = threads[threadId]
    if (!thread || !thread.file) return

    // Find the anchor point: a specific line, or the top of the file's diff
    let anchor = null
    let insertBefore = false
    if (thread.line) {
      anchor = findDiffRow(thread.file, thread.line, thread.side)
    } else {
      // File-level comment: insert before the first row in the file's tbody
      const wrappers = diffContainer.querySelectorAll('.d2h-file-wrapper')
      for (const wrapper of wrappers) {
        const nameEl = wrapper.querySelector('.d2h-file-name')
        if (nameEl?.textContent?.trim() !== thread.file) continue
        anchor = wrapper.querySelector('.d2h-diff-tbody tr')
        insertBefore = true
        break
      }
    }
    if (!anchor) return

    if (!thread.el) {
      thread.el = document.createElement('tr')
      thread.el.className = 'comment-thread-row'
      thread.el.dataset.threadId = threadId
      const cell = document.createElement('td')
      cell.colSpan = 3
      thread.el.appendChild(cell)
    }

    renderThreadEl(thread)

    const existing = diffContainer.querySelector(`[data-thread-id="${threadId}"]`)
    if (existing) existing.remove()
    if (insertBefore) {
      anchor.parentNode.insertBefore(thread.el, anchor)
    } else {
      anchor.parentNode.insertBefore(thread.el, anchor.nextSibling)
    }
  }

  function renderMarkdown(text) {
    // eslint-disable-next-line no-undef
    try { return marked.parse(text, { breaks: true }) } catch { return escapeHtml(text) }
  }

  function renderMarkdownInline(text) {
    // eslint-disable-next-line no-undef
    try { return marked.parseInline(text) } catch { return escapeHtml(text) }
  }

  function renderMessageContent(m) {
    const content = renderMarkdown(m.text)
    const ephClass = m.ephemeral ? ' comment-ephemeral' : ''
    return `<div class="comment-message comment-${m.from}${ephClass}">` +
      `<strong>${m.from === 'user' ? 'you' : 'claude'}</strong> ` +
      `<span class="mg-md">${content}</span></div>`
  }

  function renderThreadEl(thread) {
    if (!thread.el) return
    const cell = thread.el.querySelector('td')
    const threadId = thread.el.dataset.threadId

    // Preserve in-progress reply text
    const prevInput = cell.querySelector('.thread-reply-input')
    const savedText = prevInput ? prevInput.value : ''

    cell.innerHTML = '<div class="comment-thread">' +
      '<button class="comment-dismiss" title="Dismiss">&times;</button>' +
      thread.messages.map(renderMessageContent).join('') +
      '<div class="thread-reply-box">' +
      '<textarea rows="2" class="mg-textarea thread-reply-input" placeholder="Reply..."></textarea>' +
      '<div class="comment-input-actions"><button class="small thread-reply-send">Reply</button></div>' +
      '</div>' +
      '</div>'
    cell.querySelector('.comment-dismiss').addEventListener('click', () => {
      thread.el.remove()
      thread.el = null
    })
    const input = cell.querySelector('.thread-reply-input')
    input.value = savedText
    if (savedText) input.focus()
    const sendBtn = cell.querySelector('.thread-reply-send')
    function sendReply() {
      const text = input.value.trim()
      if (!text) return
      input.value = ''
      send({ type: 'thread_reply', thread_id: threadId, text })
      thread.messages.push({ from: 'user', text })
      renderThreadEl(thread)
    }
    sendBtn.addEventListener('click', sendReply)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply() }
    })
  }

  function reinjectThreads() {
    for (const threadId of Object.keys(threads)) {
      if (threads[threadId].file) injectThread(threadId)
    }
  }

  function findDiffRow(file, line, side) {
    const fileWrappers = diffContainer.querySelectorAll('.d2h-file-wrapper')
    for (const wrapper of fileWrappers) {
      const nameEl = wrapper.querySelector('.d2h-file-name')
      if (!nameEl || nameEl.textContent.trim() !== file) continue
      const rows = wrapper.querySelectorAll('tr')
      for (const row of rows) {
        const lineNumEl = row.querySelector('.d2h-code-linenumber')
        if (!lineNumEl) continue
        const info = parseLineInfo(lineNumEl)
        if (!info) continue
        if (info.line === line && info.side === side) return row
      }
    }
    return null
  }

  // --- Permission relay ---

  function showPermission(msg) {
    pendingPermission = msg.request_id
    permissionText.textContent = `Claude wants to run ${msg.tool_name}: ${msg.description}`
    permissionBar.classList.remove('hidden')
  }

  function dismissPermission() {
    if (!pendingPermission) return
    pendingPermission = null
    permissionBar.classList.add('hidden')
  }

  permissionApprove.addEventListener('click', () => {
    if (!pendingPermission) return
    send({ type: 'permission_verdict', request_id: pendingPermission, behavior: 'allow' })
    permissionBar.classList.add('hidden')
    pendingPermission = null
  })

  permissionDeny.addEventListener('click', () => {
    if (!pendingPermission) return
    send({ type: 'permission_verdict', request_id: pendingPermission, behavior: 'deny' })
    permissionBar.classList.add('hidden')
    pendingPermission = null
  })

  // --- Chat footer ---

  chatToggle.addEventListener('click', (e) => {
    if (e.target === generalInput || e.target === generalSend) return
    chatExpanded = !chatExpanded
    chatHistory.classList.toggle('hidden', !chatExpanded)
    chatIndicator.textContent = chatExpanded ? '-' : '+'
  })

  function sendGeneral() {
    const text = generalInput.value.trim()
    if (!text) return
    send({ type: 'general', text })
    generalInput.value = ''
  }

  generalSend.addEventListener('click', sendGeneral)
  generalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendGeneral()
    }
  })

  const MAX_CHAT_MESSAGES = 50

  function addChatMessage(from, text, ephemeral) {
    if (!ephemeral) {
      chatHistory.querySelectorAll('.chat-ephemeral').forEach(el => el.remove())
    }
    const div = document.createElement('div')
    div.className = 'chat-message chat-' + from + (ephemeral ? ' chat-ephemeral' : '')
    const content = renderMarkdown(text)
    div.innerHTML = `<strong>${escapeHtml(from)}</strong> <span class="mg-md">${content}</span>`
    chatHistory.appendChild(div)
    while (chatHistory.children.length > MAX_CHAT_MESSAGES) {
      chatHistory.removeChild(chatHistory.firstChild)
    }
    chatHistory.scrollTop = chatHistory.scrollHeight
    if (!chatExpanded) {
      chatExpanded = true
      chatHistory.classList.remove('hidden')
      chatIndicator.textContent = '-'
    }
  }

  // --- Util ---

  function escapeHtml(str) {
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text)
    }
    // Fallback for non-secure contexts (e.g. HTTP over IP)
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    return Promise.resolve()
  }
})()
