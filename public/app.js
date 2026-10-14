const sourceEditor = document.querySelector("#source");
const saveButton = document.querySelector("#save");
const previewButton = document.querySelector("#preview");
const statusElement = document.querySelector("#status");
const previewFrame = document.querySelector("#pdf");
const emptyPreview = document.querySelector("#empty-preview");
const errorPanel = document.querySelector("#error");
const downloadLink = document.querySelector("#download");

let savedSource = "";
let busy = false;

function setStatus(message, kind = "info") {
  statusElement.textContent = message;
  statusElement.dataset.kind = kind;
}

function setBusy(isBusy) {
  busy = isBusy;
  saveButton.disabled = isBusy;
  previewButton.disabled = isBusy;
}

function hasUnsavedChanges() {
  return sourceEditor.value !== savedSource;
}

function showError(message) {
  errorPanel.textContent = message;
  errorPanel.hidden = false;
}

async function readError(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Non-JSON error body; fall back to the status code below.
  }
  const message = payload.log ? `${payload.error}\n\n${payload.log}` : payload.error;
  throw new Error(message || `Request failed with status ${response.status}.`);
}

async function postSource(url) {
  const source = sourceEditor.value;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  if (!response.ok) await readError(response);
  // Both endpoints save before doing anything else, so the sent text is on disk even if compiling failed.
  savedSource = source;
}

function showPreview() {
  const url = `/api/preview.pdf?t=${Date.now()}`;
  previewFrame.src = url;
  previewFrame.hidden = false;
  emptyPreview.hidden = true;
  downloadLink.href = url;
  downloadLink.hidden = false;
}

function hidePreview() {
  previewFrame.hidden = true;
  previewFrame.removeAttribute("src");
  downloadLink.hidden = true;
  emptyPreview.hidden = false;
}

async function loadSource() {
  try {
    const response = await fetch("/api/source");
    if (!response.ok) await readError(response);
    const payload = await response.json();
    sourceEditor.value = payload.source;
    savedSource = payload.source;
    sourceEditor.disabled = false;
    setBusy(false);
    setStatus("Ready");
  } catch (error) {
    setStatus("Could not load resume", "error");
    showError(error.message);
    return;
  }

  // Show the last successful build, if there is one, instead of an empty pane.
  try {
    const response = await fetch("/api/preview.pdf", { method: "HEAD" });
    if (response.ok) showPreview();
  } catch {
    // No preview yet; keep the placeholder.
  }
}

async function save() {
  if (busy) return;
  setBusy(true);
  setStatus("Saving draft…");
  try {
    await postSource("/api/save");
    errorPanel.hidden = true;
    setStatus(hasUnsavedChanges() ? "Unsaved changes" : "Draft saved");
  } catch (error) {
    setStatus("Save failed", "error");
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

async function buildPreview() {
  if (busy) return;
  setBusy(true);
  setStatus("Compiling LaTeX…");
  errorPanel.hidden = true;
  try {
    await postSource("/api/preview");
    showPreview();
    setStatus(hasUnsavedChanges() ? "Preview ready · unsaved changes" : "Preview ready");
  } catch (error) {
    // The server deletes the old PDF before compiling, so a failed build leaves nothing valid to show.
    hidePreview();
    setStatus("Compile failed", "error");
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

saveButton.addEventListener("click", save);
previewButton.addEventListener("click", buildPreview);

sourceEditor.addEventListener("input", () => {
  if (busy) return;
  // Keep any compile error visible while the user fixes it; only the status changes.
  if (statusElement.dataset.kind === "error") return;
  setStatus(hasUnsavedChanges() ? "Unsaved changes" : "All changes saved");
});

sourceEditor.addEventListener("keydown", (event) => {
  if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    const start = sourceEditor.selectionStart;
    const end = sourceEditor.selectionEnd;
    sourceEditor.setRangeText("  ", start, end, "end");
    sourceEditor.dispatchEvent(new Event("input"));
  }
});

document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || sourceEditor.disabled) return;
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    save();
  } else if (key === "enter") {
    event.preventDefault();
    buildPreview();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!sourceEditor.disabled && hasUnsavedChanges()) {
    event.preventDefault();
    event.returnValue = "";
  }
});

loadSource();
