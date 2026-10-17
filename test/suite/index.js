'use strict';

// Loaded by the editor through --extensionTestsPath. Uses node:assert only,
// so the project stays free of npm dependencies.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const dir = process.env.CPP_RUN_TEST_DIR;

function write(name, source) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
}

async function open(file) {
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  return document;
}

function runButton() {
  return vscode.commands.executeCommand('cppRunButton.run');
}

function waitFor(condition, timeout = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        reject(new Error('timed out'));
      }
    }, 100);
  });
}

const tests = {
  async 'builds, runs in the file\'s folder and reports the exit code'() {
    const file = write('hello.cpp', [
      '#include <fstream>',
      'int main() { std::ofstream("ran.txt") << "ok"; return 3; }',
      '',
    ].join('\n'));
    await open(file);
    assert.deepStrictEqual(await runButton(), { built: true, exitCode: 3 });
    assert.strictEqual(fs.readFileSync(path.join(dir, 'ran.txt'), 'utf8'), 'ok');
    const exe = process.platform === 'win32' ? 'hello.exe' : 'hello';
    assert.ok(fs.existsSync(path.join(dir, exe)), 'executable sits next to the source');
  },

  async 'saves unsaved edits before building'() {
    const file = write('edited.cpp', 'int main() { return 1; }\n');
    const document = await open(file);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, document.lineAt(0).range, 'int main() { return 4; }');
    await vscode.workspace.applyEdit(edit);
    assert.ok(document.isDirty);
    assert.deepStrictEqual(await runButton(), { built: true, exitCode: 4 });
    assert.ok(!document.isDirty);
  },

  async 'handles spaces in the path'() {
    const file = write(path.join('my folder', 'with space.cpp'), 'int main() { return 5; }\n');
    await open(file);
    assert.deepStrictEqual(await runButton(), { built: true, exitCode: 5 });
  },

  async 'does not run anything when compilation fails'() {
    const file = write('broken.cpp', 'int main() { return oops; }\n');
    await open(file);
    const result = await runButton();
    assert.strictEqual(result.built, false);
    assert.notStrictEqual(result.exitCode, 0);
    assert.ok(!fs.existsSync(path.join(dir, 'broken')) && !fs.existsSync(path.join(dir, 'broken.exe')));
  },

  async 'passes compilerArgs to the compiler'() {
    const config = vscode.workspace.getConfiguration('cppRunButton');
    await config.update('compilerArgs', ['-DANSWER=6'], vscode.ConfigurationTarget.Global);
    try {
      const file = write('defines.cpp', 'int main() { return ANSWER; }\n');
      await open(file);
      assert.deepStrictEqual(await runButton(), { built: true, exitCode: 6 });
    } finally {
      await config.update('compilerArgs', undefined, vscode.ConfigurationTarget.Global);
    }
  },

  async 'reports a compiler that cannot be started'() {
    const config = vscode.workspace.getConfiguration('cppRunButton');
    await config.update('compiler', 'no-such-compiler-xyz', vscode.ConfigurationTarget.Global);
    try {
      await open(write('no-compiler.cpp', 'int main() { return 0; }\n'));
      assert.deepStrictEqual(await runButton(), { built: false });
    } finally {
      await config.update('compiler', undefined, vscode.ConfigurationTarget.Global);
    }
  },

  async 'passes what you type in the terminal to the program'() {
    const file = write('echo.cpp', '#include <iostream>\nint main() { int x; std::cin >> x; return x * 2; }\n');
    await open(file);
    const running = runButton();
    await waitFor(() => vscode.tasks.taskExecutions.some(
      (e) => e.task.definition.type === 'cppRunButton' && e.task.definition.step === 'run'
    ));
    // Give the program a moment to start reading before typing into it.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    vscode.window.activeTerminal.sendText('21');
    assert.deepStrictEqual(await running, { built: true, exitCode: 42 });
  },

  async 'a quick second click wins and the first one runs nothing'() {
    const file = write('twice.cpp', '#include <fstream>\nint main() { std::ofstream("count.txt", std::ios::app) << "x"; return 8; }\n');
    await open(file);
    const first = runButton();
    const second = runButton();
    assert.deepStrictEqual(await second, { built: true, exitCode: 8 });
    const firstResult = await first;
    assert.strictEqual(firstResult.exitCode, undefined);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'count.txt'), 'utf8'), 'x');
  },

  async 'clicking again stops a program that is still waiting for input'() {
    const waiting = write('waits.cpp', '#include <iostream>\nint main() { int x; std::cin >> x; return 0; }\n');
    await open(waiting);
    const first = runButton();
    await waitFor(() => vscode.tasks.taskExecutions.some(
      (e) => e.task.definition.type === 'cppRunButton' && e.task.definition.step === 'run'
    ));
    await open(write('after.cpp', 'int main() { return 7; }\n'));
    assert.deepStrictEqual(await runButton(), { built: true, exitCode: 7 });
    const firstResult = await first;
    assert.strictEqual(firstResult.built, true);
    assert.notStrictEqual(firstResult.exitCode, 0);
  },
};

async function run() {
  await vscode.extensions.getExtension('xalrk.cpp-run-button').activate();
  const results = [];
  const only = process.env.CPP_RUN_TEST_GREP;
  for (const [name, test] of Object.entries(tests)) {
    if (only && !new RegExp(only).test(name)) continue;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out after 60 s')), 60000);
    });
    try {
      await Promise.race([test(), timeout]);
      results.push({ name });
    } catch (err) {
      results.push({ name, error: String(err && err.stack ? err.stack : err) });
    } finally {
      clearTimeout(timer);
    }
    // The editor's console output doesn't reliably reach the terminal, so the
    // results go to a file that test/runTest.js prints. It is rewritten after
    // every test so a hang still leaves a record of how far it got.
    fs.writeFileSync(process.env.CPP_RUN_TEST_RESULTS, JSON.stringify(results));
  }
  const failures = results.filter((r) => r.error).length;
  if (failures) throw new Error(`${failures} test(s) failed`);
}

module.exports = { run };
