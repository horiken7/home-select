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

## 第4版の更新

- Cloudflare Workers側に Google Programmable Search API 接続処理を追加
- WorkersのSecretとして `GOOGLE_API_KEY` と `GOOGLE_CSE_ID` を使う設計に変更
- `/search` で以下の対象ソースをGoogle検索し、結果を物件カード形式へ整形
  - UR都市機構
  - セーフティネット住宅
  - 福岡市・福岡県の居住支援、補助制度ページ
  - LIFULL HOME'S
  - SUUMO
  - アットホーム
  - CHINTAI
- サ高住、老人ホーム、介護施設、有料老人ホーム系ワードは除外
- 検索結果から `pagemap.cse_thumbnail` / `cse_image` / `og:image` が取れる場合は物件画像として表示

## ファイル構成

```text
/
├─ index.html
├─ styles.css
├─ app.js
├─ config.js
├─ data/
│  ├─ properties.json
│  └─ news.json
└─ workers/
   └─ property-search-worker.js
```

## Google Programmable Search API 接続手順

### 1. Google側で取得するもの

以下の2つが必要です。

```text
GOOGLE_API_KEY
GOOGLE_CSE_ID
```

注意：Google公式ドキュメントでは、Custom Search JSON APIが新規顧客向けには閉じられている旨が案内されています。既に有効化できるGoogle Cloudアカウントで進める前提です。

### 2. Cloudflare WorkersへSecret登録

Cloudflare Workersの対象Workerで、以下のSecretを登録します。

```text
GOOGLE_API_KEY = Google Custom Search API Key
GOOGLE_CSE_ID = Programmable Search Engine ID
```

### 3. Workersにコードを貼り付け

Cloudflare Workersのエディタに、以下のファイル内容を貼り付けてデプロイします。

```text
workers/property-search-worker.js
```

### 4. Workersの動作確認

WorkersのURLが以下の場合、

```text
https://home-select-search.example.workers.dev
```

以下を開いてJSONが返ることを確認します。

```text
https://home-select-search.example.workers.dev/health
https://home-select-search.example.workers.dev/search?area=all&layout=2&rent=10&walk=15&type=all&priority=balanced
```

`/health` の `googleApiConfigured` が `true` なら、Secret設定は成功です。

### 5. `config.js` を更新

`config.js` の `apiEndpoint` にWorkers URLを入れます。

```js
window.HOME_SELECT_CONFIG = {
  apiEndpoint: "https://home-select-search.example.workers.dev"
};
```

### 6. GitHub Pagesで確認

サイト上部のステータスが「Cloudflare Workers API接続中」になれば接続成功です。

## 今後の予定

1. Google API Key と Search Engine ID を取得
2. Cloudflare WorkersにSecret登録
3. Workersをデプロイ
4. `config.js` にWorkers URLを設定
5. 実検索結果の精度を確認し、検索クエリを調整
6. 必要に応じて SerpAPI / Bing / Vertex AI Search への切替も検討
