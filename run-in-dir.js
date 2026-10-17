'use strict';

// Runs a program from a given working directory and exits with its exit code.
//
// The editor won't start a task terminal outside the home folder when no
// folder is open (https://github.com/microsoft/vscode/issues/293399), so in
// that case extension.js starts this script there instead, on the editor's
// own copy of Node, and the script switches to the source file's folder.
//
// Usage: run-in-dir.js <directory> <program>

const { spawn } = require('child_process');
const os = require('os');

const [dir, program] = process.argv.slice(2);
const child = spawn(program, [], { cwd: dir, stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (err) => {
  console.error(`Couldn't start ${program}: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  // Same convention as a shell: 128 + the signal number.
  process.exit(code !== null ? code : 128 + (os.constants.signals[signal] || 0));
});
