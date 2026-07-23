const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('desktop package and installer are versioned for the current release', () => {
  const pkg = JSON.parse(read('package.json'));
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(pkg.version, '1.0.3');
  assert.equal(config.version, '1.0.3');
  assert.equal(config.productName, 'Diamond Inventory');
  assert.deepEqual(config.bundle.targets, ['nsis']);
});

test('desktop build delegates toolchain selection to the build environment', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.build, 'tauri build');
});

test('installer needs no admin rights and bootstraps WebView2 when missing', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(config.bundle.windows.nsis.installMode, 'currentUser');
  assert.equal(config.bundle.windows.webviewInstallMode.type, 'downloadBootstrapper');
  assert.equal(config.bundle.windows.webviewInstallMode.silent, true);
  assert.equal(config.bundle.resources['bin/'], '');
  assert.match(read('src-tauri/installer-hooks.nsh'), /Call CreateOrUpdateDesktopShortcut/);
});

test('remote inventory content receives no Tauri capabilities', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  const main = read('src-tauri/src/main.rs');
  const sourceConfig = read('src-tauri/src/config.rs');
  assert.deepEqual(config.app.windows, []);
  assert.deepEqual(config.app.security.capabilities, []);
  assert.match(main, /WebviewUrl::External\(config::production_url\(\)\)/);
  assert.match(main, /\.on_navigation\(config::is_allowed_navigation\)/);
  assert.match(main, /\.on_new_window/);
  assert.match(main, /NewWindowResponse::Deny/);
  assert.doesNotMatch(main, /invoke_handler|plugin\(/);
  assert.match(sourceConfig, /https:\/\/maitri-inventory-web\.onrender\.com/);
  assert.match(sourceConfig, /assert_eq!\(\s*url\.scheme\(\),\s*"https"/s);
});

test('release executable is a GUI application and removes the legacy local launcher', () => {
  const main = read('src-tauri/src/main.rs');
  const hooks = read('src-tauri/installer-hooks.nsh');
  assert.match(main, /#!\[cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)\]/);
  assert.match(hooks, /Delete "\$SMSTARTUP\\Diamond Inventory Server\.lnk"/);
});
