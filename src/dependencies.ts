import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

export interface DependencyOptions {
  needPdf?: boolean;
  requestedEngine?: string;
}

export interface DependencyCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorResult {
  checks: DependencyCheck[];
  hasPandoc: boolean;
  pdfEngine: string | null;
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

export function pdfInstructions(): string[] {
  const platform = platformKind();
  if (platform === 'termux') return ['PDF output additionally needs a LaTeX engine. In Termux, install a TeX Live environment supported by your Termux repository,', 'or build EPUB locally and use the GitHub release workflow for PDF output.'];
  if (platform === 'macos') return ['Install a compact LaTeX distribution:', '  brew install --cask basictex'];
  if (platform === 'windows') return ['Install MiKTeX for PDF output:', '  choco install miktex', 'Or download it from https://miktex.org/download'];
  if (['ubuntu', 'debian', 'linuxmint', 'pop'].includes(platform)) return ['Install a LaTeX engine and common packages:', '  sudo apt-get install texlive-xetex texlive-fonts-recommended'];
  if (['fedora', 'rhel', 'centos', 'rocky', 'almalinux'].includes(platform)) return ['Install a LaTeX engine:', '  sudo dnf install texlive-xetex'];
  if (['arch', 'manjaro'].includes(platform)) return ['Install a LaTeX engine:', '  sudo pacman -S texlive-bin texlive-basic'];
  return ['PDF output needs a LaTeX engine such as xelatex, lualatex, or pdflatex.'];
}

export function findPdfEngine(requested?: string): string | null {
  if (requested) return commandExists(requested) ? requested : null;
  return ['xelatex', 'lualatex', 'pdflatex', 'wkhtmltopdf', 'weasyprint'].find(commandExists) ?? null;
}

export function doctor({needPdf = false, requestedEngine}: DependencyOptions = {}): DoctorResult {
  const hasPandoc = commandExists('pandoc');
  const checks: DependencyCheck[] = [{name: 'Pandoc', ok: hasPandoc, detail: hasPandoc ? 'available' : 'missing'}];
  const pdfEngine = needPdf ? findPdfEngine(requestedEngine) : null;
  if (needPdf) checks.push({name: 'PDF engine', ok: pdfEngine !== null, detail: pdfEngine ?? 'missing'});
  return {checks, hasPandoc, pdfEngine};
}

export function dependencyError(options: DependencyOptions = {}): {result: DoctorResult; message: string} {
  const result = doctor(options);
  const lines = result.checks.map((check) => `${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
  if (!result.hasPandoc) lines.push('', ...pandocInstructions());
  if (options.needPdf && !result.pdfEngine) lines.push('', ...pdfInstructions());
  return {result, message: lines.join('\n')};
}
