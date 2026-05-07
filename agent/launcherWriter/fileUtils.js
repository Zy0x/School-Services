const fs = require("fs");
const path = require("path");

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function writeTextFile(filePath, content, encoding = "utf8") {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, content, encoding);
}

module.exports = {
  ensureDirectory,
  writeTextFile,
};
