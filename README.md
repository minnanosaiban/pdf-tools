# pdf-tools

PDFの加工を1つにまとめたブラウザ完結ツール（Cloudflare Pages・静的サイト）。旧 `pdf-redactor` / `pdf-metadata` / `pdf-merge` を統合し、デザインは `sidenote` のヒーロー＋ボタン切り替え構成を踏襲しています。

ヒーローの「機能」ボタン（sidenoteの「デザイン」ボタンと同じ位置・見た目）で4機能を切り替えます。選択は `#redact` `#hand` `#pages` `#meta` のURLハッシュと localStorage に保存されます。

| ボタン | 内容 | 実装 |
|---|---|---|
| 墨消し・検索 | 文字検索・ドラッグで墨消し枠→画像化して黒塗り | `public/redact.js`（旧 pdf-redactor） |
| 手書き風文字追加 | ページをクリックして手書き風書体の文字を配置（新規） | `public/hand.js` |
| 結合・分割・回転 | 結合・並べ替え・削除・回転・選択抽出・Nページごと分割 | `public/pages.js`（旧 pdf-merge＋新機能） |
| メタデータ編集削除 | 文書プロパティの編集・削除、フォルダ一覧編集 | `public/meta.js`（旧 pdf-metadata） |

共通処理は `public/common.js`（遅延描画ビューア `PageViewer` など）、切り替えは `public/app.js`。

## 手書き風文字追加について
- 書体は Google Fonts（Yomogi / Klee One / Zen Kurenaido / Yusei Magic）。読み込むのはフォント定義のみで、PDFは送信されません。
- 1文字ずつ位置・角度・大きさを少しずらして「手書き風」にしています（ゆらぎ・傾きはスライダー）。
- 保存時は文字を透明PNGにして元ページの上に重ねます（元PDFの内容は維持、追加文字は選択・検索不可）。回転ページにも対応。

## ローカル確認
```
cd public
python -m http.server 8765
```
デプロイは `deploy.bat`（初回は `npx wrangler pages project create pdf-tools`）。

旧3アプリのフォルダはそのまま残してあります（公開中のサイトを壊さないため）。統合版へ移行後に整理してください。
