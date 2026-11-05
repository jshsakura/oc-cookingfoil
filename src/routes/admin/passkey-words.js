/**
 * Passkeys on the admin page (the 관리자 보안 page's list and the admin check's button) in all
 * twelve admin languages. Korean is the source of truth.
 */
const KEYS = [
  "pk.title", "pk.signIn", "pk.add", "pk.none", "pk.added", "pk.removed", "pk.removeAsk", "pk.cancelled",
  "pk.unknown", "pk.insecure", "pk.unsupported", "pk.lastUsed", "pk.failed", "pk.limit",
];

const ROWS = {
  ko: [
    "패스키", "패스키로 로그인", "패스키 추가", "등록한 패스키가 없습니다.", "패스키를 추가했습니다.", "패스키를 지웠습니다.",
    "이 패스키를 지울까요? 이 기기로는 더 이상 로그인할 수 없습니다.", "패스키 로그인이 취소됐습니다.",
    "등록되지 않은 패스키입니다.", "이 주소에서는 패스키를 쓸 수 없습니다. HTTPS 주소로 접속해야 합니다.", "이 브라우저는 패스키를 지원하지 않습니다.",
    "마지막 사용: {date}", "패스키를 확인하지 못했습니다. 다시 시도합니다.", "패스키는 {n}개까지 추가할 수 있습니다.",
  ],
  en: [
    "Passkeys", "Sign in with a passkey", "Add a passkey", "No passkeys yet.", "Passkey added.", "Passkey removed.",
    "Remove this passkey? You will no longer be able to sign in with it on this device.", "Passkey sign-in was cancelled.",
    "This passkey is not registered.", "Passkeys can't be used at this address. Open the server over HTTPS.", "This browser doesn't support passkeys.",
    "Last used: {date}", "The passkey could not be checked. Please try again.", "Up to {n} passkeys can be added.",
  ],
  ja: [
    "パスキー", "パスキーでログイン", "パスキーを追加", "登録したパスキーはありません。", "パスキーを追加しました。", "パスキーを削除しました。",
    "このパスキーを削除しますか？このデバイスではログインできなくなります。", "パスキーでのログインがキャンセルされました。",
    "登録されていないパスキーです。", "このアドレスではパスキーを使えません。HTTPS のアドレスで接続してください。", "このブラウザはパスキーに対応していません。",
    "最終使用: {date}", "パスキーを確認できませんでした。もう一度お試しください。", "パスキーは {n} 個まで追加できます。",
  ],
  zh: [
    "通行密钥", "使用通行密钥登录", "添加通行密钥", "还没有注册通行密钥。", "已添加通行密钥。", "已删除通行密钥。",
    "要删除这个通行密钥吗？此设备将无法再用它登录。", "已取消通行密钥登录。",
    "这个通行密钥未注册。", "此地址无法使用通行密钥。请通过 HTTPS 地址访问。", "此浏览器不支持通行密钥。",
    "上次使用：{date}", "无法验证通行密钥，请重试。", "最多可以添加 {n} 个通行密钥。",
  ],
  "zh-Hant": [
    "密碼金鑰", "使用密碼金鑰登入", "新增密碼金鑰", "尚未註冊密碼金鑰。", "已新增密碼金鑰。", "已刪除密碼金鑰。",
    "要刪除這個密碼金鑰嗎？此裝置將無法再用它登入。", "已取消密碼金鑰登入。",
    "這個密碼金鑰未註冊。", "此位址無法使用密碼金鑰。請透過 HTTPS 位址連線。", "此瀏覽器不支援密碼金鑰。",
    "上次使用：{date}", "無法驗證密碼金鑰，請再試一次。", "最多可以新增 {n} 個密碼金鑰。",
  ],
  es: [
    "Llaves de acceso", "Iniciar sesión con una llave de acceso", "Añadir una llave de acceso", "Aún no hay llaves de acceso.", "Llave de acceso añadida.", "Llave de acceso eliminada.",
    "¿Eliminar esta llave de acceso? Ya no podrás iniciar sesión con ella en este dispositivo.", "Se canceló el inicio de sesión con llave de acceso.",
    "Esta llave de acceso no está registrada.", "Las llaves de acceso no funcionan en esta dirección. Abre el servidor por HTTPS.", "Este navegador no admite llaves de acceso.",
    "Último uso: {date}", "No se pudo comprobar la llave de acceso. Inténtalo de nuevo.", "Se pueden añadir hasta {n} llaves de acceso.",
  ],
  fr: [
    "Clés d'accès", "Se connecter avec une clé d'accès", "Ajouter une clé d'accès", "Aucune clé d'accès pour l'instant.", "Clé d'accès ajoutée.", "Clé d'accès supprimée.",
    "Supprimer cette clé d'accès ? Vous ne pourrez plus vous connecter avec elle sur cet appareil.", "La connexion par clé d'accès a été annulée.",
    "Cette clé d'accès n'est pas enregistrée.", "Les clés d'accès ne fonctionnent pas à cette adresse. Ouvrez le serveur en HTTPS.", "Ce navigateur ne prend pas en charge les clés d'accès.",
    "Dernière utilisation : {date}", "La clé d'accès n'a pas pu être vérifiée. Réessayez.", "Jusqu'à {n} clés d'accès peuvent être ajoutées.",
  ],
  de: [
    "Passkeys", "Mit Passkey anmelden", "Passkey hinzufügen", "Noch keine Passkeys.", "Passkey hinzugefügt.", "Passkey entfernt.",
    "Diesen Passkey entfernen? Mit ihm ist auf diesem Gerät keine Anmeldung mehr möglich.", "Die Anmeldung mit Passkey wurde abgebrochen.",
    "Dieser Passkey ist nicht registriert.", "Unter dieser Adresse funktionieren Passkeys nicht. Öffnen Sie den Server über HTTPS.", "Dieser Browser unterstützt keine Passkeys.",
    "Zuletzt verwendet: {date}", "Der Passkey konnte nicht geprüft werden. Bitte erneut versuchen.", "Es können bis zu {n} Passkeys hinzugefügt werden.",
  ],
  it: [
    "Passkey", "Accedi con una passkey", "Aggiungi una passkey", "Nessuna passkey per ora.", "Passkey aggiunta.", "Passkey rimossa.",
    "Rimuovere questa passkey? Non potrai più accedere con essa da questo dispositivo.", "L'accesso con passkey è stato annullato.",
    "Questa passkey non è registrata.", "Le passkey non funzionano a questo indirizzo. Apri il server tramite HTTPS.", "Questo browser non supporta le passkey.",
    "Ultimo utilizzo: {date}", "Impossibile verificare la passkey. Riprova.", "Si possono aggiungere fino a {n} passkey.",
  ],
  pt: [
    "Chaves de acesso", "Entrar com uma chave de acesso", "Adicionar chave de acesso", "Nenhuma chave de acesso ainda.", "Chave de acesso adicionada.", "Chave de acesso removida.",
    "Remover esta chave de acesso? Você não poderá mais entrar com ela neste dispositivo.", "O login com chave de acesso foi cancelado.",
    "Esta chave de acesso não está registrada.", "Chaves de acesso não funcionam neste endereço. Abra o servidor por HTTPS.", "Este navegador não oferece suporte a chaves de acesso.",
    "Último uso: {date}", "Não foi possível verificar a chave de acesso. Tente novamente.", "É possível adicionar até {n} chaves de acesso.",
  ],
  nl: [
    "Passkeys", "Inloggen met een passkey", "Passkey toevoegen", "Nog geen passkeys.", "Passkey toegevoegd.", "Passkey verwijderd.",
    "Deze passkey verwijderen? Je kunt er op dit apparaat dan niet meer mee inloggen.", "Inloggen met passkey is geannuleerd.",
    "Deze passkey is niet geregistreerd.", "Passkeys werken niet op dit adres. Open de server via HTTPS.", "Deze browser ondersteunt geen passkeys.",
    "Laatst gebruikt: {date}", "De passkey kon niet worden gecontroleerd. Probeer het opnieuw.", "Er kunnen maximaal {n} passkeys worden toegevoegd.",
  ],
  ru: [
    "Ключи доступа", "Войти с ключом доступа", "Добавить ключ доступа", "Ключей доступа пока нет.", "Ключ доступа добавлен.", "Ключ доступа удалён.",
    "Удалить этот ключ доступа? На этом устройстве с ним больше нельзя будет войти.", "Вход с ключом доступа отменён.",
    "Этот ключ доступа не зарегистрирован.", "По этому адресу ключи доступа не работают. Откройте сервер по HTTPS.", "Этот браузер не поддерживает ключи доступа.",
    "Последнее использование: {date}", "Не удалось проверить ключ доступа. Попробуйте ещё раз.", "Можно добавить до {n} ключей доступа.",
  ],
};

export const PASSKEY_WORDS = Object.fromEntries(Object.entries(ROWS).map(([lang, row]) => {
  if (row.length !== KEYS.length) throw new Error(`passkey-words: ${lang} has ${row.length} words for ${KEYS.length} keys`);
  return [lang, Object.fromEntries(KEYS.map((k, i) => [k, row[i]]))];
}));
