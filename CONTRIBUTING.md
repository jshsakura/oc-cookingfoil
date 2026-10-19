# Contributing

[English](#english) | [한국어](#한국어) | [日本語](#日本語) | [简体中文](#简体中文)

## English

Thanks for helping. Bug reports, fixes, translations and documentation are all welcome. For a larger change, please open an issue first so we can agree on the approach.

### Setup

Node.js 20 or newer is required (the Docker image and CI use Node 22).

```bash
git clone https://github.com/jshsakura/oc-cookingfoil.git
cd oc-cookingfoil
npm install
npm run hooks:install   # optional: the pre-commit check that mirrors CI
cp .env.example .env
sed -i "s|^COOK_SECRET_KEY=.*|COOK_SECRET_KEY=$(openssl rand -base64 32)|" .env
npm run dev             # http://localhost:3001
```

Reading names and icons out of packages needs `nstool`, `nsz` and your own `prod.keys`. The Docker image bundles the tools. Without them the server still runs and falls back to titledb and file names.

### Checks

Run these before you open a pull request. CI runs the same ones.

```bash
npm run lint
npm run test:unit
npx playwright install chromium   # once
npm run test:web
```

Add or update tests with every change in behaviour. Unit tests live in `test/unit/` (`node --test`), browser tests in `test/web/` (Playwright).

### Rules

- **Four languages.** Every string a user sees ships in English, Korean, Japanese and Simplified Chinese (`en`, `ko`, `ja`, `zh`) in the same change. The same goes for user-facing documents: `README.md` and its `README.ko.md`, `README.ja.md` and `README.zh-CN.md` keep the same sections in the same order.
- **Settings belong on the admin page.** A new setting gets a control on the admin page, is saved under `data/`, applies without a restart, and falls back to its environment variable. Document the variable in `.env.example`.
- **Nothing copyrighted.** Never add games, keys, firmware, BIOS files, RetroArch builds or artwork you have no right to share, not even in tests.
- **No private data.** Use `example.org` names and documentation addresses (`192.0.2.x`, `198.51.100.x`, `203.0.113.x`) in code, tests and docs.
- **Content caches key on something the content moves.** A cache of a file's hash or contents keys on a value that changes whenever the content does: ctime, or a hash of the content. Size and mtime alone are not enough, because a copy that overwrites in place keeps the inode and can put the mtime back.
- **Writing style.** Plain and precise. Do not join sentences with em dashes or en dashes. Korean text uses 합니다체, Japanese uses です/ます.

### Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`, `ci:`, then a short description of what changes for the user. English or Korean is fine. Keep one topic per pull request and fill in the template.

## 한국어

도와주셔서 고맙습니다. 버그 제보, 수정, 번역, 문서 모두 환영합니다. 큰 변경은 먼저 이슈를 열어 방향을 맞춰 주세요.

### 준비

Node.js 20 이상이 필요합니다(Docker 이미지와 CI 는 Node 22 를 씁니다).

```bash
git clone https://github.com/jshsakura/oc-cookingfoil.git
cd oc-cookingfoil
npm install
npm run hooks:install   # optional: the pre-commit check that mirrors CI
cp .env.example .env
sed -i "s|^COOK_SECRET_KEY=.*|COOK_SECRET_KEY=$(openssl rand -base64 32)|" .env
npm run dev             # http://localhost:3001
```

패키지에서 이름과 아이콘을 읽으려면 `nstool`, `nsz` 와 직접 가진 `prod.keys` 가 필요합니다. Docker 이미지에는 도구가 들어 있습니다. 없어도 서버는 돌고, titledb 와 파일 이름으로 대신합니다.

### 검사

풀 리퀘스트를 열기 전에 돌려 주세요. CI 도 같은 것을 돌립니다.

```bash
npm run lint
npm run test:unit
npx playwright install chromium   # once
npm run test:web
```

동작이 바뀌면 테스트도 함께 추가하거나 고칩니다. 단위 테스트는 `test/unit/`(`node --test`), 브라우저 테스트는 `test/web/`(Playwright)에 있습니다.

### 규칙

- **네 언어.** 사용자에게 보이는 문구는 같은 변경 안에서 영어, 한국어, 일본어, 중국어 간체(`en`, `ko`, `ja`, `zh`)로 모두 넣습니다. 사용자용 문서도 같습니다. `README.md` 와 `README.ko.md`, `README.ja.md`, `README.zh-CN.md` 는 같은 순서로 같은 절을 유지합니다.
- **설정은 관리 페이지에.** 새 설정은 관리 페이지에 조절 장치를 두고, `data/` 에 저장하며, 다시 띄우지 않아도 적용되고, 환경 변수를 기본값으로 씁니다. 그 변수는 `.env.example` 에 설명합니다.
- **저작물은 넣지 않습니다.** 게임, 키, 펌웨어, BIOS 파일, RetroArch 빌드, 공유할 권리가 없는 이미지는 테스트에도 넣지 않습니다.
- **개인 정보는 넣지 않습니다.** 코드, 테스트, 문서에는 `example.org` 이름과 문서용 주소(`192.0.2.x`, `198.51.100.x`, `203.0.113.x`)를 씁니다.
- **내용 캐시의 키는 내용이 바뀌면 반드시 바뀌는 값을 포함합니다.** 파일의 해시나 내용을 캐시할 때는 ctime 이나 내용 해시처럼 내용이 바뀌면 반드시 바뀌는 값을 키에 넣습니다. 크기와 mtime 만으로는 안 됩니다. 제자리에 덮어쓰는 복사는 inode 를 그대로 두고 mtime 을 되돌릴 수 있습니다.
- **문체.** 쉽고 정확하게 씁니다. 엠대시나 엔대시로 문장을 잇지 않습니다. 한국어는 합니다체, 일본어는 です/ます 로 씁니다.

### 커밋과 풀 리퀘스트

커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/) 를 따릅니다. `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`, `ci:` 뒤에 사용자에게 무엇이 바뀌는지 짧게 적습니다. 영어든 한국어든 괜찮습니다. 풀 리퀘스트 하나에는 주제 하나만 담고 양식을 채워 주세요.

