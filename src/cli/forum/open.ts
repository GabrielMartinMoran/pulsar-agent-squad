export interface BrowserCommand {
  command: string;
  args: string[];
}

/** Pure platform mapping so the browser launch stays testable. */
export function browserCommand(platform: string, url: string): BrowserCommand {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

/** Best-effort browser launch: a missing opener must never stop the viewer. */
export function openBrowser(url: string, platform: string = process.platform): boolean {
  try {
    const { command, args } = browserCommand(platform, url);
    const child = Bun.spawn({
      cmd: [command, ...args],
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
