# Windows GUI Release 1.0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a byte-verified public `DiamondInventory-Setup-1.0.2.exe` that launches as a Windows GUI application without a terminal or legacy local server.

**Architecture:** A release-only Rust crate attribute changes the Tauri executable from the console subsystem to the GUI subsystem. The NSIS upgrade hook removes the one obsolete per-user Startup shortcut while preserving the desktop shortcut. The existing release publisher creates versioned static-site metadata and file, which Render serves publicly.

**Tech Stack:** Rust, Tauri 2, NSIS, Node.js test runner, PowerShell, Next.js static export, Render Static Site.

## Global Constraints

- The installer filename must be exactly `DiamondInventory-Setup-1.0.2.exe`.
- The production desktop executable must use Windows GUI subsystem value `2`, while debug builds retain console diagnostics.
- The only Startup file deleted by the installer is `$SMSTARTUP\Diamond Inventory Server.lnk`.
- Existing users, sales reps, branches, audit logs, and the already-cleared database state are not changed by this release.
- The public installer must be byte-identical to the local release artifact and metadata SHA-256.
- The frontend must continue to target `https://maitri-inventory-api.onrender.com` and desktop content must continue to target `https://maitri-inventory-web.onrender.com`.
- No secrets, Node.js runtime, or database contents may be bundled in the installer.

---

## File Structure

- `desktop-app/scripts/config.test.js`: release configuration regression tests.
- `desktop-app/src-tauri/src/main.rs`: release GUI subsystem declaration and Tauri entry point.
- `desktop-app/src-tauri/installer-hooks.nsh`: post-install shortcut migration.
- `desktop-app/package.json`: npm package version.
- `desktop-app/package-lock.json`: npm root package version lock.
- `desktop-app/src-tauri/Cargo.toml`: Rust package version.
- `desktop-app/src-tauri/Cargo.lock`: Rust package version lock.
- `desktop-app/src-tauri/tauri.conf.json`: Tauri bundle version.
- `scripts/publish-windows-installer.ps1`: existing immutable versioned artifact publisher.
- `frontend/public/downloads/DiamondInventory-Setup-1.0.2.exe`: published immutable installer.
- `frontend/src/release.json`: public release filename, size, SHA-256, and URL.

---

### Task 1: Add a terminal-regression test before changing desktop sources

**Files:**
- Modify: `desktop-app/scripts/config.test.js`
- Test: `desktop-app/scripts/config.test.js`

**Interfaces:**
- Consumes: the textual Rust crate attribute and NSIS startup shortcut path.
- Produces: a test that fails if a future release restores console-subsystem behavior or omits the legacy startup cleanup.

- [ ] **Step 1: Add a failing release-window test.**

  Append this test to `desktop-app/scripts/config.test.js`:

  ```js
  test('release executable is a GUI application and removes the legacy local launcher', () => {
    const main = read('src-tauri/src/main.rs');
    const hooks = read('src-tauri/installer-hooks.nsh');
    assert.match(main, /#!\[cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)\]/);
    assert.match(hooks, /Delete "\$SMSTARTUP\\Diamond Inventory Server\.lnk"/);
  });
  ```

- [ ] **Step 2: Change the existing version test expectations from `1.0.1` to `1.0.2`.**

  ```js
  assert.equal(pkg.version, '1.0.2');
  assert.equal(config.version, '1.0.2');
  ```

- [ ] **Step 3: Run the test before implementing the change.**

  Run: `Set-Location desktop-app; npm.cmd test`

  Expected: FAIL because the package/config versions are still `1.0.1` and the GUI-subsystem attribute plus `Delete` instruction are absent.

---

### Task 2: Implement the GUI executable, legacy shortcut migration, and release version

