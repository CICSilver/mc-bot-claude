import { spawn } from 'node:child_process';
import { childEnv, ensureRuntime, findCodex } from './codex-config.mjs';
ensureRuntime();
const child = spawn(findCodex(), ['login', ...(process.argv.includes('--device-auth') ? ['--device-auth'] : []), '-c', 'forced_login_method="chatgpt"'], { env: childEnv(), stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
