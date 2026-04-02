#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import z from 'zod';
import {
  checkAdb,
  getScreenshotBase64,
  getUiHierarchy,
  tap,
  inputText,
  keyEvent,
  launchApp,
  clearLogcat,
  getLogcat,
  startRecording,
  stopRecording,
  swipe,
  getTopActivity,
} from './adb.js';

const server = new Server(
  {
    name: 'dfad',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define Schemas for the tools

const GetScreenStateSchema = z.object({
  includeXml: z.boolean().optional().default(true).describe('If false, skips returning the UI Hierarchy XML. Use this if you only need the image.'),
  includeImage: z.boolean().optional().default(true).describe('If false, skips returning the base64 image. Useful if you only need the XML/coordinates.'),
  searchQuery: z.string().optional().describe('If specified, returns only UI elements containing this text (in text, content-desc, class, or resource-id) along with their bounds.'),
});

const TapSchema = z.object({
  x: z.number().int().describe('X coordinate on the screen'),
  y: z.number().int().describe('Y coordinate on the screen'),
});

const InputTextSchema = z.object({
  text: z.string().describe('Text to input into the currently focused field'),
});

const KeyEventSchema = z.object({
  keycode: z.union([z.number(), z.string()]).describe('Key event code (e.g., 3 for HOME, 4 for BACK, 66 for ENTER)'),
});

const LaunchAppSchema = z.object({
  packageName: z.string().describe('The package name of the app to launch (e.g., com.example.app)'),
});

const GetLogcatSchema = z.object({
  lines: z.number().int().optional().describe('Number of recent log lines to fetch. Default is 200.'),
  filterText: z.string().optional().describe('Optional text to filter the log output. Case-insensitive.'),
  packageName: z.string().optional().describe('If provided, filters the logcat to only show logs from this app package.'),
});

const SwipeSchema = z.object({
  x1: z.number().int().describe('Start X coordinate'),
  y1: z.number().int().describe('Start Y coordinate'),
  x2: z.number().int().describe('End X coordinate'),
  y2: z.number().int().describe('End Y coordinate'),
  duration: z.number().int().optional().describe('Duration in ms for the swipe. Set higher (e.g. 1000) for long press.'),
});

// Register tools list
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_screen_state',
        description: 'スクリーンショットと現在のUI構造(View Hierarchy XML)を取得します。引数を使って検索文字で絞り込んだり、不要な画像/XMLの出力を行わない設定が可能です。',
        inputSchema: {
          type: 'object',
          properties: {
            includeXml: { type: 'boolean', description: 'If false, skips returning the UI Hierarchy XML. Default is true.' },
            includeImage: { type: 'boolean', description: 'If false, skips returning the base64 image. Default is true.' },
            searchQuery: { type: 'string', description: 'If specified, returns only UI elements containing this text along with their bounds.' },
          },
        },
      },
      {
        name: 'tap',
        description: '指定された(X, Y)座標をタップします。get_screen_stateで得た要素の座標(bounds)の中心などを指定してください。',
        inputSchema: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate on the screen' },
            y: { type: 'number', description: 'Y coordinate on the screen' },
          },
          required: ['x', 'y'],
        },
      },
      {
        name: 'input_text',
        description: 'フォーカスされた入力欄に文字を入力します。事前にタップツールで入力欄をフォーカスする必要があります。',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to input into the currently focused field' },
          },
          required: ['text'],
        },
      },
      {
        name: 'key_event',
        description: 'Androidのキーイベント(HOME=3, BACK=4, ENTER=66 など)を発行します。',
        inputSchema: {
          type: 'object',
          properties: {
            keycode: { type: ['number', 'string'], description: 'Key event code (e.g., 3 for HOME, 4 for BACK, 66 for ENTER)' },
          },
          required: ['keycode'],
        },
      },
      {
        name: 'launch_app',
        description: 'Androidアプリをパッケージ名から起動します。',
        inputSchema: {
          type: 'object',
          properties: {
            packageName: { type: 'string', description: 'The package name of the app to launch (e.g., com.example.app)' },
          },
          required: ['packageName'],
        },
      },
      {
        name: 'clear_logcat',
        description: 'AndroidのLogcatバッファをクリアします。テスト開始前や特定のアクション前に呼び出すことで、過去の古いログを取得対象から除外し、クリーンな状態で検証できるようにします。',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get_logcat',
        description: 'AndroidのLogcatから直近のログを取得します。アプリのクラッシュやエラー(FATAL EXCEPTION)、出力された通信ログなどの内部状態を検証するために使用します。',
        inputSchema: {
          type: 'object',
          properties: {
            lines: { type: 'number', description: 'Number of recent log lines to fetch. Default is 200.' },
            filterText: { type: 'string', description: 'Optional text to filter the log output. Case-insensitive.' },
            packageName: { type: 'string', description: 'If provided, filters the logcat to only show logs from this app package.' },
          },
        },
      },
      {
        name: 'start_recording',
        description: '端末の画面録画(mp4)をバックグラウンドで開始します。人間が確認するためのエビデンスとして利用します。(動画自体はAIには返されずローカルPCに保存されます)',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'stop_recording',
        description: '開始した画面録画を停止し、ローカルPCのrecordsディレクトリ内にmp4ファイルとして自動保存します。',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'swipe',
        description: '画面上の指定された座標間を操作します（スワイプ、スクロール、長押しなど）。指定した時間(ms)をかけて始点から終点へスワイプします。',
        inputSchema: {
          type: 'object',
          properties: {
            x1: { type: 'number', description: 'Start X coordinate' },
            y1: { type: 'number', description: 'Start Y coordinate' },
            x2: { type: 'number', description: 'End X coordinate' },
            y2: { type: 'number', description: 'End Y coordinate' },
            duration: { type: 'number', description: 'Duration in ms. Default is 300. Use e.g. 1000 for slow scroll or long press.' },
          },
          required: ['x1', 'y1', 'x2', 'y2'],
        },
      },
      {
        name: 'get_top_activity',
        description: '現在、画面の最前面で実行されているパッケージ(アプリ)名とActivity情報を取得します。想定外の画面に移動していないかの確認に便利です。',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  };
});

