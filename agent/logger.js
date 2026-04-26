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
      ensureParentDirectory(logFilePath);
      fs.appendFileSync(logFilePath, formatFileLogLine(entry), "utf8");
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
  setLogFile(filePath) {
    logFilePath = filePath || null;
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
