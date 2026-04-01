import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
  console.log('📦 まず、dfad MCPサーバーのビルドを行います...');
  try {
    execSync('npm run build', { stdio: 'inherit', cwd: rootDir });
  } catch (error) {
    console.error('❌ ビルド中にエラーが発生しました。スクリプトを終了します。');
    rl.close();
    return;
  }

  const absoluteServerPath = path.join(rootDir, 'build', 'index.js');
  // Use absolute path to current node executable
  const nodePath = process.execPath;
  
  const absoluteServerConfig = {
    command: nodePath,
    args: [absoluteServerPath],
  };

  console.log('\n=======================================');
  console.log('🤖 dfad Setup Wizard');
  console.log('=======================================');
  console.log('どのAIツールにこのMCPサーバー (dfad) をセットアップしますか？\n');
  console.log('  1. Claude Code (CLI)              -- ※ 開発とテストの同居に一番オススメ！');
  console.log('  2. Claude Desktop (Mac設定のみ)   -- 自動的にファイルを書き換えます');
  console.log('  3. Cursor                         -- GUI画面に入力する手順をご案内します');
  console.log('  4. Antigravity                    -- Antigravity向けのテスト指示方法を表示');
  console.log('  5. その他 (汎用JSON設定を表示)     -- 別のツールでご自身で設定したい方向け');
  
  const choice = await askQuestion('\n番号を選択してください [1-5]: ');

  const option = choice.trim();

  switch (option) {
    case '1':
      console.log('\n⚙️ Configuring for Claude Code (CLI)...');
      try {
        console.log('claudeコマンドを実行して、グローバル(全プロジェクト共通)に追加しています...');
        const result = execSync(`claude mcp add -s user dfad node "${absoluteServerPath}"`, { cwd: rootDir, encoding: 'utf-8' });
        console.log(result);
        console.log('✅ Claude Code へのグローバル追加が完了しました！');
        console.log('👉 次に任意のディレクトリで `claude mcp list` を実行すれば、「dfad」が追加されていることを確認できます。');
        console.log('👉 テストを開始するには、claudeと会話を始めて「Androidの画面を取得してUI解析に進んで」とテストシナリオを依頼してください。');
      } catch (e) {
        console.log('\n❌ [エラー] claude コマンドの実行に失敗しました。');
        console.log('Claude Codeがインストールされていないか、PATHが通っていない可能性があります。');
        console.log(`手動で追加する場合は、システム上のターミナルで以下を実行してください:\n  claude mcp add -s user dfad node "${absoluteServerPath}"`);
      }
      break;

    case '2':
      console.log('\n⚙️ Configuring for Claude Desktop...');
      const configPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      
      let config = {};
      
      if (fs.existsSync(configPath)) {
        try {
          const raw = fs.readFileSync(configPath, 'utf8');
          // if file is empty JSON.parse fails, default to empty object
          config = raw.trim() === '' ? {} : JSON.parse(raw);
        } catch (e) {
          console.log('\n❌ 設定ファイルの読み込みに失敗しました。', e.message);
          break;
        }
      }

      config.mcpServers = config.mcpServers || {};
      config.mcpServers['dfad'] = absoluteServerConfig;

      try {
        const dir = path.dirname(configPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        console.log(`✅ 成功しました！設定を以下のパスに保存(追記)しました: \n   ${configPath}`);
        console.log('\n⚠️ 設定したツールを読み込ませるには、Claude Desktopアプリを完全に再起動する必要があります！');
        console.log('   (MacのDockでアイコンを右クリック -> 終了 -> もう一度起動する)');
      } catch (e) {
        console.log('\n❌ 設定ファイルの書き込みに失敗しました。', e.message);
      }
      break;

    case '3':
      console.log('\n⚙️ Configuring for Cursor...');
      console.log('\nCursorのGUIから以下の手順で追加してください:');
      console.log('--------------------------------------------------');
      console.log('【手順 1】 Cursorの設定画面 (Cursor Settings) を開く');
      console.log('【手順 2】 メニューの [Features] -> サイドバーから [MCP] の項目を開く');
      console.log('【手順 3】 [+ Add New MCP Server] をクリック');
      console.log('【手順 4】 以下の情報を入力して保存してください:');
      console.log(`      ・Name    :  dfad`);
      console.log(`      ・Type    :  command`);
      console.log(`      ・Command :  node "${absoluteServerPath}"`);
      console.log('--------------------------------------------------');
      console.log('👉 保存後、「Refresh」ボタンを押してサーバーが緑色(起動状態)になれば準備完了です！\n');
      console.log('※CursorのComposer上で「Android画面を取得して、一番上のボタンをタップして」と話しかけることでテストを開始できます。');
      break;

    case '4':
      console.log('\n⚙️ Configuring for Antigravity...');
      console.log('\nAntigravityにテストを自動実行させる場合は、チャットウィンドウで以下のように指示文を送ってください:');
      console.log('--------------------------------------------------');
      console.log('Androidの動作検証を始めます。');
      console.log('MCPクライアント機能を使わず、ターミナルで直接私に以下のコマンドを実行してテストを進めてください。');
      console.log('1. `node build/index.js` コマンドで動くのではなく、`src/adb.ts` などのスクリプトを作って自ら使ってください。');
      console.log('2. もし必要なツールがなければ `npm run dev` などでテスト用関数を叩いてください。');
      console.log('（↑今回のMCPツールはサーバー形式のため、Antigravityが直接ターミナルから利用する場合は生のadbコマンド発行を依頼するのが一番早いです）');
      console.log('--------------------------------------------------');
      break;

    case '5':
    default:
      if (option !== '5') {
        console.log(`\n❌ [エラー] 不正な選択肢(${option})です。その他の設定としてJSONを出力します。`);
      }
      console.log('\n⚙️ 一般的なMCPクライアント（Windsurf等）向け JSON設定:');
      console.log('--------------------------------------------------');
      console.log(JSON.stringify({ "dfad": absoluteServerConfig }, null, 2));
      console.log('--------------------------------------------------');
      console.log('上記の設定をお使いのエディタの mcp.json などに追記してください。');
      break;
  }

  console.log('\n🎉 Setup Wizard exited.');
  rl.close();
}

main().catch(err => {
  console.error(err);
  rl.close();
});
