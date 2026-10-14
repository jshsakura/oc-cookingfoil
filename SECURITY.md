# Security policy

[English](#english) | [한국어](#한국어) | [日本語](#日本語) | [简体中文](#简体中文)

## English

### Supported versions

Only the latest release (the `latest` image on `ghcr.io/jshsakura/oc-cookingfoil` and the `main` branch) receives security fixes. Please update before reporting.

### Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (<https://github.com/jshsakura/oc-cookingfoil/security/advisories/new>).

Include the version, how the server is set up (proxy, tunnel, which sign-in methods are on), the steps to reproduce, and what an attacker could do. Remove real addresses, accounts, keys and tokens from logs before you send them. You will get an answer as soon as possible, and a fix is released before the details are made public.

Out of scope: problems that need an attacker to already hold the admin session, an automation token or access to the `data/` folder, and reports about content that users put on their own servers.

## 한국어

### 지원하는 버전

보안 수정은 최신 릴리스(`ghcr.io/jshsakura/oc-cookingfoil` 의 `latest` 이미지와 `main` 브랜치)에만 들어갑니다. 제보하기 전에 먼저 업데이트해 주세요.

### 취약점 제보

공개 이슈로 올리지 말아 주세요. GitHub 로 비공개 제보를 합니다. 저장소의 **Security** 탭에서 **Report a vulnerability** 를 고릅니다 (<https://github.com/jshsakura/oc-cookingfoil/security/advisories/new>).

버전, 서버 구성(프록시, 터널, 켜 둔 로그인 방식), 재현 방법, 공격자가 할 수 있는 일을 적어 주세요. 로그를 보낼 때는 실제 주소, 계정, 키, 토큰을 지워 주세요. 가능한 한 빨리 답하고, 수정판을 낸 뒤에 자세한 내용을 공개합니다.

공격자가 이미 관리자 세션, 자동화 토큰, `data/` 폴더 접근을 가진 경우의 문제와, 사용자가 자기 서버에 올린 콘텐츠에 관한 제보는 대상이 아닙니다.

## 日本語

### サポートするバージョン

セキュリティ修正は最新リリース(`ghcr.io/jshsakura/oc-cookingfoil` の `latest` イメージと `main` ブランチ)にのみ入ります。報告の前に更新してください。

### 脆弱性の報告

公開の Issue には書かないでください。GitHub から非公開で報告します。リポジトリの **Security** タブで **Report a vulnerability** を選びます (<https://github.com/jshsakura/oc-cookingfoil/security/advisories/new>)。

バージョン、サーバーの構成(プロキシ、トンネル、有効にしているログイン方法)、再現手順、攻撃者にできることを書いてください。ログを送るときは実際のアドレス、アカウント、キー、トークンを消してください。できるだけ早く返信し、修正版を出してから詳細を公開します。

攻撃者がすでに管理者セッション、自動化トークン、`data/` フォルダーへのアクセスを持っている場合の問題と、ユーザーが自分のサーバーに置いたコンテンツについての報告は対象外です。

## 简体中文

### 支持的版本

安全修复只会进入最新版本(`ghcr.io/jshsakura/oc-cookingfoil` 的 `latest` 镜像和 `main` 分支)。报告前请先更新。

### 报告漏洞

请不要发公开 Issue。请通过 GitHub 私下报告：打开仓库的 **Security** 标签页，选择 **Report a vulnerability** (<https://github.com/jshsakura/oc-cookingfoil/security/advisories/new>)。

请写明版本、服务器的部署方式(代理、隧道、开启了哪些登录方式)、复现步骤，以及攻击者能做到什么。发送日志前请删除真实的地址、账号、密钥和令牌。我们会尽快回复，并在发布修复之后再公开细节。

以下不在范围内：攻击者已经持有管理员会话、自动化令牌或 `data/` 文件夹访问权限时的问题，以及关于用户放在自己服务器上的内容的报告。
