/**
 * The help a console shows when a file it would install is not signed and it has no signature
 * patches, in the twelve languages the console speaks. signed-help.js picks one.
 *
 * Per language: title, and a body per case: nca (the content signature fails), ticket (the ticket's
 * signature fails), both.
 */
export const SIGNED_WORDS = {
  ko: {
    title: "설치할 수 없습니다",
    nca: "이 파일은 만들어진 뒤에 바뀌어(한글 패치 등) 콘텐츠 서명이 맞지 않습니다. 서명 패치가 없는 본체에는 설치할 수 없습니다.",
    ticket: "이 파일의 티켓에는 정식 서명이 없습니다. 서명 패치가 없는 본체에는 설치할 수 없습니다.",
    both: "이 파일은 만들어진 뒤에 바뀌어 콘텐츠 서명이 맞지 않고, 티켓에도 정식 서명이 없습니다. 서명 패치가 없는 본체에는 설치할 수 없습니다.",
  },
  en: {
    title: "Cannot install",
    nca: "This file was changed after it was made (a translation patch, for example), so its content signature does not match. A console without signature patches cannot install it.",
    ticket: "This file's ticket has no genuine signature. A console without signature patches cannot install it.",
    both: "This file was changed after it was made, so its content signature does not match, and its ticket has no genuine signature either. A console without signature patches cannot install it.",
  },
  ja: {
    title: "インストールできません",
    nca: "このファイルは作成後に変更されている(翻訳パッチなど)ため、コンテンツの署名が一致しません。署名パッチのない本体にはインストールできません。",
    ticket: "このファイルのチケットには正規の署名がありません。署名パッチのない本体にはインストールできません。",
    both: "このファイルは作成後に変更されているためコンテンツの署名が一致せず、チケットにも正規の署名がありません。署名パッチのない本体にはインストールできません。",
  },
  zh: {
    title: "无法安装",
    nca: "此文件在制作后被修改过(例如汉化补丁),内容签名不匹配。没有签名补丁的主机无法安装。",
    ticket: "此文件的票据没有正式签名。没有签名补丁的主机无法安装。",
    both: "此文件在制作后被修改过,内容签名不匹配,票据也没有正式签名。没有签名补丁的主机无法安装。",
  },
  "zh-Hant": {
    title: "無法安裝",
    nca: "此檔案在製作後被修改過(例如中文化修正檔),內容簽章不符。沒有簽章修正的主機無法安裝。",
    ticket: "此檔案的票證沒有正式簽章。沒有簽章修正的主機無法安裝。",
    both: "此檔案在製作後被修改過,內容簽章不符,票證也沒有正式簽章。沒有簽章修正的主機無法安裝。",
  },
  es: {
    title: "No se puede instalar",
    nca: "Este archivo se modificó después de crearse (por ejemplo, con un parche de traducción), así que su firma de contenido no coincide. Una consola sin parches de firma no puede instalarlo.",
    ticket: "El ticket de este archivo no tiene una firma auténtica. Una consola sin parches de firma no puede instalarlo.",
    both: "Este archivo se modificó después de crearse, así que su firma de contenido no coincide, y su ticket tampoco tiene una firma auténtica. Una consola sin parches de firma no puede instalarlo.",
  },
  fr: {
    title: "Installation impossible",
    nca: "Ce fichier a été modifié après sa création (par un patch de traduction, par exemple) : sa signature de contenu ne correspond plus. Une console sans patchs de signature ne peut pas l'installer.",
    ticket: "Le ticket de ce fichier n'a pas de signature authentique. Une console sans patchs de signature ne peut pas l'installer.",
    both: "Ce fichier a été modifié après sa création : sa signature de contenu ne correspond plus et son ticket n'a pas non plus de signature authentique. Une console sans patchs de signature ne peut pas l'installer.",
  },
  de: {
    title: "Installation nicht möglich",
    nca: "Diese Datei wurde nach ihrer Erstellung verändert (zum Beispiel durch einen Übersetzungspatch), daher stimmt ihre Inhaltssignatur nicht. Eine Konsole ohne Signatur-Patches kann sie nicht installieren.",
    ticket: "Das Ticket dieser Datei hat keine echte Signatur. Eine Konsole ohne Signatur-Patches kann sie nicht installieren.",
    both: "Diese Datei wurde nach ihrer Erstellung verändert, daher stimmt ihre Inhaltssignatur nicht, und auch ihr Ticket hat keine echte Signatur. Eine Konsole ohne Signatur-Patches kann sie nicht installieren.",
  },
  it: {
    title: "Impossibile installare",
    nca: "Questo file è stato modificato dopo la creazione (ad esempio con una patch di traduzione), quindi la sua firma del contenuto non corrisponde. Una console senza patch delle firme non può installarlo.",
    ticket: "Il ticket di questo file non ha una firma autentica. Una console senza patch delle firme non può installarlo.",
    both: "Questo file è stato modificato dopo la creazione, quindi la sua firma del contenuto non corrisponde, e anche il suo ticket non ha una firma autentica. Una console senza patch delle firme non può installarlo.",
  },
  pt: {
    title: "Não é possível instalar",
    nca: "Este arquivo foi alterado depois de criado (por exemplo, com um patch de tradução), então a assinatura do conteúdo não confere. Um console sem patches de assinatura não pode instalá-lo.",
    ticket: "O ticket deste arquivo não tem uma assinatura autêntica. Um console sem patches de assinatura não pode instalá-lo.",
    both: "Este arquivo foi alterado depois de criado, então a assinatura do conteúdo não confere, e o ticket também não tem uma assinatura autêntica. Um console sem patches de assinatura não pode instalá-lo.",
  },
  nl: {
    title: "Kan niet installeren",
    nca: "Dit bestand is na het maken gewijzigd (bijvoorbeeld door een vertaalpatch), daardoor klopt de inhoudshandtekening niet. Een console zonder handtekeningpatches kan het niet installeren.",
    ticket: "Het ticket van dit bestand heeft geen echte handtekening. Een console zonder handtekeningpatches kan het niet installeren.",
    both: "Dit bestand is na het maken gewijzigd, daardoor klopt de inhoudshandtekening niet, en ook het ticket heeft geen echte handtekening. Een console zonder handtekeningpatches kan het niet installeren.",
  },
  ru: {
    title: "Установка невозможна",
    nca: "Этот файл был изменён после создания (например, патчем перевода), поэтому подпись содержимого не совпадает. Консоль без патчей подписей не сможет его установить.",
    ticket: "У билета этого файла нет подлинной подписи. Консоль без патчей подписей не сможет его установить.",
    both: "Этот файл был изменён после создания, поэтому подпись содержимого не совпадает, а у его билета тоже нет подлинной подписи. Консоль без патчей подписей не сможет его установить.",
  },
};
