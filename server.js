const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const host = "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const root = __dirname;
const resumePath = path.join(root, "azreen-resume-updated.tex");
const templatePath = path.join(root, "resume-template.tex");
const previewDir = path.join(root, ".resume-preview");
const previewSourcePath = path.join(previewDir, "resume.tex");
const previewPdfPath = path.join(previewDir, "resume.pdf");
const maxSourceBytes = 1024 * 1024;
const allowedHosts = new Set([`${host}:${port}`, `localhost:${port}`]);

const staticFiles = new Map([
  ["/", ["public/index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["public/styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["public/app.js", "text/javascript; charset=utf-8"]],
]);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function sendFile(response, filePath, headers) {
  const stream = fs.createReadStream(filePath);
  stream.on("error", (error) => {
    console.error(error);
    if (response.headersSent) {
      response.destroy(error);
    } else {
      sendJson(response, 500, { error: "The file could not be read." });
    }
  });
  stream.once("open", () => {
    response.writeHead(200, headers);
    stream.pipe(response);
  });
}

// Block other websites (and DNS-rebinding pages) from writing the resume or running pdflatex.
// Cross-site "simple" requests can't send Content-Type: application/json without a CORS preflight.
function assertTrustedRequest(request) {
  const origin = request.headers.origin;
  const contentType = (request.headers["content-type"] || "").split(";")[0].trim();
  const trusted =
    allowedHosts.has(request.headers.host) &&
    (!origin || allowedHosts.has(origin.replace(/^http:\/\//, ""))) &&
    contentType === "application/json";
  if (!trusted) {
    throw Object.assign(new Error("Request rejected: it did not come from the editor page."), { statusCode: 403 });
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxSourceBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Resume source exceeds the 1 MB limit."), { statusCode: 413 }));
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

async function getResumeSource() {
  try {
    return await fs.promises.readFile(resumePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return fs.promises.readFile(templatePath, "utf8");
  }
}

async function saveResumeSource(source) {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw Object.assign(new Error("Resume source must be a non-empty string."), { statusCode: 400 });
  }
  if (Buffer.byteLength(source, "utf8") > maxSourceBytes) {
    throw Object.assign(new Error("Resume source exceeds the 1 MB limit."), { statusCode: 413 });
  }
  await fs.promises.writeFile(resumePath, source, "utf8");
}

function compilerLog(error) {
  const output = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
  return output.slice(-16000);
}

let compileQueue = Promise.resolve();

// Builds share one output directory, so run them one at a time.
function compileResume(source) {
  const run = compileQueue.then(() => runPdflatex(source));
  compileQueue = run.catch(() => {});
  return run;
}

async function runPdflatex(source) {
  await fs.promises.mkdir(previewDir, { recursive: true });
  await fs.promises.writeFile(previewSourcePath, source, "utf8");
  // A failed build must not leave the previous PDF behind to be downloaded as if it were current.
  await fs.promises.rm(previewPdfPath, { force: true });

  try {
    await execFileAsync(
      "pdflatex",
      ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", "resume.tex"],
      { cwd: previewDir, windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      throw Object.assign(
        new Error("pdflatex was not found. Install MiKTeX or TeX Live, add pdflatex to PATH, and restart the editor."),
        { statusCode: 503 },
      );
    }
    if (error.killed) {
      throw Object.assign(new Error("LaTeX compilation timed out after 3 minutes."), {
        statusCode: 504,
        log: compilerLog(error),
      });
    }
    throw Object.assign(new Error("LaTeX compilation failed."), {
      statusCode: 422,
      log: compilerLog(error),
    });
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${host}:${port}`);

  if (request.method === "GET" && url.pathname === "/api/source") {
    sendJson(response, 200, { source: await getResumeSource() });
    return;
  }

  if (request.method === "POST" && (url.pathname === "/api/save" || url.pathname === "/api/preview")) {
    assertTrustedRequest(request);
    const payload = await readJson(request);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw Object.assign(new Error("Request body must be a JSON object."), { statusCode: 400 });
    }
    await saveResumeSource(payload.source);

    if (url.pathname === "/api/save") {
      sendJson(response, 200, { saved: true });
      return;
    }

    await compileResume(payload.source);
    sendJson(response, 200, { compiled: true });
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/api/preview.pdf") {
    let stats;
    try {
      stats = await fs.promises.stat(previewPdfPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        sendJson(response, 404, { error: "Build a preview first." });
        return;
      }
      throw error;
    }

    const headers = {
      "Content-Type": "application/pdf",
      "Content-Length": stats.size,
      "Cache-Control": "no-store",
    };
    if (request.method === "HEAD") {
      response.writeHead(200, headers);
      response.end();
      return;
    }
    sendFile(response, previewPdfPath, headers);
    return;
  }

  const staticFile = staticFiles.get(url.pathname);
  if (request.method === "GET" && staticFile) {
    const [relativePath, contentType] = staticFile;
    sendFile(response, path.join(root, relativePath), {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; frame-src 'self'; object-src 'none'",
    });
    return;
  }

  sendJson(response, 404, { error: "Not found." });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    const statusCode = error.statusCode || 500;
    if (statusCode === 500) console.error(error);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendJson(response, statusCode, {
      error: error.message || "The request failed.",
      ...(error.log ? { log: error.log } : {}),
    });
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the other process or run with PORT=<number>.`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, host, () => {
  console.log(`Resume editor running at http://${host}:${port}`);
});