## 日本語

ご協力ありがとうございます。バグ報告、修正、翻訳、ドキュメントのどれも歓迎します。大きな変更は、先に Issue を立てて方針を相談してください。

### 準備

Node.js 20 以上が必要です(Docker イメージと CI は Node 22 を使います)。

```bash
git clone https://github.com/jshsakura/oc-cookingfoil.git
cd oc-cookingfoil
npm install
npm run hooks:install   # optional: the pre-commit check that mirrors CI
cp .env.example .env
sed -i "s|^COOK_SECRET_KEY=.*|COOK_SECRET_KEY=$(openssl rand -base64 32)|" .env
npm run dev             # http://localhost:3001
```

パッケージから名前とアイコンを読むには `nstool`、`nsz` と自分で用意した `prod.keys` が必要です。Docker イメージにはツールが入っています。なくてもサーバーは動き、titledb とファイル名で代わりに表示します。

### チェック

プルリクエストを出す前に実行してください。CI も同じものを実行します。

```bash
npm run lint
npm run test:unit
npx playwright install chromium   # once
npm run test:web
```

動作を変えたらテストも追加または更新してください。単体テストは `test/unit/`(`node --test`)、ブラウザーテストは `test/web/`(Playwright)にあります。

### ルール

- **4 言語。** ユーザーに見える文字列は、同じ変更の中で英語、韓国語、日本語、簡体字中国語(`en`、`ko`、`ja`、`zh`)をすべて用意します。ユーザー向けのドキュメントも同じです。`README.md` と `README.ko.md`、`README.ja.md`、`README.zh-CN.md` は同じ順番で同じ節を保ちます。
- **設定は管理ページに。** 新しい設定は管理ページに操作を置き、`data/` に保存し、再起動なしで反映され、環境変数を既定値として使います。その変数は `.env.example` で説明します。
- **著作物は入れません。** ゲーム、キー、ファームウェア、BIOS ファイル、RetroArch のビルド、共有する権利のない画像は、テストにも入れません。
- **個人情報は入れません。** コード、テスト、ドキュメントでは `example.org` の名前とドキュメント用アドレス(`192.0.2.x`、`198.51.100.x`、`203.0.113.x`)を使います。
- **内容キャッシュのキーには、内容が変われば必ず変わる値を含めます。** ファイルのハッシュや内容をキャッシュするときは、ctime や内容のハッシュをキーに入れます。サイズと mtime だけでは足りません。その場で上書きするコピーは inode をそのまま残し、mtime を元に戻せるからです。
- **文体。** わかりやすく正確に書きます。エムダッシュやエンダッシュで文をつなぎません。韓国語は 합니다体、日本語は です/ます で書きます。

