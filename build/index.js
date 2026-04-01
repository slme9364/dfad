#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from '@modelcontextprotocol/sdk/types.js';
import z from 'zod';
import { checkAdb, getScreenshotBase64, getUiHierarchy, tap, inputText, keyEvent, launchApp, } from './adb.js';
const server = new Server({
    name: 'dfad',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// Define Schemas for the tools
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
// Register tools list
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'get_screen_state',
                description: 'スクリーンショットと現在のUI構造(View Hierarchy XML)を取得します。画面の状態を確認し、次にタップすべき要素を見つけるために使用してください。',
                inputSchema: { type: 'object', properties: {} },
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
        ],
    };
});
// Handle tool executions
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Ensure adb is accessible
    try {
        await checkAdb();
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: error.message }],
            isError: true,
        };
    }
    const { name, arguments: args } = request.params;
    try {
        if (name === 'get_screen_state') {
            const xml = await getUiHierarchy();
            const base64Image = await getScreenshotBase64();
            return {
                content: [
                    {
                        type: 'text',
                        text: `現在の画面のView Hierarchy (XML):\n${xml}\n\n※この構成とスクリーンショットの画像を合わせて判断し、操作したい要素の bounds="[x1,y1][x2,y2]" から座標を計算してください。`,
                    },
                    {
                        type: 'image',
                        data: base64Image,
                        mimeType: 'image/png',
                    },
                ],
            };
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
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    catch (error) {
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
