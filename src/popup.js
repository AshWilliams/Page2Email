/**
 * popup.js – Page2Email popup logic.
 *
 * Relies on utils.js being loaded before this script (via popup.html script order).
 */

/* ─── DOM references ─────────────────────────────────────────────── */
const formatSelect = document.getElementById('format-select');
const saveScreenshotCheckbox = document.getElementById('save-screenshot');
const saveScreenshotOption = document.getElementById('save-screenshot-option');
const methodSelect = document.getElementById('method-select');
const recipientsInput = document.getElementById('recipients');
const subjectInput = document.getElementById('subject');
const notesInput = document.getElementById('notes');
const btnCapture = document.getElementById('btn-capture');
const btnCaptureText = document.getElementById('btn-capture-text');
const btnSpinner = document.getElementById('btn-spinner');
const btnSendToMe = document.getElementById('btn-send-to-me');
const btnToggleSettings = document.getElementById('btn-toggle-settings');
const sectionSaveMe = document.getElementById('section-save-me');
const myEmailInput = document.getElementById('my-email');
const btnSaveMe = document.getElementById('btn-save-me');
const saveMeStatus = document.getElementById('save-me-status');
const statusEl = document.getElementById('status');

/* ─── Select2: icon template for selects with data-icon ─────────── */
function formatIconOption(option) {
  if (!option.element) return option.text;
  const iconUrl = option.element.getAttribute('data-icon');
  if (!iconUrl) return option.text;
  const $option = $('<span class="select2-method-option"><img src="' + iconUrl + '" class="select2-method-icon" /> ' + option.text + '</span>');
  return $option;
}

/* ─── Initialise popup ───────────────────────────────────────────── */
async function init() {
  // Shared Select2 config for icon dropdowns
  const iconSelect2Config = {
    templateResult: formatIconOption,
    templateSelection: formatIconOption,
    minimumResultsForSearch: Infinity,
    dropdownAutoWidth: true,
    width: '100%',
  };

  // Initialise Select2 on the format dropdown with custom icons
  $('#format-select').select2(iconSelect2Config);

  // Initialise Select2 on the method dropdown with custom icons
  $('#method-select').select2(iconSelect2Config);

  // Forward Select2 change events so existing listeners still work
  $('#format-select').on('select2:select', function () {
    formatSelect.dispatchEvent(new Event('change'));
  });
  $('#method-select').on('select2:select', function () {
    methodSelect.dispatchEvent(new Event('change'));
  });
  // Restore saved "my email" and pre-fill subject from active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const stored = await chrome.storage.sync.get(['myEmail', 'lastRecipients']);

  if (stored.myEmail) {
    myEmailInput.value = stored.myEmail;
  } else {
    // Try to prefill from the Chrome browser profile
    try {
      const userInfo = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
      if (userInfo.email) {
        myEmailInput.value = userInfo.email;
        // Persist it so it's available for "Send to me" immediately
        await chrome.storage.sync.set({ myEmail: userInfo.email });
      }
    } catch { /* identity API unavailable – ignore */ }
  }
  if (stored.lastRecipients) {
    recipientsInput.value = stored.lastRecipients;
  }

  if (tab) {
    subjectInput.value = generateSubject(tab.title || '', tab.url || '');
  }

  updateCaptureButton();
}

/* ─── Update capture button label ───────────────────────────────── */
function updateCaptureButton() {
  const format = formatSelect.value;
  btnCaptureText.textContent = format === 'pdf' ? '📄 Generate PDF & Send' : '📸 Capture & Send';
  // Show the "save to disk" checkbox only for screenshot mode
  saveScreenshotOption.hidden = format !== 'screenshot';
}

formatSelect.addEventListener('change', updateCaptureButton);

/* ─── "Send to me" ───────────────────────────────────────────────── */
btnSendToMe.addEventListener('click', async () => {
  const stored = await chrome.storage.sync.get('myEmail');
  if (stored.myEmail) {
    recipientsInput.value = stored.myEmail;
  } else {
    sectionSaveMe.hidden = false;
    myEmailInput.focus();
    showStatus('Enter your email address below and click Save.', 'info');
  }
});

/* ─── Settings panel ─────────────────────────────────────────────── */
btnToggleSettings.addEventListener('click', () => {
  sectionSaveMe.hidden = !sectionSaveMe.hidden;
  if (!sectionSaveMe.hidden) myEmailInput.focus();
});

btnSaveMe.addEventListener('click', async () => {
  const email = myEmailInput.value.trim();
  if (!email) {
    saveMeStatus.textContent = 'Please enter an email address.';
    return;
  }
  await chrome.storage.sync.set({ myEmail: email });
  saveMeStatus.textContent = '✅ Saved!';
  setTimeout(() => { saveMeStatus.textContent = ''; }, 2000);
});