### コミットとプルリクエスト

コミットメッセージは [Conventional Commits](https://www.conventionalcommits.org/) に従います。`feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:`、`perf:`、`ci:` の後に、ユーザーにとって何が変わるかを短く書きます。英語でも韓国語でもかまいません。1 つのプルリクエストには 1 つの話題だけを入れ、テンプレートを埋めてください。

## 简体中文

感谢你的帮助。欢迎提交 Bug 报告、修复、翻译和文档。较大的改动请先开 Issue，商量好做法。

### 准备

需要 Node.js 20 或更高版本(Docker 镜像和 CI 使用 Node 22)。

```bash
git clone https://github.com/jshsakura/oc-cookingfoil.git
cd oc-cookingfoil
npm install
npm run hooks:install   # optional: the pre-commit check that mirrors CI
cp .env.example .env
sed -i "s|^COOK_SECRET_KEY=.*|COOK_SECRET_KEY=$(openssl rand -base64 32)|" .env
npm run dev             # http://localhost:3001
```

从安装包中读取名称和图标需要 `nstool`、`nsz` 以及你自己的 `prod.keys`。Docker 镜像已经包含这些工具。没有它们服务器也能运行，会改用 titledb 和文件名。

### 检查

提交拉取请求前请先运行以下命令。CI 也会运行同样的检查。

```bash
npm run lint
npm run test:unit
npx playwright install chromium   # once
npm run test:web
```

行为有变化时，请同时添加或更新测试。单元测试在 `test/unit/`(`node --test`)，浏览器测试在 `test/web/`(Playwright)。

### 规则

- **四种语言。** 用户能看到的每一段文字，都要在同一次改动中提供英语、韩语、日语和简体中文(`en`、`ko`、`ja`、`zh`)。面向用户的文档也一样：`README.md` 与 `README.ko.md`、`README.ja.md`、`README.zh-CN.md` 保持相同的章节和顺序。
- **设置放在管理页面。** 新设置要在管理页面有对应的控件，保存在 `data/` 下，无需重启即可生效，并以环境变量作为默认值。请在 `.env.example` 中说明该变量。
- **不放受版权保护的内容。** 不要加入游戏、密钥、固件、BIOS 文件、RetroArch 构建或你无权分享的图片，测试中也不行。
- **不放个人信息。** 代码、测试和文档中请使用 `example.org` 域名和文档专用地址(`192.0.2.x`、`198.51.100.x`、`203.0.113.x`)。
- **内容缓存的键必须包含内容一变就会变的值。** 缓存文件的哈希或内容时，键中要放 ctime 或内容哈希。只用大小和 mtime 不够，因为原地覆盖的复制会保留 inode，并可能把 mtime 改回去。
- **写作风格。** 简明准确。不要用破折号连接句子。韩语用 합니다体，日语用 です/ます。

### 提交与拉取请求

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)：`feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:`、`perf:`、`ci:`，后面简短说明对用户来说有什么变化。英语或韩语都可以。每个拉取请求只包含一个主题，并填写模板。
