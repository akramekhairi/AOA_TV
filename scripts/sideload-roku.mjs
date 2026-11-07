import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
process.loadEnvFile(resolve('.env'));
const host = process.env.ROKU_HOST;
const password = process.env.ROKU_DEV_PASSWORD;
if (!host || !password) throw new Error('Set ROKU_HOST and ROKU_DEV_PASSWORD in private .env.');
if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.split('.').some(x => Number(x) > 255)) throw new Error('ROKU_HOST must be an IPv4 address.');
if (/[\r\n\0]/.test(password)) throw new Error('Unsupported newline in password.');
const zip = resolve('dist/AOA_TV.zip'); await access(zip);
const escape = value => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
// curl receives credentials on stdin, not in process arguments or terminal output.
const child = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', [
  '--config', '-', '--digest', '--silent', '--show-error', '--fail-with-body',
  '--max-time', '90', '--form', 'mysubmit=Install', '--form', `archive=@${zip}`,
  `http://${host}/plugin_install`
], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.end(`user = "${escape('rokudev:' + password)}"\n`);
let result = ''; child.stdout.on('data', part => { result += part.toString(); });
child.stderr.resume();
child.on('error', () => { console.error('Unable to start curl; install curl from your operating system vendor.'); process.exitCode = 1; });
child.on('exit', code => {
  if (code !== 0) { console.error(`Installer request failed (curl ${code}). Check IP, developer password, and developer mode.`); process.exitCode = 1; return; }
  if (/Install Success|Application Received|Install succeeded/i.test(result)) console.log('Roku installer reported success. Verify the app on the TV.');
  else if (/identical|same version/i.test(result)) console.log('The Roku installer reports an identical package. Verify the existing app on the TV.');
  else { console.error('Installer returned a response without a recognized success message. Check the TV or installer page; success is not confirmed.'); process.exitCode = 1; }
});
