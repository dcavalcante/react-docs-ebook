import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

export interface DependencyCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorResult {
  checks: DependencyCheck[];
  hasPandoc: boolean;
}

export function commandExists(command: string): boolean {
  return spawnSync(command, ['--version'], {stdio: 'ignore'}).status === 0;
}

function linuxId(): string {
  try {
    const pairs = fs.readFileSync('/etc/os-release', 'utf8').split('\n').filter((line) => line.includes('='))
      .map((line): [string, string] => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')];
      });
    return Object.fromEntries(pairs).ID ?? 'linux';
  } catch {
    return 'linux';
  }
}

export function platformKind(): string {
  if ((process.env.PREFIX?.includes('com.termux') ?? false) || process.cwd().includes('/data/data/com.termux/')) return 'termux';
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'linux') return linuxId();
  return process.platform;
}

export function pandocInstructions(): string[] {
  const platform = platformKind();
  if (platform === 'termux') return ['Install Pandoc with:', '  pkg install pandoc'];
  if (platform === 'macos') return ['Install Pandoc with Homebrew:', '  brew install pandoc'];
  if (platform === 'windows') return ['Install Pandoc with winget:', '  winget install --source winget --exact --id JohnMacFarlane.Pandoc', 'Or with Chocolatey:', '  choco install pandoc'];
  if (['ubuntu', 'debian', 'linuxmint', 'pop'].includes(platform)) return ['Install Pandoc with:', '  sudo apt-get update', '  sudo apt-get install pandoc'];
  if (['fedora', 'rhel', 'centos', 'rocky', 'almalinux'].includes(platform)) return ['Install Pandoc with:', '  sudo dnf install pandoc'];
  if (['arch', 'manjaro'].includes(platform)) return ['Install Pandoc with:', '  sudo pacman -S pandoc'];
  if (platform === 'alpine') return ['Install Pandoc with:', '  sudo apk add pandoc'];
  return ['Install Pandoc using your package manager or the official installer:', '  https://pandoc.org/installing.html'];
}

export function doctor(): DoctorResult {
  const hasPandoc = commandExists('pandoc');
  const checks: DependencyCheck[] = [{name: 'Pandoc', ok: hasPandoc, detail: hasPandoc ? 'available' : 'missing'}];
  return {checks, hasPandoc};
}

export function dependencyError(): {result: DoctorResult; message: string} {
  const result = doctor();
  const lines = result.checks.map((check) => `${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
  if (!result.hasPandoc) lines.push('', ...pandocInstructions());
  return {result, message: lines.join('\n')};
}
