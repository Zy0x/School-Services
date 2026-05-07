const { execSync } = require("child_process");

function safeExec(command, cwd) {
  try {
    return execSync(command, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch (_error) {
    return "";
  }
}

function parseGitHubRemote(remoteUrl) {
  const value = String(remoteUrl || "").trim();
  const match =
    value.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/i) || [];
  if (match.length >= 3) {
    return {
      owner: match[1],
      repo: match[2],
    };
  }

  return {
    owner: null,
    repo: null,
  };
}

function parseVersionTag(tag) {
  const match = String(tag || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) {
    return null;
  }

  return {
    raw: `v${match[1]}.${match[2]}.${match[3]}`,
    version: `${match[1]}.${match[2]}.${match[3]}`,
    parts: match.slice(1).map((value) => Number.parseInt(value, 10)),
  };
}

function compareVersionParts(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function resolveBuildVersionInfo({ currentCommit, packageVersion, repoRoot }) {
  const fallback = {
    version: packageVersion,
    releaseTag: `v${packageVersion}`,
  };
  const gitStatus = safeExec("git status --porcelain", repoRoot);
  if (gitStatus) {
    return fallback;
  }
  const packageTag = parseVersionTag(fallback.releaseTag);
  const remoteTagsOutput = safeExec("git ls-remote --tags --refs origin", repoRoot);

  if (!remoteTagsOutput || !currentCommit) {
    return fallback;
  }

  const matchingTags = remoteTagsOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split(/\s+/);
      const tagName = ref?.replace(/^refs\/tags\//, "");
      const parsed = parseVersionTag(tagName);

      if (!parsed || sha !== currentCommit) {
        return null;
      }

      return parsed;
    })
    .filter(Boolean)
    .sort((left, right) => compareVersionParts(right.parts, left.parts));

  const selected = matchingTags[0];

  if (!selected) {
    return fallback;
  }

  if (
    packageTag &&
    compareVersionParts(packageTag.parts, selected.parts) > 0
  ) {
    return fallback;
  }

  return {
    version: selected.version,
    releaseTag: selected.raw,
  };
}

function buildInfoPayload({ packageVersion, repoRoot }) {
  const remoteUrl = safeExec("git remote get-url origin", repoRoot);
  const gitCommit = safeExec("git rev-parse HEAD", repoRoot);
  const gitBranch = safeExec("git rev-parse --abbrev-ref HEAD", repoRoot) || "main";
  const githubRemote = parseGitHubRemote(remoteUrl);
  const buildVersionInfo = resolveBuildVersionInfo({
    currentCommit: gitCommit,
    packageVersion,
    repoRoot,
  });

  return {
    owner: githubRemote.owner,
    repo: githubRemote.repo,
    branch: gitBranch === "HEAD" ? "main" : gitBranch || "main",
    version: buildVersionInfo.version,
    commit: gitCommit || null,
    releaseChannel: "latest",
    releaseTag: buildVersionInfo.releaseTag,
    builtAt: new Date().toISOString(),
  };
}

module.exports = {
  buildInfoPayload,
};
