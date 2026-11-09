const sourceEditor = document.querySelector("#source");
const saveButton = document.querySelector("#save");
const previewButton = document.querySelector("#preview");
const statusElement = document.querySelector("#status");
const previewFrame = document.querySelector("#pdf");
const emptyPreview = document.querySelector("#empty-preview");
const errorPanel = document.querySelector("#error");
const downloadLink = document.querySelector("#download");
const documentSelect = document.querySelector("#document");
const importButton = document.querySelector("#import");
const importInput = document.querySelector("#import-file");
const fileLabel = document.querySelector("#file-label");

let documents = [];
let currentDoc = "resume";
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
  documentSelect.disabled = isBusy;
  importButton.disabled = isBusy;
}

function hasUnsavedChanges() {
  return sourceEditor.value !== savedSource;
}

function confirmDiscard() {
  return !hasUnsavedChanges() || window.confirm("You have unsaved changes. Discard them?");
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
    body: JSON.stringify({ doc: currentDoc, source }),
  });
  if (!response.ok) await readError(response);
  // Both endpoints save before doing anything else, so the sent text is on disk even if compiling failed.
  savedSource = source;
}

function previewUrl() {
  return `/api/preview.pdf?doc=${encodeURIComponent(currentDoc)}&t=${Date.now()}`;
}

function showPreview() {
  const url = previewUrl();
  previewFrame.src = url;
  previewFrame.hidden = false;
  emptyPreview.hidden = true;
  downloadLink.href = url;
  downloadLink.download = `${currentDoc}.pdf`;
  downloadLink.hidden = false;
}

function hidePreview() {
  previewFrame.hidden = true;
  previewFrame.removeAttribute("src");
  downloadLink.hidden = true;
  emptyPreview.hidden = false;
}

async function loadDocuments() {
  const response = await fetch("/api/documents");
  if (!response.ok) await readError(response);
  ({ documents } = await response.json());
  documentSelect.replaceChildren(
    ...documents.map((doc) => new Option(doc.label, doc.id)),
  );
  const requested = new URLSearchParams(window.location.search).get("doc");
  if (documents.some((doc) => doc.id === requested)) currentDoc = requested;
  documentSelect.value = currentDoc;
}

async function loadSource() {
  sourceEditor.disabled = true;
  setBusy(true);
  errorPanel.hidden = true;
  hidePreview();
  const doc = documents.find((d) => d.id === currentDoc);
  fileLabel.textContent = doc ? doc.file : "";
  setStatus(`Loading ${doc ? doc.label.toLowerCase() : "document"}…`);

  try {
    const response = await fetch(`/api/source?doc=${encodeURIComponent(currentDoc)}`);
    if (!response.ok) await readError(response);
    const payload = await response.json();
    sourceEditor.value = payload.source;
    savedSource = payload.source;
    sourceEditor.disabled = false;
    setBusy(false);
    setStatus("Ready");
  } catch (error) {
    // Leave Save/Build disabled: the editor still holds the previous document's text.
    documentSelect.disabled = false;
    setStatus("Could not load document", "error");
    showError(error.message);
    return;
  }

  // Show this document's last successful build, if there is one, instead of an empty pane.
  try {
    const response = await fetch(previewUrl(), { method: "HEAD" });
    if (response.ok) showPreview();
  } catch {
    // No preview yet; keep the placeholder.
  }
}

async function switchDocument() {
  if (documentSelect.value === currentDoc) return;
  if (!confirmDiscard()) {
    documentSelect.value = currentDoc;
    return;
  }
  currentDoc = documentSelect.value;
  const url = new URL(window.location.href);
  url.searchParams.set("doc", currentDoc);
  window.history.replaceState(null, "", url);
  await loadSource();
}

async function importFile() {
  const [file] = importInput.files;
  importInput.value = "";
  if (!file) return;
  if (file.size > 1024 * 1024) {
    setStatus("Import failed", "error");
    showError(`${file.name} is larger than the 1 MB limit.`);
    return;
  }
  if (!confirmDiscard()) return;
  sourceEditor.value = await file.text();
  errorPanel.hidden = true;
  setStatus(`Imported ${file.name} · unsaved`);
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

async function stopServer() {
  const message = hasUnsavedChanges()
    ? "You have unsaved changes. Stop the editor anyway?"
    : "Stop the editor server? You can start it again from Resume Editor.vbs.";
  if (!window.confirm(message)) return;
  try {
    const response = await fetch("/api/shutdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) await readError(response);
  } catch (error) {
    setStatus("Could not stop the server", "error");
    showError(error.message);
    return;
  }
  // Nothing on the page works once the server is gone.
  savedSource = sourceEditor.value;
  sourceEditor.disabled = true;
  documentSelect.disabled = true;
  importButton.disabled = true;
  saveButton.disabled = true;
  previewButton.disabled = true;
  stopButton.disabled = true;
  setStatus("Server stopped. You can close this tab.");
}

const stopButton = document.querySelector("#stop");
stopButton.addEventListener("click", stopServer);
saveButton.addEventListener("click", save);
previewButton.addEventListener("click", buildPreview);
documentSelect.addEventListener("change", switchDocument);
importButton.addEventListener("click", () => importInput.click());
importInput.addEventListener("change", importFile);

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

loadDocuments()
  .then(loadSource)
  .catch((error) => {
    setStatus("Could not load documents", "error");
    showError(error.message);
  });