// Handle tool executions
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Ensure adb is accessible
  try {
    await checkAdb();
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: error.message }],
      isError: true,
    };
  }

  const { name, arguments: args } = request.params;

  try {
    if (name === 'get_screen_state') {
      const parsed = GetScreenStateSchema.safeParse(args);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
      }
      const { includeXml, includeImage, searchQuery } = parsed.data;

      const results = [];
      
      // 画像が必要な場合
      if (includeImage) {
        try {
          const base64Img = await getScreenshotBase64();
          results.push({
            type: 'image',
            data: base64Img,
            mimeType: 'image/png'
          });
        } catch (e: any) {
          results.push({ type: 'text', text: `[Error taking screenshot: ${e.message}]` });
        }
      }

      // XMLが必要な場合、または検索クエリがある場合
      if (includeXml || searchQuery) {
        try {
          const hierarchy = await getUiHierarchy({ searchQuery });
          const prefix = searchQuery ? `Found Elements matching "${searchQuery}":` : `UI Hierarchy (Optimized for Tokens):\n※この構成と画像を合わせて判断し、操作したい要素の bounds="[x1,y1][x2,y2]" から座標を計算してください。`;
          results.push({ type: 'text', text: `${prefix}\n${hierarchy}` });
        } catch (e: any) {
          results.push({ type: 'text', text: `[Error getting UI hierarchy: ${e.message}]` });
        }
      }

      if (results.length === 0) {
        return { content: [{ type: 'text', text: 'No content requested.' }] };
      }

      return { content: results as any };
    }

    if (name === 'tap') {
      const parsed = TapSchema.safeParse(args);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
      }
      await tap(parsed.data.x, parsed.data.y);
      return { content: [{ type: 'text', text: `Tapped at (${parsed.data.x}, ${parsed.data.y})` }] };
    }

    if (name === 'input_text') {
      const parsed = InputTextSchema.safeParse(args);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
      }
      await inputText(parsed.data.text);
      return { content: [{ type: 'text', text: `Input text: '${parsed.data.text}'` }] };
    }

    if (name === 'key_event') {
      const parsed = KeyEventSchema.safeParse(args);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
      }
      await keyEvent(parsed.data.keycode);
      return { content: [{ type: 'text', text: `Sent key event: ${parsed.data.keycode}` }] };
    }

    if (name === 'launch_app') {
      const parsed = LaunchAppSchema.safeParse(args);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
      }
      await launchApp(parsed.data.packageName);
      return { content: [{ type: 'text', text: `Launched app matching package: ${parsed.data.packageName}` }] };
    }

    if (name === 'clear_logcat') {
      await clearLogcat();
      return { content: [{ type: 'text', text: 'Logcat buffer cleared successfully.' }] };
    }

    if (name === 'get_logcat') {
      const parsed = GetLogcatSchema.safeParse(args);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
      }
      const logs = await getLogcat(parsed.data.lines, parsed.data.filterText, parsed.data.packageName);
      return { content: [{ type: 'text', text: logs || 'No matching logs found.' }] };
    }

    if (name === 'start_recording') {
      await startRecording();
      return { content: [{ type: 'text', text: 'Recording started successfully. Remember to call stop_recording when done.' }] };
    }

    if (name === 'stop_recording') {
      const savedPath = await stopRecording();
      return { content: [{ type: 'text', text: `Recording stopped. The video has been saved locally to: ${savedPath}` }] };
    }

    if (name === 'swipe') {
      const parsed = SwipeSchema.safeParse(args);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
      }
      const { x1, y1, x2, y2, duration } = parsed.data;
      await swipe(x1, y1, x2, y2, duration);
      return { content: [{ type: 'text', text: `Swiped from (${x1}, ${y1}) to (${x2}, ${y2}) for ${duration || 300}ms` }] };
    }

    if (name === 'get_top_activity') {
      const activityStr = await getTopActivity();
      return { content: [{ type: 'text', text: `Top Activity: ${activityStr}` }] };
    }

    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('dfad MCP Server is running!');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
