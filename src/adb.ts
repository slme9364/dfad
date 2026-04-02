import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);

/**
 * Ensures that the adb command is available in the system PATH.
 * Throws an explicit error if it is not found.
 */
export async function checkAdb(): Promise<void> {
  try {
    await execAsync('adb version');
  } catch (error) {
    throw new Error(
      'adb コマンドが見つかりません。Android SDK Platform-Tools がインストールされ、PATHが通っていることを確認してください。'
    );
  }
}

/**
 * Executes a general adb command and returns the stdout.
 */
export async function adbExec(command: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`adb ${command}`);
    return stdout.trim();
  } catch (error: any) {
    throw new Error(`adbコマンドの実行に失敗しました (adb ${command}): ${error.message}`);
  }
}

/**
 * Captures the current screen and returns it as a base64 encoded PNG string.
 */
export async function getScreenshotBase64(): Promise<string> {
  try {
    const { stdout } = await execAsync('adb exec-out screencap -p', {
      encoding: 'buffer',
      maxBuffer: 1024 * 1024 * 20, // up to 20MB
    });
    return stdout.toString('base64');
  } catch (error: any) {
    throw new Error(`スクリーンショットの取得に失敗しました: ${error.message}`);
  }
}

/**
 * Retrieves the current UI hierarchy (Window Dump) as an XML string.
 * Optimized to remove unnecessary attributes to save tokens, and optionally filters by search query.
 */
export async function getUiHierarchy(options?: { searchQuery?: string }): Promise<string> {
  try {
    // 1. Create UI dump on device
    await adbExec('shell uiautomator dump /sdcard/window_dump.xml');
    // 2. Read the dump from the device (returns stdout text)
    let xml = await adbExec('shell cat /sdcard/window_dump.xml');

    // Remove unnecessary attributes to save tokens.
    // Keep only class, text, content-desc, resource-id, and bounds.
    xml = xml.replace(/\s+([a-zA-Z\-]+)="([^"]*)"/g, (match, attr, val) => {
      if (['class', 'text', 'content-desc', 'resource-id', 'bounds'].includes(attr)) {
        // Strip empty values for everything except bounds and class to save even more space
        if (val === '' && attr !== 'bounds' && attr !== 'class') return '';
        return match;
      }
      return '';
    });

    // If searchQuery is provided, extract only matching node tags
    if (options?.searchQuery) {
      const q = options.searchQuery.toLowerCase();
      const nodes = xml.match(/<node[^>]*>/g) || [];
      const matched = nodes.filter(n => n.toLowerCase().includes(q));
      return matched.length > 0 ? matched.join('\n') : 'No matching elements found.';
    }

    return xml;
  } catch (error: any) {
    throw new Error(`UI構成の取得に失敗しました: ${error.message}`);
  }
}

/**
 * Taps at the specified (x, y) coordinates.
 */
export async function tap(x: number, y: number): Promise<void> {
  await adbExec(`shell input tap ${x} ${y}`);
}

/**
 * Swipes from (x1, y1) to (x2, y2) over the specified duration (ms).
 */
export async function swipe(x1: number, y1: number, x2: number, y2: number, duration: number = 300): Promise<void> {
  await adbExec(`shell input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`);
}

/**
 * Inputs text. Spaces might need escaping depending on the shell,
 * but for simplicity we wrap it in quotes.
 */
export async function inputText(text: string): Promise<void> {
  // escaping quotes
  const escaped = text.replace(/'/g, "\\'");
  await adbExec(`shell input text '${escaped}'`);
}

/**
 * Sends a key event to the device.
 */
export async function keyEvent(keycode: number | string): Promise<void> {
  await adbExec(`shell input keyevent ${keycode}`);
}

/**
 * Launches an application by package name.
 */
export async function launchApp(packageName: string): Promise<void> {
  await adbExec(`shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`);
}

/**
 * Clears the logcat buffer.
 */
export async function clearLogcat(): Promise<void> {
  await adbExec('logcat -c');
}

/**
 * Gets recent logcat output, optionally filtered by text and/or package name.
 */
export async function getLogcat(lines: number = 200, filterText?: string, packageName?: string): Promise<string> {
  try {
    let pidOption = '';
    if (packageName) {
      try {
        const pids = await adbExec(`shell pidof ${packageName}`);
        const mainPid = pids.trim().split(/\s+/)[0];
        if (mainPid) {
          pidOption = ` --pid=${mainPid}`;
        } else {
          return `No log available: Process for package '${packageName}' is not running.`;
        }
      } catch (e) {
        return `No log available: Process for package '${packageName}' is not running.`;
      }
    }

    const result = await adbExec(`logcat -d -t ${lines}${pidOption}`);
    let linesArr = result.split('\n');
    if (filterText) {
      const lowerFilter = filterText.toLowerCase();
      linesArr = linesArr.filter(line => line.toLowerCase().includes(lowerFilter));
    }
    return linesArr.join('\n');
  } catch (error: any) {
    throw new Error(`Logcatの取得に失敗しました: ${error.message}`);
  }
}

/**
 * Retrieves the currently focused package and activity.
 */
export async function getTopActivity(): Promise<string> {
  try {
    const out = await adbExec('shell dumpsys window windows');
    const lines = out.split('\n');
    const focusLine = lines.find(line => line.includes('mCurrentFocus') || line.includes('mFocusedApp'));
    return focusLine ? focusLine.trim() : 'Unknown Activity';
  } catch (error: any) {
    throw new Error(`Top Activityの取得に失敗しました: ${error.message}`);
  }
}

let isRecording = false;

/**
 * Starts screen recording on the device.
 */
export async function startRecording(): Promise<void> {
  if (isRecording) {
    throw new Error('既に録画中です。');
  }
  
  // 古い録画ファイルを削除
  await adbExec('shell rm -f /sdcard/mcp_record.mp4').catch(() => {});
  
  // バックグラウンドで録画開始
  const proc = spawn('adb', ['shell', 'screenrecord', '/sdcard/mcp_record.mp4'], {
    stdio: 'ignore',
    detached: true,
  });
  proc.unref();
  
  isRecording = true;
}

/**
 * Stops screen recording and pulls the mp4 file to the local ./records/ directory.
 * Returns the absolute path of the saved video.
 */
export async function stopRecording(): Promise<string> {
  if (!isRecording) {
    throw new Error('録画は実行されていません。');
  }

  try {
    // デバイス上のscreenrecordプロセスにSIGINT(2)を送り、安全に保存させる
    await adbExec('shell killall -2 screenrecord').catch(async () => {
      // killallが存在しない場合のため、pidofを利用したkillも試行
      await adbExec('shell "kill -2 \\$(pidof screenrecord)"').catch(() => {});
    });
  } catch (e) {
    // 無視
  }
  
  // 動画ファイルの生成完了を少し待機
  await new Promise(r => setTimeout(r, 3000));

  const recordsDir = path.join(process.cwd(), 'records');
  if (!fs.existsSync(recordsDir)) {
    fs.mkdirSync(recordsDir, { recursive: true });
  }

  const filename = `record_${Date.now()}.mp4`;
  const localPath = path.join(recordsDir, filename);

  try {
    await execAsync(`adb pull /sdcard/mcp_record.mp4 "${localPath}"`);
  } catch(error: any) {
     throw new Error(`動画の保存(pull)に失敗しました: ${error.message}`);
  }
  
  isRecording = false;
  return localPath;
}
