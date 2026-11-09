import type { WebDavBackupConfig } from "../../../platform/backup/remoteBackupRuntimeGateway.ts";

export function defaultRemoteBackupFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `Patina-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`;
}

/** Windows 文件名保留字符 + C0/C1 控制字符。
 *
 * 原写法是一条带 `\u0000-\u001f\u007f-\u009f` 的正则——控制字符藏进正则字面量等于
 * 看不见的字符集（`no-control-regex` 就是为这个存在的）。这里按码点判断，语义一字不差，
 * 且不依赖 lint 豁免。 */
function hasReservedOrControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
    if ('<>:"/\\|?*'.includes(ch)) return true;
  }
  return false;
}

export function isValidRemoteBackupFileName(fileName: string): boolean {
  const stem = fileName.endsWith(".zip") ? fileName.slice(0, -4) : "";
  return Boolean(stem.trim()) && fileName.trim() === fileName
    && new TextEncoder().encode(fileName).length <= 240
    && !hasReservedOrControlChar(fileName)
    && !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu.test(stem);
}

export function sameRemoteBackupTarget(left: WebDavBackupConfig, right: WebDavBackupConfig): boolean {
  return left.url === right.url && left.username === right.username && left.remoteDir === right.remoteDir;
}
