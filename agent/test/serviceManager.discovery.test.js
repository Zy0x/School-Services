const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const ServiceManager = require("../serviceManager");

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "erapor-discovery-"));
}

test("service discovery matches custom Windows services by executable path", () => {
  const manager = new ServiceManager({});
  const candidate = {
    name: "CustomWebRuntime",
    displayName: "Web Runtime",
    pathName: '"D:\\Sekolah\\Dapodik Custom\\DapodikWebSrv.exe"',
  };

  assert.equal(
    manager.matchesDiscoveredWindowsService(candidate, {
      includeAny: ["dapodik"],
      preferAny: ["web", "srv"],
    }),
    true
  );
});

test("config target discovery finds E-Rapor env in a custom directory", async () => {
  const root = createTempRoot();
  const envPath = path.join(root, "Aplikasi Sekolah", "E-Rapor Custom", "wwwroot", ".env");
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, "app.baseURL = 'http://localhost:8535/'\n", "utf8");

  const manager = new ServiceManager({
    rapor: {
      serviceName: "rapor",
      needsConfigUpdate: true,
      configTargets: [
        {
          targetId: "rapor-wwwroot-env",
          type: "env",
          path: "Z:\\missing\\wwwroot\\.env",
          pathCandidates: ["Z:\\missing\\wwwroot\\.env"],
          key: "app.baseURL",
          pathDiscovery: {
            searchRoots: [root],
            includeDirAny: ["rapor", "e-rapor"],
            maxDepth: 5,
            maxVisited: 100,
          },
        },
      ],
      windowsServices: [],
    },
  });

  const diagnostics = await manager.getLocationDiagnostics("rapor", {
    forceRefresh: true,
  });
  const [resolvedTarget] = await manager.getResolvedConfigTargets("rapor");

  assert.equal(diagnostics.status, "ready");
  assert.equal(diagnostics.resolvedPath, envPath);
  assert.equal(diagnostics.details.configTargets[0].exists, true);
  assert.equal(resolvedTarget.path, envPath);
});