**Files:**
- Modify: `desktop-app/src-tauri/src/main.rs:1`
- Modify: `desktop-app/src-tauri/installer-hooks.nsh:1-3`
- Modify: `desktop-app/package.json:3`
- Modify: `desktop-app/package-lock.json:3,8`
- Modify: `desktop-app/src-tauri/Cargo.toml:3`
- Modify: `desktop-app/src-tauri/Cargo.lock:543`
- Modify: `desktop-app/src-tauri/tauri.conf.json:4`
- Test: `desktop-app/scripts/config.test.js`

**Interfaces:**
- Consumes: the regression contract written in Task 1.
- Produces: a release executable compiled with Windows GUI subsystem and an NSIS hook that safely removes one obsolete startup shortcut.

- [ ] **Step 1: Declare the release-only GUI subsystem at the first line of `main.rs`.**

  ```rust
  #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

  mod config;
  ```

- [ ] **Step 2: Make the installer hook delete only the obsolete Startup link before creating the supported desktop shortcut.**

  ```nsh
  !macro NSIS_HOOK_POSTINSTALL
    Delete "$SMSTARTUP\Diamond Inventory Server.lnk"
    Call CreateOrUpdateDesktopShortcut
  !macroend
  ```

- [ ] **Step 3: Set every desktop package/config version to `1.0.2`.**

  ```json
  // desktop-app/package.json
  "version": "1.0.2"
  ```

  ```json
  // desktop-app/package-lock.json root and packages[""] entries
  "version": "1.0.2"
  ```

  ```toml
  # desktop-app/src-tauri/Cargo.toml
  version = "1.0.2"
  ```

  ```toml
  # desktop-app/src-tauri/Cargo.lock diamond-inventory package entry
  version = "1.0.2"
  ```

  ```json
  // desktop-app/src-tauri/tauri.conf.json
  "version": "1.0.2"
  ```

- [ ] **Step 4: Run desktop configuration tests and Rust unit tests.**

  Run:

  ```powershell
  Set-Location desktop-app
  npm.cmd test
  Push-Location src-tauri
  cargo test
  Pop-Location
  ```

  Expected: Node reports all configuration tests passing and Cargo reports all Rust tests passing.

---

### Task 3: Build and inspect the new installer artifact

**Files:**
- Generated: `desktop-app/src-tauri/target/release/bundle/nsis/Diamond Inventory_1.0.2_x64-setup.exe`

**Interfaces:**
- Consumes: `DIAMOND_INVENTORY_WEB_URL=https://maitri-inventory-web.onrender.com`.
- Produces: an NSIS installer containing `diamond-inventory.exe`, `libunwind.dll`, and `WebView2Loader.dll`.

- [ ] **Step 1: Build the production Tauri installer.**

  Run:

  ```powershell
  Set-Location desktop-app
  $env:DIAMOND_INVENTORY_WEB_URL = 'https://maitri-inventory-web.onrender.com'
  npm.cmd run build
  ```

  Expected: Tauri finishes successfully and emits `src-tauri/target/release/bundle/nsis/Diamond Inventory_1.0.2_x64-setup.exe`.

- [ ] **Step 2: Inspect the installer bundle for the expected executable and DLLs.**

  Run:

  ```powershell
  Get-ChildItem -Recurse 'desktop-app\src-tauri\target\release\bundle\nsis' | Select-Object Name,Length,FullName
  ```

  Expected: the versioned installer exists; subsequent installed-file inspection finds `diamond-inventory.exe`, `libunwind.dll`, and `WebView2Loader.dll`.

- [ ] **Step 3: Verify the release executable PE subsystem is GUI.**

  Run:

  ```powershell
  $exe = (Resolve-Path 'desktop-app\src-tauri\target\release\diamond-inventory.exe').Path
  [byte[]]$bytes = [System.IO.File]::ReadAllBytes($exe)
  $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
  $subsystem = [BitConverter]::ToUInt16($bytes, $peOffset + 24 + 68)
  if ($subsystem -ne 2) { throw "Expected Windows GUI subsystem 2, got $subsystem" }
  Write-Output "Subsystem=$subsystem (Windows GUI)"
  ```

  Expected: output states `Subsystem=2 (Windows GUI)`.

