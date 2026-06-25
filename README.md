# 福岡シニア賃貸ウォッチ / home-select

定年後に福岡市および周辺市町村の賃貸住宅へ住み替えるための物件監視サイトです。

## 初期条件

- 対象：夫婦2人暮らし
- 間取り：2LDK以上
- 管理費込み：10万円以内
- 駅徒歩：15分以内
- 優先：UR・公的賃貸・行政斡旋・居住支援系
- 対象エリア：福岡市全域、南区含む、福岡市周辺市町村
- 現時点では「サービス付き高齢者向け住宅（サ高住）」は対象外

## 第5版の更新

Cloudflareのオンラインエディタでファイルが正しく開けない問題を避けるため、GitHubからWorkerをデプロイできる構成を追加しました。

追加ファイル：

```text
worker-entry.js
wrangler.toml
package.json
.github/workflows/deploy-worker.yml
```

## ファイル構成

```text
/
├─ index.html
├─ styles.css
├─ app.js
├─ config.js
├─ worker-entry.js
├─ wrangler.toml
├─ package.json
├─ data/
│  ├─ properties.json
│  └─ news.json
├─ workers/
│  └─ property-search-worker.js
└─ .github/workflows/
   └─ deploy-worker.yml
```

## Google Programmable Search API 用のSecret

Workerには以下の2つが必要です。

```text
GOOGLE_API_KEY
GOOGLE_CSE_ID
```

## Cloudflare WorkersをGitHubから接続する方針

Cloudflareのオンラインエディタで直接編集せず、`horiken7/home-select` のGitHubリポジトリからデプロイします。

Cloudflare側では、WorkerのソースとしてGitHubリポジトリを接続し、ビルド/デプロイ設定で以下を使います。

```text
Repository: horiken7/home-select
Branch: main
Build command: npm install
Deploy command: npm run deploy:worker
Worker config: wrangler.toml
Entry point: worker-entry.js
```

## GitHub Actionsでデプロイする場合

GitHubのRepository Secretsに以下を登録します。

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

その後、GitHub Actionsの `Deploy Cloudflare Worker` を手動実行するか、mainブランチにWorker関連ファイルをpushするとデプロイされます。

## 動作確認URL

WorkerのURLが以下の場合、

```text
https://home-select-search.example.workers.dev
```

以下を開いてJSONが返ることを確認します。

```text
https://home-select-search.example.workers.dev/health
https://home-select-search.example.workers.dev/search?area=all&layout=2&rent=10&walk=15&type=all&priority=balanced
```

`/health` の `googleApiConfigured` が `true` なら、Google APIのSecret設定は成功です。

## `config.js` の更新

Workerが動いたら、`config.js` の `apiEndpoint` にWorkers URLを入れます。

```js
window.HOME_SELECT_CONFIG = {
  apiEndpoint: "https://home-select-search.example.workers.dev"
};
```

## 今後の予定

1. Cloudflareのオンラインエディタ編集を中止
2. GitHub接続方式でWorkerをデプロイ
3. Google API Key と Search Engine ID をSecret登録
4. `config.js` にWorkers URLを設定
5. 実検索結果の精度を確認し、検索クエリを調整
