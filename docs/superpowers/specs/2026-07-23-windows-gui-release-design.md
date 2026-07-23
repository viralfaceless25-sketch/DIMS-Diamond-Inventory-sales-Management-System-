# Windows GUI Release 1.0.2 Design

## Goal

Publish `DiamondInventory-Setup-1.0.2.exe` as a public Windows installer that staff can download and run on a new Windows 10 or Windows 11 computer. The installed Diamond Inventory application must start as a normal desktop window without opening a terminal, and closing any unrelated terminal must not close the application.

The shared Render/Supabase service remains the backend. The installer must continue to need no Node.js, Rust, local database, configuration file, or server setup on the staff computer.

## Problem and Root Cause

The current installed desktop executable is linked as a Windows console application. Windows therefore creates an attached `conhost.exe` terminal for `diamond-inventory.exe`; closing that console also closes the app. The Tauri source does not declare the Windows GUI subsystem for release builds.

Older local-development installations may also contain the Startup shortcut `Diamond Inventory Server.lnk`, which starts a local terminal-based server. The cloud desktop client no longer uses that launcher.

## Approved Release Design

1. Add the Rust crate-level attribute below to `desktop-app/src-tauri/src/main.rs`:

   ```rust
   #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
   ```

   Release builds will be Windows GUI executables. Debug builds retain a console so local developers still receive Rust/Tauri diagnostics.

2. Extend the NSIS post-install hook in `desktop-app/src-tauri/installer-hooks.nsh` to remove only the obsolete per-user Startup shortcut:

   ```nsh
   Delete "$SMSTARTUP\Diamond Inventory Server.lnk"
   ```

   The existing desktop shortcut is preserved. No inventory data, user account, branch, or sales-rep record is changed by the installer update.

3. Bump the desktop package, Cargo package, Tauri configuration, public release metadata, and installer filename from `1.0.1` to `1.0.2`.

4. Build a new NSIS installer, publish the byte-identical artifact as `frontend/public/downloads/DiamondInventory-Setup-1.0.2.exe`, rebuild the static frontend, commit and push the release, and wait for Render to serve the new version.

## Data Scope

Before this release, the requested production business-data cleanup preserved users, sales-rep profiles, branches, and audit logs while clearing loose-diamond stock, jewelry stock, requests, request stones, and request shipping labels. That cleanup is complete and is not repeated by this release.

## Safety and Upgrade Behavior

- The installer remains per-user and uses the WebView2 bootstrapper where required.
- The installer remains unsigned; a new computer may show Microsoft SmartScreen's **More info** then **Run anyway** prompt.
- The Tauri app opens the same HTTPS Render frontend and contains no database secrets.
- Removing the legacy startup shortcut is idempotent: an absent shortcut produces no error, and unrelated Startup entries are untouched.
- No automatic updater is added. Staff download the versioned public installer when a new release is announced.

## Verification and Acceptance

The release is accepted only when all of the following are true:

1. A regression test fails before the new GUI-subsystem attribute and legacy-shortcut deletion exist, then passes after the implementation.
2. Desktop configuration tests and Rust unit tests pass.
3. The Tauri build creates a `1.0.2` NSIS installer containing the expected runtime DLLs.
4. The PE subsystem of the built `diamond-inventory.exe` is Windows GUI, not Windows CUI/console.
5. The public static frontend advertises the exact 1.0.2 filename, byte size, and SHA-256 value of the installer.
6. The public installer URL downloads successfully and its SHA-256 matches both the release page and the local build artifact.
7. The new installer launches the installed app without a `conhost.exe` child process, and the app loads the production login page.
8. The Render API `/health` and `/ready` endpoints plus the public `/login/` and `/download/` pages return successfully.
9. Production data counts remain zero for the five cleared business-data tables and preserved identity tables remain present.

## Out of Scope

- Code signing and SmartScreen publisher reputation.
- Offline inventory operation or a local server fallback.
- Changes to user roles, passwords, stock workflows, sales-rep workflows, branches, or backend/database schema.
- Automatic desktop updates and macOS distribution.