---

### Task 4: Publish the immutable versioned installer and rebuild the static site

**Files:**
- Modify: `frontend/public/downloads/DiamondInventory-Setup-1.0.2.exe`
- Modify: `frontend/src/release.json`
- Generated: `frontend/out/**` (ignored build output)
- Test: `tests/test_publish_windows_installer.ps1`, `frontend/scripts/*.test.*`

**Interfaces:**
- Consumes: the exact `1.0.2` NSIS artifact from Task 3.
- Produces: public release metadata and the versioned download file with matching SHA-256.

- [ ] **Step 1: Verify the publisher contract.**

  Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tests\test_publish_windows_installer.ps1`

  Expected: `PASS: versioned installer and verified release metadata are published.`

- [ ] **Step 2: Publish the built artifact under its immutable filename.**

  Run:

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-windows-installer.ps1 `
    -InstallerPath 'desktop-app\src-tauri\target\release\bundle\nsis\Diamond Inventory_1.0.2_x64-setup.exe' `
    -Version '1.0.2'
  ```

  Expected: output names `DiamondInventory-Setup-1.0.2.exe`, byte size, and uppercase SHA-256.

- [ ] **Step 3: Run frontend tests and static export against the production API.**

  Run:

  ```powershell
  Set-Location frontend
  npm.cmd test
  $env:NEXT_PUBLIC_API_URL = 'https://maitri-inventory-api.onrender.com'
  npm.cmd run build
  ```

  Expected: all frontend tests pass and `out/download/index.html` is produced with 1.0.2 metadata.

- [ ] **Step 4: Compare local artifact, published file, and metadata checksum.**

  Run:

  ```powershell
  $source = (Resolve-Path 'desktop-app\src-tauri\target\release\bundle\nsis\Diamond Inventory_1.0.2_x64-setup.exe').Path
  $published = (Resolve-Path 'frontend\public\downloads\DiamondInventory-Setup-1.0.2.exe').Path
  $metadata = Get-Content -Raw 'frontend\src\release.json' | ConvertFrom-Json
  $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  $publishedHash = (Get-FileHash -LiteralPath $published -Algorithm SHA256).Hash
  if ($sourceHash -ne $publishedHash -or $sourceHash -ne $metadata.sha256) { throw 'Installer and release metadata checksums differ.' }
  Write-Output "SHA-256=$sourceHash"
  ```

  Expected: all three SHA-256 values are identical.

---

### Task 5: Commit, deploy, and verify the public release

**Files:**
- Modify: all Task 1–4 source and release files.

**Interfaces:**
- Consumes: a successful local build and matching release checksums.
- Produces: a commit merged to `master`, Render Static Site deployment, public executable URL, and an installed GUI-only smoke test.

- [ ] **Step 1: Review the exact release diff and scan for accidental secrets.**

  Run:

  ```powershell
  git diff --check
  git status --short
  git grep -n -I -E '(postgres(ql)?://|JWT_SECRET=|SUPABASE_DATABASE_URL=|BEGIN (RSA |EC )?PRIVATE KEY)'
  ```

  Expected: no whitespace errors and no committed secret values.

- [ ] **Step 2: Commit the release branch, merge its verified commit to `master`, and push `master`.**

  Run in the release worktree:

  ```powershell
  git add -- `
    docs/superpowers/specs/2026-07-23-windows-gui-release-design.md `
    docs/superpowers/plans/2026-07-23-windows-gui-release.md `
    desktop-app/scripts/config.test.js `
    desktop-app/package.json `
    desktop-app/package-lock.json `
    desktop-app/src-tauri/Cargo.toml `
    desktop-app/src-tauri/Cargo.lock `
    desktop-app/src-tauri/tauri.conf.json `
    desktop-app/src-tauri/src/main.rs `
    desktop-app/src-tauri/installer-hooks.nsh `
    frontend/src/release.json `
    frontend/public/downloads/DiamondInventory-Setup-1.0.2.exe
  git commit -m "fix: release terminal-free Windows installer"
  ```

  Then run in `C:\Users\zeel1\diamond-inventory`, where `master` is checked out:

  ```powershell
  git merge --ff-only codex/windows-gui-release
  git push origin master
  ```

  Do not stage `.claude/`, `desktop-app/src-tauri/target`, or `frontend/out`.

  Expected: `master` contains the 1.0.2 installer and Render auto-deploy begins.

