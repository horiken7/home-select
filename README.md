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

## 第3版の更新

- `config.js` を追加
- Cloudflare Workers APIを後から接続できる構成に変更
- API未設定時は `data/properties.json` と `data/news.json` を表示
- API設定時は `/search` エンドポイントから物件・ニュースを取得
- 画面上に「ローカルJSON / API接続中 / API取得失敗」の状態表示を追加
- `workers/property-search-worker.js` に検索APIの雛形を追加

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

## Cloudflare Workers 接続手順

### 1. Workersを作成

Cloudflare Dashboardで新しいWorkersを作成し、`workers/property-search-worker.js` の内容を貼り付けてデプロイします。

### 2. 動作確認

WorkersのURLが以下のような場合、

```text
https://home-select-search.example.workers.dev
```

以下を開いてJSONが返ることを確認します。

```text
https://home-select-search.example.workers.dev/health
https://home-select-search.example.workers.dev/search?area=all&layout=2&rent=10&walk=15&type=all&priority=balanced
```

### 3. `config.js` を更新

`config.js` の `apiEndpoint` にWorkers URLを入れます。

```js
window.HOME_SELECT_CONFIG = {
  apiEndpoint: "https://home-select-search.example.workers.dev"
};
```

### 4. GitHub Pagesで確認

サイト上部のステータスが「Cloudflare Workers API接続中」になれば接続成功です。

## 今後の予定

1. Cloudflare Workersを実際に公開
2. WorkersからUR・行政情報・検索APIを取得
3. 取得できる物件画像URLをカードに表示
4. 条件一致度スコアで上位10件を毎日表示
5. 新着物件や行政支援ニュースの通知機能を追加
