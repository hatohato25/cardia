# cardia

トレーディングカード（マジック・ザ・ギャザリング / ポケモンカード）を iPhone のカメラで撮影し、OCR で認識したカード情報から晴れる屋・晴れる屋2の販売価格をリアルタイムに検索・表示する Web アプリです。

## 主な機能

- カメラでカードを撮影し、Google Cloud Vision API による OCR でカード名・セット略号・コレクター番号を自動認識
- 認識したカード情報から晴れる屋（MTG）/ 晴れる屋2（ポケモンカード）の販売価格を検索
- ショップ選択 UI（晴れる屋 / 晴れる屋2 をラジオボタンで選択）
- Upstash Redis による価格キャッシュ（TTL 24時間）でレスポンスを高速化
- 500ms間隔での自動キャプチャ→OCR→価格検索、価格タグのオーバーレイ表示

## 技術スタック

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS
- Web Worker + OffscreenCanvas（フレームキャプチャ）
- Google Cloud Vision API（TEXT_DETECTION、OCR）
- Cheerio（HTML/JSON解析）
- Upstash Redis（価格キャッシュ）
- ホスティング: Vercel

対応環境は iOS 16 以上の Chrome です（`getUserMedia`を利用するため HTTPS 必須）。Safari、デスクトップ Chrome や Android Chrome は動作すれば良い程度のデバッグ用途です。

## 利用方法（ローカル開発）

### 1. リポジトリのフォーク＆クローン

GitHub 上でリポジトリをフォークした後、手元にクローンします。

```bash
git clone https://github.com/<your-account>/cardia.git
cd cardia
```

### 2. 依存パッケージのインストール

```bash
npm install
```

### 3. 環境変数の設定

`.env.example` をコピーして `.env.local` を作成し、各値を埋めます。

```bash
cp .env.example .env.local
```

環境変数の取得方法は後述の「Google Cloud Vision API キーの取得方法」「Upstash Redis のセットアップ方法」を参照してください。

### 4. 開発サーバーの起動

```bash
npm run dev
```

起動後、`http://localhost:3000` にアクセスします。

> **注意**: カメラ機能（`getUserMedia`）はHTTPS環境でのみ動作します。ローカルの`http://localhost`は例外的に許可されますが、実機（iPhone）でカメラ機能を確認する場合はVercelのPreview URLなど、HTTPS環境でアクセスする必要があります。

## Google Cloud Vision API キーの取得方法

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成、または既存のプロジェクトを選択する
2. 「API とサービス」→「有効な API とサービス」から Cloud Vision API を有効化する
3. 「認証情報」タブから「認証情報を作成」→「API キー」を選択してキーを発行する
4. 発行したキーには用途制限（API 制限・アプリケーション制限）をかけることを推奨します
5. 発行したキーを`.env.local`の`GOOGLE_CLOUD_VISION_API_KEY`に設定する

## Upstash Redis のセットアップ方法（任意）

Upstash Redis は価格検索結果のキャッシュに使われますが、設定は必須ではありません。`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` を未設定のまま起動した場合、アプリはキャッシュを使わずに毎回晴れる屋 / 晴れる屋2へ直接価格を取得しにいく形で動作します（エラーにはなりません）。このセクションはスキップして構いません。

キャッシュを有効にしたい場合は以下の手順で設定します。

1. [upstash.com](https://upstash.com/) でアカウントを作成する
2. Redis データベースを作成する（無料プランで可）
3. データベース詳細ページの「REST API」セクションから、Endpoint（`UPSTASH_REDIS_REST_URL`）と Token（`UPSTASH_REDIS_REST_TOKEN`）をコピーし、`.env.local`に設定する

## リポジトリをフォークして Vercel でデプロイする方法

1. GitHub でリポジトリをフォークする
2. [Vercel](https://vercel.com/)にログインし、「New Project」からフォークしたリポジトリを Import する（Next.js は自動検出されます）
3. デプロイ前の設定画面で、Environment Variables に以下の4つの環境変数を追加する（Production / Preview 両方のスコープに設定することを推奨）
   - `GOOGLE_CLOUD_VISION_API_KEY`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `RATE_LIMIT_PER_MINUTE`（任意）
4. 「Deploy」をクリックしてデプロイする

デプロイ後は、main ブランチへのプッシュで自動的に本番デプロイが行われ、PR ごとに Preview デプロイが作成されます。

## 環境変数一覧

| 変数名 | 説明 | 必須/任意 |
|---|---|---|
| `GOOGLE_CLOUD_VISION_API_KEY` | GCP Vision API の API キー | 必須 |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis の REST API エンドポイント | 任意（未設定時はキャッシュ無効で動作） |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis の REST API トークン | 任意（未設定時はキャッシュ無効で動作） |
| `RATE_LIMIT_PER_MINUTE` | 1 分あたりのレート制限数（省略時デフォルト 60） | 任意 |

```bash
# GCP Vision API
GOOGLE_CLOUD_VISION_API_KEY=

# Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# レート制限設定（省略時はデフォルト値60を使用）
RATE_LIMIT_PER_MINUTE=60
```

## 注意事項

- GCP Vision API の無料枠は月 1,000ユ ニットです。超過した場合は課金が発生します
- Upstash Redis は任意設定です。未設定の場合はキャッシュを使わず毎回価格検索先へ直接アクセスするため、応答がやや遅くなる可能性があります。Upstash Redis Free プランを利用する場合は月 10,000コ マンドの制限があります
- HTTPS 必須のため、Vercel など HTTPS 環境でのみカメラ機能が動作します
- 個人利用・開発検証を想定しています。自己責任にてご利用ください