- [ ] **Step 3: Wait for Render, then verify public API, pages, and installer.**

  Run:

  ```powershell
  Invoke-WebRequest -UseBasicParsing 'https://maitri-inventory-api.onrender.com/health' -TimeoutSec 120
  Invoke-WebRequest -UseBasicParsing 'https://maitri-inventory-api.onrender.com/ready' -TimeoutSec 120
  Invoke-WebRequest -UseBasicParsing 'https://maitri-inventory-web.onrender.com/login/' -TimeoutSec 60
  Invoke-WebRequest -UseBasicParsing 'https://maitri-inventory-web.onrender.com/download/' -TimeoutSec 60
  Invoke-WebRequest -UseBasicParsing 'https://maitri-inventory-web.onrender.com/downloads/DiamondInventory-Setup-1.0.2.exe' -OutFile "$env:TEMP\DiamondInventory-Setup-1.0.2.exe" -TimeoutSec 180
  ```

  Expected: every HTTP status is `200`; downloaded bytes hash to the published local and metadata SHA-256.

- [ ] **Step 4: Install the public artifact in the interactive user session and smoke-test launch behavior.**

  Run the downloaded NSIS installer in the interactive Windows session, then launch the installed `Diamond Inventory` desktop shortcut. After the login page has loaded, run:

  ```powershell
  $app = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'diamond-inventory.exe' } | Select-Object -First 1
  if (-not $app) { throw 'The installed Diamond Inventory process is not running.' }
  $consoleChild = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'conhost.exe' -and $_.ParentProcessId -eq $app.ProcessId }
  if ($consoleChild) { throw "Diamond Inventory has console child PID $($consoleChild.ProcessId)." }
  Write-Output "Diamond Inventory PID $($app.ProcessId) has no attached console child."
  ```

  Inspect the visible window to confirm it is the production HTTPS login page, not a local server or terminal.

  Expected: the app remains open with no terminal window or attached terminal process.

- [ ] **Step 5: Verify the production cleanup state without modifying it.**

  Run from a shell that has the already-configured production `DATABASE_URL` and SSL environment values:

  ```powershell
  Set-Location backend
  node -e "const pool=require('./src/db/pool'); const names=['loose_diamonds','jewelry_pieces','requests','request_stones','request_shipping_labels','users','sales_reps','branches']; (async()=>{ const rows={}; for (const name of names) { rows[name]=Number((await pool.query('SELECT COUNT(*)::int AS count FROM '+name)).rows[0].count); } console.log(JSON.stringify(rows)); await pool.end(); })().catch(async error=>{ console.error(error); await pool.end().catch(()=>{}); process.exit(1); });"
  ```

  Expected: `loose_diamonds`, `jewelry_pieces`, `requests`, `request_stones`, and `request_shipping_labels` each report `0`; user, sales-rep, and branch records remain available.

- [ ] **Step 6: Run final clean-shell verification.**

  Run:

  ```powershell
  Set-Location backend; npm.cmd test
  Set-Location ..\frontend; npm.cmd test; $env:NEXT_PUBLIC_API_URL = 'https://maitri-inventory-api.onrender.com'; npm.cmd run build
  Set-Location ..\desktop-app; npm.cmd test; Push-Location src-tauri; cargo test; Pop-Location
  ```

  Expected: all automated tests and both builds exit with code `0`.
