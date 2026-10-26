/**
 * What the file check's labels say, and the help shown under them, in the
 * twelve languages the console and the admin page speak. integrity-help.js
 * picks one language and fills the numbers in.
 *
 * Per language:
 *   label   the card and list label per verdict ("damaged-maybe": a damage the
 *           console may still install, the hash mismatch)
 *   parts   a cnmt content type in words
 *   help    per reason: { title, body(params) }, body paragraphs split by "\n\n";
 *           params { p: percent there, parts: the parts in words, joined }
 */
export const INTEGRITY_WORDS = {
  ko: {
    label: { modified: "수정됨", damaged: "손상됨", "damaged-maybe": "손상 의심" },
    parts: { Meta: "설치 정보", Program: "게임 프로그램", Data: "데이터", Control: "이름과 아이콘 정보", HtmlDocument: "안내 문서", LegalInformation: "법적 고지", DeltaFragment: "업데이트 조각", unknown: "알 수 없는 부분" },
    help: {
      "signature-fail": {
        title: "수정된 파일입니다",
        body: () => "이 파일 안의 NCA 서명이 닌텐도가 만든 원본 서명과 맞지 않습니다. 한국어 패치를 넣었거나 변환 도구로 다시 묶은 파일에서 흔히 보입니다.\n\n손상과는 다릅니다. 내용이 빠지거나 깨진 것이 아니라, 원본과 다르게 서명돼 있다는 뜻입니다.\n\n대부분 그대로 설치됩니다. 설치가 서명 오류로 멈추면 설치 설정에서 서명 검사 무시를 켜고 다시 설치합니다. 이 설정은 설치 프로그램이 서명을 확인하지 않게 하므로 믿을 수 있는 파일에만 씁니다.",
      },
      truncated: {
        title: "파일이 잘렸습니다",
        body: ({ p, parts }) => `이 파일은 원래 크기의 ${p}%만 있습니다. 파일 안의 목록에는 있지만 실제로는 없는 부분이 있습니다. 빠진 부분은 ${parts}입니다.\n\n받다가 끊겼거나 복사 중에 멈춘 파일에서 생깁니다. 빠진 부분이 있어서 설치는 끝까지 되지 않습니다.\n\n받기와 설치를 시작할 수는 있지만 도중에 실패합니다. 서버 관리자에게 알려 주세요. 관리자가 온전한 파일로 바꾸면 다음 검사에서 라벨이 사라집니다.`,
      },
      "missing-content": {
        title: "내용 일부가 없습니다",
        body: ({ parts }) => `이 파일의 설치 정보에 적힌 내용 중 일부가 파일 안에 없습니다. 빠진 부분은 ${parts}입니다.\n\n파일을 다시 묶는 도중에 일부가 빠졌을 때 생깁니다. 빠진 부분이 있어서 설치는 끝까지 되지 않습니다.\n\n서버 관리자에게 알려 주세요. 관리자가 온전한 파일로 바꾸면 다음 검사에서 라벨이 사라집니다.`,
      },
      "hash-mismatch": {
        title: "내용이 원본과 다를 수 있습니다",
        body: ({ parts }) => `서명은 맞지만 내용의 해시가 설치 정보에 적힌 값과 다릅니다. 다른 부분은 ${parts}입니다. 저장 장치 오류나 복사 중 오류로 내용이 깨졌을 수 있습니다.\n\n설치는 될 수 있지만, 게임이 도중에 멈추거나 실행되지 않을 수 있습니다.\n\n문제가 생기면 서버 관리자에게 알려 주세요.`,
      },
      unreadable: {
        title: "파일을 읽지 못했습니다",
        body: () => "파일 안의 목록을 읽을 수 없습니다. 게임 파일이 아니거나 파일 앞부분이 깨졌습니다.\n\n이 파일은 설치되지 않습니다.\n\n서버 관리자에게 알려 주세요. 관리자가 온전한 파일로 바꾸면 다음 검사에서 라벨이 사라집니다.",
      },
    },
  },
  en: {
    label: { modified: "Modified", damaged: "Damaged", "damaged-maybe": "Possibly damaged" },
    parts: { Meta: "install information", Program: "game program", Data: "data", Control: "name and icon information", HtmlDocument: "manual", LegalInformation: "legal notice", DeltaFragment: "update fragment", unknown: "an unknown part" },
    help: {
      "signature-fail": {
        title: "This file has been modified",
        body: () => "An NCA signature in this file does not match the original signature made by Nintendo. This is common in files with a translation patch or files repacked by a conversion tool.\n\nThis is not damage. Nothing is missing or broken; the file is signed differently from the original.\n\nMost such files install as they are. If an install stops with a signature error, turn on Ignore signature check in the install settings and install again. That setting stops the installer from checking signatures, so use it only for files you trust.",
      },
      truncated: {
        title: "This file is cut short",
        body: ({ p, parts }) => `Only ${p}% of this file is there. Its file table lists parts that are not actually in it: ${parts}.\n\nThis happens when a download or a copy stopped partway. With parts missing, the install cannot finish.\n\nYou can start the download and the install, but they fail partway. Please tell the server's admin. Once the admin replaces it with a complete file, the label goes away at the next check.`,
      },
      "missing-content": {
        title: "Part of the content is missing",
        body: ({ parts }) => `Some of the content listed in this file's install information is not in the file: ${parts}.\n\nThis happens when part of a file was lost while it was repacked. With parts missing, the install cannot finish.\n\nPlease tell the server's admin. Once the admin replaces it with a complete file, the label goes away at the next check.`,
      },
      "hash-mismatch": {
        title: "The content may differ from the original",
        body: ({ parts }) => `The signature is fine, but the content's hash differs from the one in the install information (${parts}). A storage or copy error may have corrupted it.\n\nIt may install, but the game can stop partway or not start.\n\nIf you run into trouble, please tell the server's admin.`,
      },
      unreadable: {
        title: "This file could not be read",
        body: () => "The file table inside this file cannot be read. It is not a game file, or its beginning is broken.\n\nThis file does not install.\n\nPlease tell the server's admin. Once the admin replaces it with a complete file, the label goes away at the next check.",
      },
    },
  },
  ja: {
    label: { modified: "改変あり", damaged: "破損", "damaged-maybe": "破損の可能性" },
    parts: { Meta: "インストール情報", Program: "ゲームプログラム", Data: "データ", Control: "名前とアイコンの情報", HtmlDocument: "説明書", LegalInformation: "権利表記", DeltaFragment: "更新の断片", unknown: "不明な部分" },
    help: {
      "signature-fail": {
        title: "改変されたファイルです",
        body: () => "このファイル内の NCA 署名が、任天堂が作った元の署名と一致しません。翻訳パッチを入れたファイルや、変換ツールで作り直したファイルによく見られます。\n\n破損とは違います。内容が欠けたり壊れたりしているのではなく、元とは異なる署名がされているという意味です。\n\nほとんどはそのままインストールできます。署名エラーでインストールが止まった場合は、インストール設定で署名チェックを無視をオンにしてもう一度インストールします。この設定はインストーラーに署名を確認させないため、信頼できるファイルにだけ使います。",
      },
      truncated: {
        title: "ファイルが途中で切れています",
        body: ({ p, parts }) => `このファイルは本来の大きさの ${p}% しかありません。ファイル内の一覧にはあるのに、実際には入っていない部分があります。欠けている部分は ${parts} です。\n\nダウンロードやコピーが途中で止まったときに起こります。欠けた部分があるため、インストールは最後まで終わりません。\n\nダウンロードとインストールを始めることはできますが、途中で失敗します。サーバーの管理者に知らせてください。管理者が完全なファイルに差し替えると、次の検査でラベルが消えます。`,
      },
      "missing-content": {
        title: "内容の一部がありません",
        body: ({ parts }) => `このファイルのインストール情報にある内容の一部が、ファイルに入っていません。欠けている部分は ${parts} です。\n\nファイルを作り直す途中で一部が抜けたときに起こります。欠けた部分があるため、インストールは最後まで終わりません。\n\nサーバーの管理者に知らせてください。管理者が完全なファイルに差し替えると、次の検査でラベルが消えます。`,
      },
      "hash-mismatch": {
        title: "内容が元と異なる可能性があります",
        body: ({ parts }) => `署名は正しいものの、内容のハッシュがインストール情報の値と違います。違うのは ${parts} です。保存装置やコピーのエラーで内容が壊れた可能性があります。\n\nインストールはできる場合がありますが、ゲームが途中で止まったり起動しなかったりすることがあります。\n\n問題が起きたらサーバーの管理者に知らせてください。`,
      },
      unreadable: {
        title: "ファイルを読み取れませんでした",
        body: () => "ファイル内の一覧を読み取れません。ゲームファイルではないか、ファイルの先頭が壊れています。\n\nこのファイルはインストールできません。\n\nサーバーの管理者に知らせてください。管理者が完全なファイルに差し替えると、次の検査でラベルが消えます。",
      },
    },
  },
  zh: {
    label: { modified: "已修改", damaged: "已损坏", "damaged-maybe": "可能损坏" },
    parts: { Meta: "安装信息", Program: "游戏程序", Data: "数据", Control: "名称与图标信息", HtmlDocument: "说明文档", LegalInformation: "法律声明", DeltaFragment: "更新片段", unknown: "未知部分" },
    help: {
      "signature-fail": {
        title: "这是已修改的文件",
        body: () => "此文件中的 NCA 签名与任天堂制作的原始签名不一致。打过汉化补丁或用转换工具重新打包的文件常见这种情况。\n\n这不是损坏。内容没有缺失或损坏，只是签名与原始文件不同。\n\n大多数可以直接安装。如果安装因签名错误而停止，请在安装设置中打开忽略签名检查后重新安装。此设置会让安装程序不检查签名，请只对可信的文件使用。",
      },
      truncated: {
        title: "文件被截断",
        body: ({ p, parts }) => `此文件只有原始大小的 ${p}%。文件内的列表中有、但实际上不存在的部分：${parts}。\n\n下载或复制中途停止时会出现这种情况。由于缺少部分内容，安装无法完成。\n\n可以开始下载和安装，但会在中途失败。请告知服务器管理员。管理员换成完整文件后，下次检查时标签会消失。`,
      },
      "missing-content": {
        title: "缺少部分内容",
        body: ({ parts }) => `此文件安装信息中列出的部分内容不在文件中：${parts}。\n\n重新打包文件时丢失了一部分就会出现这种情况。由于缺少部分内容，安装无法完成。\n\n请告知服务器管理员。管理员换成完整文件后，下次检查时标签会消失。`,
      },
      "hash-mismatch": {
        title: "内容可能与原始文件不同",
        body: ({ parts }) => `签名正确，但内容的哈希值与安装信息中的值不同（${parts}）。可能是存储设备或复制错误导致内容损坏。\n\n也许可以安装，但游戏可能中途停止或无法启动。\n\n如果遇到问题，请告知服务器管理员。`,
      },
      unreadable: {
        title: "无法读取文件",
        body: () => "无法读取文件内的列表。它不是游戏文件，或文件开头已损坏。\n\n此文件无法安装。\n\n请告知服务器管理员。管理员换成完整文件后，下次检查时标签会消失。",
      },
    },
  },
  "zh-Hant": {
    label: { modified: "已修改", damaged: "已損壞", "damaged-maybe": "可能損壞" },
    parts: { Meta: "安裝資訊", Program: "遊戲程式", Data: "資料", Control: "名稱與圖示資訊", HtmlDocument: "說明文件", LegalInformation: "法律聲明", DeltaFragment: "更新片段", unknown: "未知部分" },
    help: {
      "signature-fail": {
        title: "這是已修改的檔案",
        body: () => "此檔案中的 NCA 簽章與任天堂製作的原始簽章不一致。加過中文化修正檔或用轉換工具重新封裝的檔案常見這種情況。\n\n這不是損壞。內容沒有缺少或損壞，只是簽章與原始檔案不同。\n\n大多數可以直接安裝。如果安裝因簽章錯誤而停止，請在安裝設定中開啟忽略簽章檢查後重新安裝。此設定會讓安裝程式不檢查簽章，請只對可信任的檔案使用。",
      },
      truncated: {
        title: "檔案被截斷",
        body: ({ p, parts }) => `此檔案只有原始大小的 ${p}%。檔案內的清單中有、但實際上不存在的部分：${parts}。\n\n下載或複製中途停止時會出現這種情況。由於缺少部分內容，安裝無法完成。\n\n可以開始下載和安裝，但會在中途失敗。請告知伺服器管理員。管理員換成完整檔案後，下次檢查時標籤會消失。`,
      },
      "missing-content": {
        title: "缺少部分內容",
        body: ({ parts }) => `此檔案安裝資訊中列出的部分內容不在檔案中：${parts}。\n\n重新封裝檔案時遺失了一部分就會出現這種情況。由於缺少部分內容，安裝無法完成。\n\n請告知伺服器管理員。管理員換成完整檔案後，下次檢查時標籤會消失。`,
      },
      "hash-mismatch": {
        title: "內容可能與原始檔案不同",
        body: ({ parts }) => `簽章正確，但內容的雜湊值與安裝資訊中的值不同（${parts}）。可能是儲存裝置或複製錯誤導致內容損壞。\n\n也許可以安裝，但遊戲可能中途停止或無法啟動。\n\n如果遇到問題，請告知伺服器管理員。`,
      },
      unreadable: {
        title: "無法讀取檔案",
        body: () => "無法讀取檔案內的清單。它不是遊戲檔案，或檔案開頭已損壞。\n\n此檔案無法安裝。\n\n請告知伺服器管理員。管理員換成完整檔案後，下次檢查時標籤會消失。",
      },
    },
  },
  es: {
    label: { modified: "Modificado", damaged: "Dañado", "damaged-maybe": "Posiblemente dañado" },
    parts: { Meta: "información de instalación", Program: "programa del juego", Data: "datos", Control: "información de nombre e icono", HtmlDocument: "manual", LegalInformation: "aviso legal", DeltaFragment: "fragmento de actualización", unknown: "una parte desconocida" },
    help: {
      "signature-fail": {
        title: "Este archivo está modificado",
        body: () => "Una firma NCA de este archivo no coincide con la firma original de Nintendo. Es habitual en archivos con un parche de traducción o reempaquetados con una herramienta de conversión.\n\nNo es un daño. No falta ni está roto nada; el archivo está firmado de forma distinta al original.\n\nLa mayoría se instalan tal cual. Si la instalación se detiene con un error de firma, activa Ignorar comprobación de firma en los ajustes de instalación e instala de nuevo. Ese ajuste hace que el instalador no compruebe las firmas, así que úsalo solo con archivos de confianza.",
      },
      truncated: {
        title: "Este archivo está cortado",
        body: ({ p, parts }) => `Solo está el ${p}% de este archivo. Su tabla de archivos incluye partes que en realidad no están: ${parts}.\n\nOcurre cuando una descarga o una copia se detuvo a medias. Al faltar partes, la instalación no puede terminar.\n\nPuedes empezar la descarga y la instalación, pero fallarán a medias. Avisa al administrador del servidor. Cuando lo sustituya por un archivo completo, la etiqueta desaparecerá en la siguiente comprobación.`,
      },
      "missing-content": {
        title: "Falta parte del contenido",
        body: ({ parts }) => `Parte del contenido que figura en la información de instalación no está en el archivo: ${parts}.\n\nOcurre cuando se perdió una parte al reempaquetar el archivo. Al faltar partes, la instalación no puede terminar.\n\nAvisa al administrador del servidor. Cuando lo sustituya por un archivo completo, la etiqueta desaparecerá en la siguiente comprobación.`,
      },
      "hash-mismatch": {
        title: "El contenido puede ser distinto del original",
        body: ({ parts }) => `La firma es correcta, pero el hash del contenido no coincide con el de la información de instalación (${parts}). Un error de almacenamiento o de copia puede haberlo dañado.\n\nPuede que se instale, pero el juego podría detenerse a medias o no arrancar.\n\nSi tienes problemas, avisa al administrador del servidor.`,
      },
      unreadable: {
        title: "No se pudo leer este archivo",
        body: () => "No se puede leer la tabla de archivos que contiene. No es un archivo de juego o su principio está roto.\n\nEste archivo no se instala.\n\nAvisa al administrador del servidor. Cuando lo sustituya por un archivo completo, la etiqueta desaparecerá en la siguiente comprobación.",
      },
    },
  },
  fr: {
    label: { modified: "Modifié", damaged: "Endommagé", "damaged-maybe": "Peut-être endommagé" },
    parts: { Meta: "informations d'installation", Program: "programme du jeu", Data: "données", Control: "informations de nom et d'icône", HtmlDocument: "manuel", LegalInformation: "mentions légales", DeltaFragment: "fragment de mise à jour", unknown: "une partie inconnue" },
    help: {
      "signature-fail": {
        title: "Ce fichier a été modifié",
        body: () => "Une signature NCA de ce fichier ne correspond pas à la signature d'origine de Nintendo. C'est courant pour les fichiers avec un patch de traduction ou réempaquetés par un outil de conversion.\n\nCe n'est pas un dommage. Rien ne manque ni n'est cassé ; le fichier est simplement signé autrement que l'original.\n\nLa plupart s'installent tels quels. Si l'installation s'arrête sur une erreur de signature, activez Ignorer la vérification de signature dans les réglages d'installation et réinstallez. Ce réglage empêche l'installateur de vérifier les signatures : utilisez-le seulement pour des fichiers de confiance.",
      },
      truncated: {
        title: "Ce fichier est tronqué",
        body: ({ p, parts }) => `Seuls ${p} % de ce fichier sont présents. Sa table de fichiers liste des parties qui n'y sont pas : ${parts}.\n\nCela arrive quand un téléchargement ou une copie s'est arrêté en cours. Comme des parties manquent, l'installation ne peut pas aller au bout.\n\nVous pouvez lancer le téléchargement et l'installation, mais ils échoueront en cours. Prévenez l'administrateur du serveur. Une fois le fichier remplacé par un fichier complet, l'étiquette disparaît à la vérification suivante.`,
      },
      "missing-content": {
        title: "Une partie du contenu manque",
        body: ({ parts }) => `Une partie du contenu listé dans les informations d'installation n'est pas dans le fichier : ${parts}.\n\nCela arrive quand une partie s'est perdue pendant le réempaquetage. Comme des parties manquent, l'installation ne peut pas aller au bout.\n\nPrévenez l'administrateur du serveur. Une fois le fichier remplacé par un fichier complet, l'étiquette disparaît à la vérification suivante.`,
      },
      "hash-mismatch": {
        title: "Le contenu diffère peut-être de l'original",
        body: ({ parts }) => `La signature est correcte, mais l'empreinte du contenu ne correspond pas à celle des informations d'installation (${parts}). Une erreur de stockage ou de copie a pu l'endommager.\n\nL'installation peut réussir, mais le jeu risque de s'arrêter en cours ou de ne pas démarrer.\n\nEn cas de problème, prévenez l'administrateur du serveur.`,
      },
      unreadable: {
        title: "Ce fichier n'a pas pu être lu",
        body: () => "La table de fichiers qu'il contient est illisible. Ce n'est pas un fichier de jeu, ou son début est cassé.\n\nCe fichier ne s'installe pas.\n\nPrévenez l'administrateur du serveur. Une fois le fichier remplacé par un fichier complet, l'étiquette disparaît à la vérification suivante.",
      },
    },
  },
  de: {
    label: { modified: "Verändert", damaged: "Beschädigt", "damaged-maybe": "Möglicherweise beschädigt" },
    parts: { Meta: "Installationsinformationen", Program: "Spielprogramm", Data: "Daten", Control: "Namens- und Symbolinformationen", HtmlDocument: "Handbuch", LegalInformation: "rechtliche Hinweise", DeltaFragment: "Update-Fragment", unknown: "ein unbekannter Teil" },
    help: {
      "signature-fail": {
        title: "Diese Datei wurde verändert",
        body: () => "Eine NCA-Signatur in dieser Datei stimmt nicht mit der Originalsignatur von Nintendo überein. Das ist üblich bei Dateien mit einem Übersetzungspatch oder bei Dateien, die ein Konvertierungswerkzeug neu gepackt hat.\n\nDas ist kein Schaden. Es fehlt nichts und nichts ist kaputt; die Datei ist nur anders signiert als das Original.\n\nDie meisten lassen sich so installieren. Bricht die Installation mit einem Signaturfehler ab, schalte in den Installationseinstellungen Signaturprüfung ignorieren ein und installiere erneut. Diese Einstellung lässt den Installer keine Signaturen prüfen, nutze sie also nur für Dateien, denen du vertraust.",
      },
      truncated: {
        title: "Diese Datei ist abgeschnitten",
        body: ({ p, parts }) => `Von dieser Datei sind nur ${p} % vorhanden. Ihre Dateitabelle nennt Teile, die nicht darin sind: ${parts}.\n\nDas passiert, wenn ein Download oder eine Kopie mittendrin abgebrochen ist. Weil Teile fehlen, kann die Installation nicht abgeschlossen werden.\n\nDownload und Installation lassen sich starten, scheitern aber mittendrin. Bitte sag dem Administrator des Servers Bescheid. Sobald er sie durch eine vollständige Datei ersetzt, verschwindet die Kennzeichnung bei der nächsten Prüfung.`,
      },
      "missing-content": {
        title: "Ein Teil des Inhalts fehlt",
        body: ({ parts }) => `Ein Teil des Inhalts aus den Installationsinformationen ist nicht in der Datei: ${parts}.\n\nDas passiert, wenn beim Neupacken ein Teil verloren ging. Weil Teile fehlen, kann die Installation nicht abgeschlossen werden.\n\nBitte sag dem Administrator des Servers Bescheid. Sobald er sie durch eine vollständige Datei ersetzt, verschwindet die Kennzeichnung bei der nächsten Prüfung.`,
      },
      "hash-mismatch": {
        title: "Der Inhalt weicht möglicherweise vom Original ab",
        body: ({ parts }) => `Die Signatur stimmt, aber der Hash des Inhalts weicht von dem in den Installationsinformationen ab (${parts}). Ein Speicher- oder Kopierfehler kann ihn beschädigt haben.\n\nDie Installation kann gelingen, aber das Spiel kann mittendrin anhalten oder gar nicht starten.\n\nWenn Probleme auftreten, sag bitte dem Administrator des Servers Bescheid.`,
      },
      unreadable: {
        title: "Diese Datei konnte nicht gelesen werden",
        body: () => "Die Dateitabelle darin ist nicht lesbar. Es ist keine Spieldatei, oder ihr Anfang ist beschädigt.\n\nDiese Datei lässt sich nicht installieren.\n\nBitte sag dem Administrator des Servers Bescheid. Sobald er sie durch eine vollständige Datei ersetzt, verschwindet die Kennzeichnung bei der nächsten Prüfung.",
      },
    },
  },
  it: {
    label: { modified: "Modificato", damaged: "Danneggiato", "damaged-maybe": "Forse danneggiato" },
    parts: { Meta: "informazioni di installazione", Program: "programma del gioco", Data: "dati", Control: "informazioni su nome e icona", HtmlDocument: "manuale", LegalInformation: "note legali", DeltaFragment: "frammento di aggiornamento", unknown: "una parte sconosciuta" },
    help: {
      "signature-fail": {
        title: "Questo file è stato modificato",
        body: () => "Una firma NCA in questo file non corrisponde alla firma originale di Nintendo. Succede spesso con file che hanno una patch di traduzione o che sono stati riconfezionati da uno strumento di conversione.\n\nNon è un danno. Non manca nulla e nulla è rotto; il file è solo firmato in modo diverso dall'originale.\n\nLa maggior parte si installa così com'è. Se l'installazione si ferma con un errore di firma, attiva Ignora controllo firma nelle impostazioni di installazione e installa di nuovo. Questa impostazione fa sì che l'installer non controlli le firme, quindi usala solo per file di cui ti fidi.",
      },
      truncated: {
        title: "Questo file è troncato",
        body: ({ p, parts }) => `Di questo file c'è solo il ${p}%. La sua tabella dei file elenca parti che in realtà non ci sono: ${parts}.\n\nSuccede quando un download o una copia si è interrotto a metà. Mancando delle parti, l'installazione non può terminare.\n\nPuoi avviare il download e l'installazione, ma falliranno a metà. Avvisa l'amministratore del server. Quando lo sostituirà con un file completo, l'etichetta sparirà al controllo successivo.`,
      },
      "missing-content": {
        title: "Manca una parte del contenuto",
        body: ({ parts }) => `Parte del contenuto elencato nelle informazioni di installazione non è nel file: ${parts}.\n\nSuccede quando una parte è andata persa durante il riconfezionamento. Mancando delle parti, l'installazione non può terminare.\n\nAvvisa l'amministratore del server. Quando lo sostituirà con un file completo, l'etichetta sparirà al controllo successivo.`,
      },
      "hash-mismatch": {
        title: "Il contenuto potrebbe essere diverso dall'originale",
        body: ({ parts }) => `La firma è corretta, ma l'hash del contenuto non corrisponde a quello delle informazioni di installazione (${parts}). Un errore di archiviazione o di copia potrebbe averlo danneggiato.\n\nPotrebbe installarsi, ma il gioco potrebbe fermarsi a metà o non avviarsi.\n\nSe hai problemi, avvisa l'amministratore del server.`,
      },
      unreadable: {
        title: "Impossibile leggere questo file",
        body: () => "La tabella dei file al suo interno non è leggibile. Non è un file di gioco, oppure il suo inizio è rovinato.\n\nQuesto file non si installa.\n\nAvvisa l'amministratore del server. Quando lo sostituirà con un file completo, l'etichetta sparirà al controllo successivo.",
      },
    },
  },
  pt: {
    label: { modified: "Modificado", damaged: "Danificado", "damaged-maybe": "Possivelmente danificado" },
    parts: { Meta: "informações de instalação", Program: "programa do jogo", Data: "dados", Control: "informações de nome e ícone", HtmlDocument: "manual", LegalInformation: "aviso legal", DeltaFragment: "fragmento de atualização", unknown: "uma parte desconhecida" },
    help: {
      "signature-fail": {
        title: "Este arquivo foi modificado",
        body: () => "Uma assinatura NCA deste arquivo não confere com a assinatura original da Nintendo. Isso é comum em arquivos com patch de tradução ou reempacotados por uma ferramenta de conversão.\n\nIsso não é dano. Nada está faltando ou quebrado; o arquivo só foi assinado de forma diferente do original.\n\nA maioria instala normalmente. Se a instalação parar com um erro de assinatura, ative Ignorar verificação de assinatura nas configurações de instalação e instale de novo. Essa opção faz o instalador não verificar assinaturas, então use-a só com arquivos em que você confia.",
      },
      truncated: {
        title: "Este arquivo está cortado",
        body: ({ p, parts }) => `Só ${p}% deste arquivo está presente. A tabela de arquivos dele lista partes que não estão nele: ${parts}.\n\nIsso acontece quando um download ou uma cópia parou no meio. Com partes faltando, a instalação não consegue terminar.\n\nVocê pode começar o download e a instalação, mas eles falham no meio. Avise o administrador do servidor. Quando ele trocar por um arquivo completo, o rótulo some na próxima verificação.`,
      },
      "missing-content": {
        title: "Falta parte do conteúdo",
        body: ({ parts }) => `Parte do conteúdo listado nas informações de instalação não está no arquivo: ${parts}.\n\nIsso acontece quando uma parte se perdeu ao reempacotar o arquivo. Com partes faltando, a instalação não consegue terminar.\n\nAvise o administrador do servidor. Quando ele trocar por um arquivo completo, o rótulo some na próxima verificação.`,
      },
      "hash-mismatch": {
        title: "O conteúdo pode ser diferente do original",
        body: ({ parts }) => `A assinatura confere, mas o hash do conteúdo é diferente do que está nas informações de instalação (${parts}). Um erro de armazenamento ou de cópia pode tê-lo danificado.\n\nTalvez instale, mas o jogo pode parar no meio ou não abrir.\n\nSe tiver problemas, avise o administrador do servidor.`,
      },
      unreadable: {
        title: "Não foi possível ler este arquivo",
        body: () => "A tabela de arquivos dentro dele não pode ser lida. Não é um arquivo de jogo, ou o começo dele está quebrado.\n\nEste arquivo não instala.\n\nAvise o administrador do servidor. Quando ele trocar por um arquivo completo, o rótulo some na próxima verificação.",
      },
    },
  },
  nl: {
    label: { modified: "Aangepast", damaged: "Beschadigd", "damaged-maybe": "Mogelijk beschadigd" },
    parts: { Meta: "installatiegegevens", Program: "spelprogramma", Data: "gegevens", Control: "naam- en pictogramgegevens", HtmlDocument: "handleiding", LegalInformation: "juridische vermelding", DeltaFragment: "updatefragment", unknown: "een onbekend deel" },
    help: {
      "signature-fail": {
        title: "Dit bestand is aangepast",
        body: () => "Een NCA-handtekening in dit bestand komt niet overeen met de originele handtekening van Nintendo. Dat is gebruikelijk bij bestanden met een vertaalpatch of bestanden die een conversietool opnieuw heeft verpakt.\n\nDit is geen schade. Er ontbreekt niets en er is niets kapot; het bestand is alleen anders ondertekend dan het origineel.\n\nDe meeste installeren gewoon. Stopt de installatie met een handtekeningfout, zet dan Handtekeningcontrole negeren aan in de installatie-instellingen en installeer opnieuw. Die instelling laat het installatieprogramma geen handtekeningen controleren, gebruik haar dus alleen voor bestanden die je vertrouwt.",
      },
      truncated: {
        title: "Dit bestand is afgekapt",
        body: ({ p, parts }) => `Van dit bestand is maar ${p}% aanwezig. De bestandstabel noemt delen die er niet in zitten: ${parts}.\n\nDit gebeurt als een download of kopie halverwege stopte. Omdat er delen ontbreken, kan de installatie niet afronden.\n\nJe kunt de download en de installatie starten, maar ze mislukken halverwege. Laat het de beheerder van de server weten. Zodra die het vervangt door een volledig bestand, verdwijnt het label bij de volgende controle.`,
      },
      "missing-content": {
        title: "Een deel van de inhoud ontbreekt",
        body: ({ parts }) => `Een deel van de inhoud uit de installatiegegevens zit niet in het bestand: ${parts}.\n\nDit gebeurt als er bij het opnieuw verpakken een deel verloren ging. Omdat er delen ontbreken, kan de installatie niet afronden.\n\nLaat het de beheerder van de server weten. Zodra die het vervangt door een volledig bestand, verdwijnt het label bij de volgende controle.`,
      },
      "hash-mismatch": {
        title: "De inhoud wijkt mogelijk af van het origineel",
        body: ({ parts }) => `De handtekening klopt, maar de hash van de inhoud wijkt af van die in de installatiegegevens (${parts}). Een opslag- of kopieerfout kan de inhoud hebben beschadigd.\n\nInstalleren kan lukken, maar het spel kan halverwege stoppen of niet starten.\n\nLaat het bij problemen de beheerder van de server weten.`,
      },
      unreadable: {
        title: "Dit bestand kon niet worden gelezen",
        body: () => "De bestandstabel erin is niet leesbaar. Het is geen spelbestand, of het begin ervan is kapot.\n\nDit bestand installeert niet.\n\nLaat het de beheerder van de server weten. Zodra die het vervangt door een volledig bestand, verdwijnt het label bij de volgende controle.",
      },
    },
  },
  ru: {
    label: { modified: "Изменён", damaged: "Повреждён", "damaged-maybe": "Возможно повреждён" },
    parts: { Meta: "сведения для установки", Program: "программа игры", Data: "данные", Control: "сведения о названии и значке", HtmlDocument: "руководство", LegalInformation: "правовая информация", DeltaFragment: "фрагмент обновления", unknown: "неизвестная часть" },
    help: {
      "signature-fail": {
        title: "Этот файл изменён",
        body: () => "Подпись NCA в этом файле не совпадает с оригинальной подписью Nintendo. Так часто бывает с файлами, в которые добавлен патч перевода, или с файлами, перепакованными программой-конвертером.\n\nЭто не повреждение. Ничего не пропало и не сломано, просто файл подписан не так, как оригинал.\n\nБольшинство таких файлов устанавливаются как есть. Если установка останавливается с ошибкой подписи, включите «Игнорировать проверку подписи» в настройках установки и установите снова. С этой настройкой установщик не проверяет подписи, поэтому используйте её только для файлов, которым доверяете.",
      },
      truncated: {
        title: "Этот файл обрезан",
        body: ({ p, parts }) => `От этого файла есть только ${p}%. В его таблице файлов перечислены части, которых в нём нет: ${parts}.\n\nТак бывает, когда загрузка или копирование прервались на середине. Без недостающих частей установка не может завершиться.\n\nЗагрузку и установку можно начать, но они прервутся на середине. Сообщите администратору сервера. Когда он заменит файл на полный, метка исчезнет при следующей проверке.`,
      },
      "missing-content": {
        title: "Часть содержимого отсутствует",
        body: ({ parts }) => `Часть содержимого из сведений для установки отсутствует в файле: ${parts}.\n\nТак бывает, когда при перепаковке часть файла потерялась. Без недостающих частей установка не может завершиться.\n\nСообщите администратору сервера. Когда он заменит файл на полный, метка исчезнет при следующей проверке.`,
      },
      "hash-mismatch": {
        title: "Содержимое может отличаться от оригинала",
        body: ({ parts }) => `Подпись верна, но хеш содержимого отличается от указанного в сведениях для установки (${parts}). Его могла повредить ошибка накопителя или копирования.\n\nУстановка может пройти, но игра может остановиться на середине или не запуститься.\n\nЕсли возникнут проблемы, сообщите администратору сервера.`,
      },
      unreadable: {
        title: "Не удалось прочитать этот файл",
        body: () => "Таблицу файлов внутри не удаётся прочитать. Это не файл игры, или его начало повреждено.\n\nЭтот файл не устанавливается.\n\nСообщите администратору сервера. Когда он заменит файл на полный, метка исчезнет при следующей проверке.",
      },
    },
  },
};
