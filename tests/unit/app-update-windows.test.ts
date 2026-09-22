import { describe, expect, it } from 'vitest';
import { generateWindowsPatchScript } from '../../electron/services/app-update-api';

describe('generateWindowsPatchScript', () => {
  it('generates robust batch script with pid check and ping delay without timeout', () => {
    const script = generateWindowsPatchScript({
      oldPid: 12345,
      stagedPatchPath: 'C:\\Users\\Test\\AppData\\Roaming\\pi-desktop\\updates\\staged-patch\\app.asar',
      targetAsarPath: 'D:\\Programs\\Pi Desktop\\resources\\app.asar',
      execPath: 'D:\\Programs\\Pi Desktop\\Pi Desktop.exe',
      stagedPatchDir: 'C:\\Users\\Test\\AppData\\Roaming\\pi-desktop\\updates\\staged-patch',
    });

    // 严禁包含在后台重定向模式下会崩溃的 timeout
    expect(script).not.toContain('timeout');

    // 必须包含老进程 PID 等待
    expect(script).toContain('set OLD_PID=12345');
    expect(script).toContain('tasklist /FI "PID eq %OLD_PID%"');
    expect(script).toContain('taskkill /F /PID %OLD_PID%');

    // 必须使用跨版本可靠的 ping 延时
    expect(script).toContain('ping 127.0.0.1 -n 2 >nul');

    // 路径必须带双引号且包含安全拷贝
    expect(script).toContain('copy /y "C:\\Users\\Test\\AppData\\Roaming\\pi-desktop\\updates\\staged-patch\\app.asar" "D:\\Programs\\Pi Desktop\\resources\\app.asar"');

    // 重启必须指定 /D 工作目录，避免跨盘符工作目录丢失
    expect(script).toContain('start "" /D "D:\\Programs\\Pi Desktop" "D:\\Programs\\Pi Desktop\\Pi Desktop.exe"');

    // 必须清理暂存目录与批处理自身
    expect(script).toContain('rmdir /s /q "C:\\Users\\Test\\AppData\\Roaming\\pi-desktop\\updates\\staged-patch"');
    expect(script).toContain('del "%~f0"');
  });

  it('handles paths with spaces safely', () => {
    const script = generateWindowsPatchScript({
      oldPid: 9999,
      stagedPatchPath: 'C:\\Program Data\\pi-desktop\\app.asar',
      targetAsarPath: 'C:\\Program Files\\Pi Desktop\\resources\\app.asar',
      execPath: 'C:\\Program Files\\Pi Desktop\\Pi Desktop.exe',
      stagedPatchDir: 'C:\\Program Data\\pi-desktop',
    });

    expect(script).toContain('"C:\\Program Files\\Pi Desktop\\resources\\app.asar"');
    expect(script).toContain('start "" /D "C:\\Program Files\\Pi Desktop" "C:\\Program Files\\Pi Desktop\\Pi Desktop.exe"');
  });

  it('normalizes forward slashes to backslashes in paths', () => {
    const script = generateWindowsPatchScript({
      oldPid: 5555,
      stagedPatchPath: 'C:/Users/Test/updates/staged-patch/app.asar',
      targetAsarPath: 'D:/Pi Desktop/resources/app.asar',
      execPath: 'D:/Pi Desktop/Pi Desktop.exe',
      stagedPatchDir: 'C:/Users/Test/updates/staged-patch',
    });

    expect(script).not.toContain('C:/');
    expect(script).not.toContain('D:/');
    expect(script).toContain('"C:\\Users\\Test\\updates\\staged-patch\\app.asar"');
    expect(script).toContain('"D:\\Pi Desktop\\resources\\app.asar"');
    expect(script).toContain('start "" /D "D:\\Pi Desktop" "D:\\Pi Desktop\\Pi Desktop.exe"');
  });
});
