/**
 * The help a console shows before it tries a file that is not signed, in the twelve languages the
 * console speaks. signed-help.js picks one.
 *
 * Per language: title, and a body per case: nca (the content signature fails), ticket (the ticket's
 * signature fails), both.
 */
export const SIGNED_WORDS = {
  ko: {
    title: "서명이 없는 파일",
    nca: "이 파일은 만들어진 뒤에 바뀌어(한글 패치 등) 콘텐츠 서명이 맞지 않습니다. 본체가 설치를 거부할 수 있습니다.",
    ticket: "이 파일의 티켓에는 정식 서명이 없습니다. 본체가 설치를 거부할 수 있습니다.",
    both: "이 파일은 만들어진 뒤에 바뀌어 콘텐츠 서명이 맞지 않고, 티켓에도 정식 서명이 없습니다. 본체가 설치를 거부할 수 있습니다.",
  },
  en: {
    title: "Not signed",
    nca: "This file was changed after it was made (a translation patch, for example), so its content signature does not match. The console may refuse to install it.",
    ticket: "This file's ticket has no genuine signature. The console may refuse to install it.",
    both: "This file was changed after it was made, so its content signature does not match, and its ticket has no genuine signature either. The console may refuse to install it.",
  },
  ja: {
    title: "署名のないファイル",
    nca: "このファイルは作成後に変更されている（翻訳パッチなど）ため、コンテンツの署名が一致しません。本体がインストールを拒否する場合があります。",
    ticket: "このファイルのチケットには正規の署名がありません。本体がインストールを拒否する場合があります。",
    both: "このファイルは作成後に変更されていてコンテンツの署名が一致せず、チケットにも正規の署名がありません。本体がインストールを拒否する場合があります。",
  },
  zh: {
    title: "没有签名的文件",
    nca: "此文件在制作后被修改过（例如汉化补丁），内容签名不匹配。主机可能会拒绝安装。",
    ticket: "此文件的票据没有正式签名。主机可能会拒绝安装。",
    both: "此文件在制作后被修改过，内容签名不匹配，票据也没有正式签名。主机可能会拒绝安装。",
  },
  "zh-Hant": {
    title: "沒有簽章的檔案",
    nca: "此檔案在製作後被修改過（例如中文化修正檔），內容簽章不符。主機可能會拒絕安裝。",
    ticket: "此檔案的票證沒有正式簽章。主機可能會拒絕安裝。",
    both: "此檔案在製作後被修改過，內容簽章不符，票證也沒有正式簽章。主機可能會拒絕安裝。",
  },
  es: {
    title: "Archivo sin firmar",
    nca: "Este archivo se modificó después de crearse (por ejemplo, con un parche de traducción), así que su firma de contenido no coincide. La consola puede rechazar su instalación.",
    ticket: "El ticket de este archivo no tiene una firma auténtica. La consola puede rechazar su instalación.",
    both: "Este archivo se modificó después de crearse, así que su firma de contenido no coincide, y su ticket tampoco tiene una firma auténtica. La consola puede rechazar su instalación.",
  },
  fr: {
    title: "Fichier non signé",
    nca: "Ce fichier a été modifié après sa création (un patch de traduction, par exemple) : sa signature de contenu ne correspond plus. La console peut refuser de l’installer.",
    ticket: "Le ticket de ce fichier n’a pas de signature authentique. La console peut refuser de l’installer.",
    both: "Ce fichier a été modifié après sa création : sa signature de contenu ne correspond plus et son ticket n’a pas non plus de signature authentique. La console peut refuser de l’installer.",
  },
  de: {
    title: "Nicht signiert",
    nca: "Diese Datei wurde nach ihrer Erstellung verändert (zum Beispiel durch einen Übersetzungspatch), daher stimmt ihre Inhaltssignatur nicht. Die Konsole kann die Installation verweigern.",
    ticket: "Das Ticket dieser Datei hat keine echte Signatur. Die Konsole kann die Installation verweigern.",
    both: "Diese Datei wurde nach ihrer Erstellung verändert, daher stimmt ihre Inhaltssignatur nicht, und auch ihr Ticket hat keine echte Signatur. Die Konsole kann die Installation verweigern.",
  },
  it: {
    title: "File non firmato",
    nca: "Questo file è stato modificato dopo la creazione (ad esempio con una patch di traduzione), quindi la firma del contenuto non corrisponde. La console potrebbe rifiutarne l’installazione.",
    ticket: "Il ticket di questo file non ha una firma autentica. La console potrebbe rifiutarne l’installazione.",
    both: "Questo file è stato modificato dopo la creazione, quindi la firma del contenuto non corrisponde, e anche il suo ticket non ha una firma autentica. La console potrebbe rifiutarne l’installazione.",
  },
  pt: {
    title: "Arquivo não assinado",
    nca: "Este arquivo foi alterado depois de criado (por um patch de tradução, por exemplo), por isso a assinatura do conteúdo não confere. O console pode recusar a instalação.",
    ticket: "O ticket deste arquivo não tem uma assinatura autêntica. O console pode recusar a instalação.",
    both: "Este arquivo foi alterado depois de criado, por isso a assinatura do conteúdo não confere, e o ticket também não tem uma assinatura autêntica. O console pode recusar a instalação.",
  },
  nl: {
    title: "Niet ondertekend",
    nca: "Dit bestand is na het maken gewijzigd (bijvoorbeeld door een vertaalpatch), dus de inhoudshandtekening klopt niet. De console kan de installatie weigeren.",
    ticket: "Het ticket van dit bestand heeft geen echte handtekening. De console kan de installatie weigeren.",
    both: "Dit bestand is na het maken gewijzigd, dus de inhoudshandtekening klopt niet, en ook het ticket heeft geen echte handtekening. De console kan de installatie weigeren.",
  },
  ru: {
    title: "Файл не подписан",
    nca: "Этот файл изменили после создания (например, патчем перевода), поэтому подпись содержимого не совпадает. Консоль может отказаться его устанавливать.",
    ticket: "У билета этого файла нет подлинной подписи. Консоль может отказаться его устанавливать.",
    both: "Этот файл изменили после создания, поэтому подпись содержимого не совпадает, и у его билета тоже нет подлинной подписи. Консоль может отказаться его устанавливать.",
  },
};
