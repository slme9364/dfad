import { exec } from 'node:child_process';
import { promisify } from 'node:util';

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
 */
export async function getUiHierarchy(): Promise<string> {
  try {
    // 1. Create UI dump on device
    await adbExec('shell uiautomator dump /sdcard/window_dump.xml');
    // 2. Read the dump from the device (returns stdout text)
    const xml = await adbExec('shell cat /sdcard/window_dump.xml');
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