/* ─── Main capture & send flow ───────────────────────────────────── */
btnCapture.addEventListener('click', async () => {
  try {
    setLoading(true);
    clearStatus();

    const format = formatSelect.value;
    const method = methodSelect.value;
    const recipients = recipientsInput.value
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const subject = subjectInput.value.trim() || 'Page capture';
    const notes = notesInput.value.trim();

    // Persist recipients for next time
    if (recipients.length) {
      await chrome.storage.sync.set({ lastRecipients: recipientsInput.value.trim() });
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found.');

    if (format === 'pdf') {
      await handlePdfCapture(tab, method, recipients, subject, notes);
    } else {
      await handleScreenshotCapture(tab, method, recipients, subject, notes);
    }
  } catch (err) {
    showStatus(`❌ ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
});

/* ─── Screenshot capture ─────────────────────────────────────────── */
async function handleScreenshotCapture(tab, method, recipients, subject, notes) {
  // Capture visible tab as PNG data URL
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

  // Copy the screenshot to the clipboard so the user can paste it into the email
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type]: blob }),
  ]);

  // Optionally save the screenshot to disk
  let filename;
  if (saveScreenshotCheckbox.checked) {
    filename = generateFilename(tab.title || 'page', 'screenshot');
    await new Promise((resolve, reject) => {
      chrome.downloads.download(
        { url: dataUrl, filename, saveAs: false },
        (id) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(id);
          }
        }
      );
    });
  }

  // Build body text
  const body = buildEmailBody(tab, notes, filename);

  // Open compose window
  openCompose(method, recipients, subject, body);

  const statusMsg = saveScreenshotCheckbox.checked
    ? `✅ Screenshot copied to clipboard & saved as <strong>${filename}</strong>.<br>Paste it (<kbd>Ctrl+V</kbd>) in the compose window.`
    : '✅ Screenshot copied to clipboard.<br>Paste it (<kbd>Ctrl+V</kbd>) in the compose window.';
  showStatus(statusMsg, 'success');
}

/* ─── PDF capture ────────────────────────────────────────────────── */
async function handlePdfCapture(tab, method, recipients, subject, notes) {
  // 1. Inject html2pdf library into the active tab
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['lib/html2pdf.bundle.min.js'],
  });

  // 2. Run content.js to generate the PDF and get back the data URL
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['src/content.js'],
  });

  const pdfDataUrl = results?.[0]?.result;
  if (!pdfDataUrl) {
    throw new Error('PDF generation returned no data. The page may block content scripts.');
  }

  // 3. Download the PDF
  const filename = generateFilename(tab.title || 'page', 'pdf');
  await new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: pdfDataUrl, filename, saveAs: false },
      (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(id);
        }
      }
    );
  });

  // 4. Build body text and open compose window
  const body = buildEmailBody(tab, notes, filename);
  openCompose(method, recipients, subject, body);

  showStatus(
    `✅ PDF saved as <strong>${filename}</strong>.<br>Compose window opened — attach the downloaded PDF to send it.`,
    'success'
  );
}

/* ─── Helpers ────────────────────────────────────────────────────── */
function buildEmailBody(tab, notes, filename) {
  const lines = [
    `Page: ${tab.title || '(no title)'}`,
    `URL: ${tab.url || ''}`,
    `Captured: ${new Date().toLocaleString()}`,
    '',
    notes ? `Notes:\n${notes}` : '',
    '',
    filename ? `Attachment: ${filename}` : '',
    '',
    '—',
    'Sent with Page2Email Chrome Extension',
  ];
  return lines.filter(Boolean).join('\n');
}

function openCompose(method, recipients, subject, body) {
  let url;
  if (method === 'gmail') {
    url = buildGmailUrl(recipients, subject, body);
  } else if (method === 'outlook') {
    url = buildOutlookUrl(recipients, subject, body);
  } else {
    url = buildMailtoUrl(recipients, subject, body);
  }

  if (method === 'mailto') {
    // mailto opens the default mail client; use window.location for same context
    window.location.href = url;
  } else {
    chrome.tabs.create({ url });
  }
}

function setLoading(loading) {
  btnCapture.disabled = loading;
  btnCaptureText.hidden = loading;
  btnSpinner.hidden = !loading;
}

function showStatus(html, type = 'info') {
  statusEl.innerHTML = html;
  statusEl.className = `status ${type}`;
  statusEl.hidden = false;
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.innerHTML = '';
  statusEl.className = 'status';
}

/* ─── Boot ───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
