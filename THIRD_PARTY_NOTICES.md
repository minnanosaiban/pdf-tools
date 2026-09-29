# Third-party notices

## Bootstrap Icons

`public/index.html` / `public/app.js` に、いくつかのアイコンをSVGとして直接埋め込んでいます
（ファイル選択・ダウンロード・ページ削除・GitHubアイコン）。CDN読み込みやWebフォント同梱は行わず、
使用する数個分のSVGパスのみをソースにコピーしています。

- 出典: https://github.com/twbs/icons
- ライセンス: MIT License

```
The MIT License (MIT)

Copyright (c) 2019-2024 The Bootstrap Authors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## pdf.js

`public/vendor/pdfjs/pdf.min.js`・`public/vendor/pdfjs/pdf.worker.min.js`に、pdf.js（3.11.174）の
ビルド済みファイルをそのまま同梱しています。ページのサムネイル描画に使用しています。
2026-09、CDN読み込みからローカル同梱へ変更しました（ページを開く／PDFを読み込むたびに外部CDNへ
通信が飛ぶのを避けるため）。

- 出典: https://github.com/mozilla/pdf.js （npm: pdfjs-dist）
- ライセンス: Apache License 2.0（全文は `public/vendor/pdfjs/LICENSE`）

## pdf-lib

`public/vendor/pdf-lib/pdf-lib.min.js`に、pdf-lib（1.17.1）のビルド済みファイルをそのまま同梱しています。
PDFの読み込み・結合・保存に使用しています。2026-09、CDN読み込みからローカル同梱へ変更しました。

- 出典: https://github.com/Hopding/pdf-lib （npm: pdf-lib）
- ライセンス: MIT License（全文は `public/vendor/pdf-lib/LICENSE`）

## Google Fonts（手書き風文字追加）

`public/index.html` から Google Fonts の Yomogi・Klee One・Zen Kurenaido・Yusei Magic を読み込んでいます
（いずれも SIL Open Font License 1.1）。読み込むのはフォント定義のみで、PDFの内容は送信されません。
