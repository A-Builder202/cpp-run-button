'use strict';

// Getting along with Microsoft's C/C++ extension (ms-vscode.cpptools), which
// many people have installed: it adds its own Run button to the editor title
// bar, and it is where they have usually told the editor which compiler to use.

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const CPPTOOLS_ID = 'ms-vscode.cpptools';
const DONT_ASK_KEY = 'cpptoolsButtonPrompt.dontAsk';

// Replaced by the tests, which can't click notification buttons.
const ui = {
  ask: (message, ...items) => vscode.window.showInformationMessage(message, ...items),
};

// Whether the question was asked since the editor started. An object so the
// tests can reset it.
const session = { asked: false };

// Offers to hide Microsoft's Run button (the C_Cpp.debugShortcut setting) the
// first time both buttons are showing. "Keep both" asks again in a later
// session; "Hide it" and "Don't ask again" are remembered.
async function offerToHideRunButton(context, uri) {
  if (session.asked || context.globalState.get(DONT_ASK_KEY)) return;
  if (!vscode.extensions.getExtension(CPPTOOLS_ID)) return;
  const config = vscode.workspace.getConfiguration('C_Cpp', uri);
  if (config.get('debugShortcut') === false) return;

  session.asked = true;
  const HIDE = 'Hide it';
  const KEEP = 'Keep both';
  const NEVER = "Don't ask again";
  const answer = await ui.ask(
    'Microsoft C/C++ also shows a Run button in the title bar. Hide it? ' +
      '(The "C_Cpp.debugShortcut" setting brings it back.)',
    HIDE,
    KEEP,
    NEVER
  );
  if (answer === HIDE) {
    // Change the setting where it is set, so a workspace value doesn't
    // override a change made only in the user settings.
    const value = config.inspect('debugShortcut') || {};
    const target = value.workspaceFolderValue !== undefined
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : value.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update('debugShortcut', false, target);
  }
  if (answer === HIDE || answer === NEVER) {
    await context.globalState.update(DONT_ASK_KEY, true);
  }
}

// The C++ compiler Microsoft C/C++ is set up with, if any: the compilerPath of
// the folder's .vscode/c_cpp_properties.json, then C_Cpp.default.compilerPath.
// Returns a path that may not exist; the caller checks.
function configuredCompiler(uri) {
  const settings = vscode.workspace.getConfiguration('C_Cpp', uri);
  const fallback = settings.get('default.compilerPath');
  for (const compilerPath of [propertiesCompilerPath(uri, fallback), fallback]) {
    const cxx = cxxDriver(compilerPath);
    if (cxx) return cxx;
  }
  return undefined;
}

// Turns a C compiler path into the matching C++ driver next to it (gcc ->
// g++, clang -> clang++, cc -> c++, keeping prefixes like
// x86_64-w64-mingw32- and suffixes like -13). The C driver compiles C++ too,
// but doesn't link the C++ standard library. Anything else, such as MSVC's
// cl.exe, which takes different arguments, gives undefined.
function cxxDriver(compilerPath) {
  if (typeof compilerPath !== 'string' || compilerPath.trim() === '') return undefined;
  const ext = /\.exe$/i.test(compilerPath) ? path.extname(compilerPath) : '';
  const base = path.basename(compilerPath, ext);
  const match = /^(.*?)(g\+\+|clang\+\+|c\+\+|gcc|clang|cc)(-[\d.]+)?$/i.exec(base);
  if (!match) return undefined;
  const [, prefix, driver, suffix = ''] = match;
  const cxx = { gcc: 'g++', clang: 'clang++', cc: 'c++' }[driver.toLowerCase()] || driver;
  return path.join(path.dirname(compilerPath), `${prefix}${cxx}${suffix}${ext}`);
}

const PLATFORM_CONFIG = { linux: 'Linux', darwin: 'Mac', win32: 'Win32' };

function propertiesCompilerPath(uri, defaultCompilerPath) {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return undefined;
  let properties;
  try {
    const file = path.join(folder.uri.fsPath, '.vscode', 'c_cpp_properties.json');
    properties = parseJsonc(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
  const configurations = Array.isArray(properties && properties.configurations) ? properties.configurations : [];
  const configuration =
    configurations.find((c) => c && c.name === PLATFORM_CONFIG[process.platform]) || configurations[0];
  const compilerPath = configuration && configuration.compilerPath;
  if (typeof compilerPath !== 'string') return undefined;
  const resolved = compilerPath
    .replace(/\$\{default\}/g, defaultCompilerPath || '')
    .replace(/\$\{workspaceFolder\}/g, folder.uri.fsPath);
  // Other variables would need Microsoft's resolver, so leave those alone.
  return resolved.includes('${') ? undefined : resolved;
}

// JSON with // and /* */ comments and trailing commas, as VS Code writes it.
function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      out += text.slice(i, end + 1);
      i = end;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (c === ',' && /^\s*[}\]]/.test(text.slice(i + 1))) {
      // Trailing comma: drop it.
    } else {
      out += c;
    }
  }
  return JSON.parse(out);
}

module.exports = { ui, session, offerToHideRunButton, configuredCompiler, cxxDriver, parseJsonc };
