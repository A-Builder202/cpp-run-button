'use strict';

// Runs the test suite inside a real editor, once with a folder open and once
// with just loose files, one window at a time. Needs g++ on PATH and a
// desktop session.
//
// Usage: VSCODE_BIN=/path/to/editor node test/runTest.js
// Set CPP_RUN_TEST_GREP to a regular expression to run only matching tests,
// and CPP_RUN_TEST_EXTENSION to an installed copy of the extension to test a
// packaged build instead of this checkout.
//
// VSCODE_BIN must be the editor's main executable (for a VSCodium tarball,
// VSCodium-linux-x64/codium), not the bin/codium or bin/code launcher script:
// the launcher hands off to the editor and exits without waiting for it.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bin = process.env.VSCODE_BIN || 'codium';
const root = path.join(__dirname, '..');

function launch(label, openFolder) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-run-button-'));
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work);

  const args = [
    `--extensionDevelopmentPath=${process.env.CPP_RUN_TEST_EXTENSION || root}`,
    `--extensionTestsPath=${path.join(__dirname, 'suite')}`,
    `--user-data-dir=${path.join(tmp, 'user-data')}`,
    `--extensions-dir=${path.join(tmp, 'extensions')}`,
    '--disable-extensions',
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    openFolder ? work : '--new-window',
  ];
  const results = path.join(tmp, 'results.json');
  const env = { ...process.env, CPP_RUN_TEST_DIR: work, CPP_RUN_TEST_RESULTS: results };
  delete env.ELECTRON_RUN_AS_NODE;

  console.log(`\n=== ${label} ===`);
  const result = spawnSync(bin, args, { stdio: 'inherit', env, timeout: 10 * 60 * 1000 });
  if (result.error) console.error(String(result.error));

  // The suite writes its results itself, so an editor that exits without
  // running it (or a launcher that doesn't wait) can't count as a pass.
  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(results, 'utf8'));
  } catch {
    console.error('The test suite did not run.');
    return false;
  }
  for (const { name, error } of summary) {
    console.log(`  ${error ? 'FAIL' : 'ok  '}  ${name}${error ? `\n        ${error}` : ''}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return result.status === 0 && summary.length > 0 && summary.every((t) => !t.error);
}

const passed = [launch('folder open', true), launch('no folder', false)];
if (passed.every(Boolean)) {
  console.log('\nAll tests passed.');
} else {
  console.error('\nSome tests failed.');
  process.exit(1);
}
