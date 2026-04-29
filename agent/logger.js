const fs = require("fs");
const path = require("path");

const levels = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

const sinks = new Set();
let logFilePath = null;
let maxLogBytes = 5 * 1024 * 1024;

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeDetails(details) {
  if (details instanceof Error) {
    return {
      name: details.name,
      message: details.message,
      stack: details.stack,
    };
  }

  if (details === undefined) {
    return undefined;
  }

  if (details === null) {
    return null;
  }

  if (typeof details === "object") {
    return JSON.parse(JSON.stringify(details));
  }

  return { value: details };
}

function formatFileLogLine(entry) {
  const details = entry.details ? ` ${JSON.stringify(entry.details)}` : "";
  return `[${entry.timestamp}] [${levels[entry.level]}] ${entry.message}${details}\n`;
}

function trimLogFileForAppend(filePath, appendBytes) {
  if (!maxLogBytes || maxLogBytes <= 0) {
    return;
  }

  if (appendBytes >= maxLogBytes) {
    fs.writeFileSync(filePath, "", "utf8");
    return;
  }

  let stats = null;
  try {
    stats = fs.statSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }

    throw error;
  }

  if (stats.size + appendBytes <= maxLogBytes) {
    return;
  }

  const bytesToKeep = Math.max(0, maxLogBytes - appendBytes);
  if (bytesToKeep === 0) {
    fs.writeFileSync(filePath, "", "utf8");
    return;
  }

  const buffer = Buffer.alloc(bytesToKeep);
  const fileHandle = fs.openSync(filePath, "r");
  try {
    const start = Math.max(0, stats.size - bytesToKeep);
    const bytesRead = fs.readSync(fileHandle, buffer, 0, bytesToKeep, start);
    fs.writeFileSync(filePath, buffer.subarray(0, bytesRead));
  } finally {
    fs.closeSync(fileHandle);
  }
}

function fitLineToLimit(line) {
  if (!maxLogBytes || maxLogBytes <= 0) {
    return line;
  }

  const buffer = Buffer.from(line, "utf8");
  if (buffer.length <= maxLogBytes) {
    return line;
  }

  return buffer.subarray(buffer.length - maxLogBytes).toString("utf8");
}

function write(level, message, details) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${levels[level]}]`;
  const normalizedDetails = normalizeDetails(details);

  if (normalizedDetails === undefined) {
    console.log(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`, normalizedDetails);
  }

  const entry = {
    timestamp,
    level,
    message,
    details: normalizedDetails,
  };

  if (logFilePath) {
    try {
      const fileLine = fitLineToLimit(formatFileLogLine(entry));
      ensureParentDirectory(logFilePath);
      trimLogFileForAppend(logFilePath, Buffer.byteLength(fileLine, "utf8"));
      fs.appendFileSync(logFilePath, fileLine, "utf8");
    } catch (error) {
      const fileError = error instanceof Error ? error.message : String(error);
      console.error(`[logger] file sink failed: ${fileError}`);
    }
  }

  for (const sink of sinks) {
    Promise.resolve()
      .then(() => sink(entry))
      .catch((error) => {
        const sinkError = error instanceof Error ? error.message : String(error);
        console.error(`[logger] sink failed: ${sinkError}`);
      });
  }
}

function addSink(sink) {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

module.exports = {
  addSink,
  setLogFile(filePath, options = {}) {
    logFilePath = filePath || null;
    maxLogBytes = Number(options.maxBytes || maxLogBytes || 5 * 1024 * 1024);
    if (logFilePath) {
      ensureParentDirectory(logFilePath);
    }
  },
  debug(message, details) {
    write("debug", message, details);
  },
  info(message, details) {
    write("info", message, details);
  },
  warn(message, details) {
    write("warn", message, details);
  },
  error(message, details) {
    write("error", message, details);
  },
};
