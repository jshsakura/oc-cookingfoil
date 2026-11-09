/**
 * The words of the icon slot (picture-slot.js) in the twelve admin languages. Korean is the source of truth.
 */
const KEYS = ["pic.icon", "pic.pick", "pic.remove", "pic.hint", "pic.saved", "pic.removed", "pic.removeAsk", "pic.notImage", "pic.none"];

const ROWS = {
  ko: ["아이콘", "아이콘 고르기", "아이콘 지우기", "그림 파일을 여기에 끌어다 놓아도 됩니다. 항목 폴더 안의 metadata 폴더에 저장합니다.", "아이콘을 저장했습니다.", "아이콘을 지웠습니다.", "이 아이콘을 지울까요?", "그림 파일만 올릴 수 있습니다.", "아이콘이 없습니다"],
  en: ["Icon", "Choose an icon", "Remove the icon", "You can also drop a picture file here. It is saved in the metadata folder inside the item's folder.", "Icon saved.", "Icon removed.", "Remove this icon?", "Only picture files can be uploaded.", "No icon"],
  ja: ["アイコン", "アイコンを選ぶ", "アイコンを削除", "画像ファイルをここにドラッグしても構いません。項目のフォルダー内の metadata フォルダーに保存します。", "アイコンを保存しました。", "アイコンを削除しました。", "このアイコンを削除しますか?", "画像ファイルだけをアップロードできます。", "アイコンがありません"],
  zh: ["图标", "选择图标", "删除图标", "也可以把图片文件拖到这里。图标保存在项目文件夹内的 metadata 文件夹中。", "图标已保存。", "图标已删除。", "要删除这个图标吗?", "只能上传图片文件。", "没有图标"],
  "zh-Hant": ["圖示", "選擇圖示", "刪除圖示", "也可以把圖片檔拖到這裡。圖示儲存在項目資料夾內的 metadata 資料夾中。", "圖示已儲存。", "圖示已刪除。", "要刪除這個圖示嗎?", "只能上傳圖片檔。", "沒有圖示"],
  es: ["Icono", "Elegir un icono", "Quitar el icono", "También puedes soltar aquí un archivo de imagen. Se guarda en la carpeta metadata dentro de la carpeta del elemento.", "Icono guardado.", "Icono quitado.", "¿Quitar este icono?", "Solo se pueden subir archivos de imagen.", "Sin icono"],
  fr: ["Icône", "Choisir une icône", "Retirer l'icône", "Vous pouvez aussi déposer un fichier image ici. Elle est enregistrée dans le dossier metadata du dossier de l'élément.", "Icône enregistrée.", "Icône retirée.", "Retirer cette icône ?", "Seuls les fichiers image peuvent être envoyés.", "Aucune icône"],
  de: ["Symbol", "Symbol auswählen", "Symbol entfernen", "Du kannst auch eine Bilddatei hier ablegen. Es wird im Ordner metadata im Ordner des Eintrags gespeichert.", "Symbol gespeichert.", "Symbol entfernt.", "Dieses Symbol entfernen?", "Nur Bilddateien können hochgeladen werden.", "Kein Symbol"],
  it: ["Icona", "Scegli un'icona", "Rimuovi l'icona", "Puoi anche trascinare qui un file immagine. Viene salvata nella cartella metadata dentro la cartella dell'elemento.", "Icona salvata.", "Icona rimossa.", "Rimuovere questa icona?", "Si possono caricare solo file immagine.", "Nessuna icona"],
  pt: ["Ícone", "Escolher um ícone", "Remover o ícone", "Você também pode soltar um arquivo de imagem aqui. Ele é salvo na pasta metadata dentro da pasta do item.", "Ícone salvo.", "Ícone removido.", "Remover este ícone?", "Só é possível enviar arquivos de imagem.", "Sem ícone"],
  nl: ["Pictogram", "Pictogram kiezen", "Pictogram verwijderen", "Je kunt hier ook een afbeeldingsbestand neerzetten. Het wordt bewaard in de map metadata in de map van het item.", "Pictogram opgeslagen.", "Pictogram verwijderd.", "Dit pictogram verwijderen?", "Alleen afbeeldingsbestanden kunnen worden geüpload.", "Geen pictogram"],
  ru: ["Значок", "Выбрать значок", "Удалить значок", "Можно также перетащить сюда файл изображения. Значок сохраняется в папке metadata внутри папки элемента.", "Значок сохранён.", "Значок удалён.", "Удалить этот значок?", "Можно загружать только файлы изображений.", "Нет значка"],
};

export const PICTURE_WORDS = Object.fromEntries(Object.entries(ROWS).map(([lang, row]) => {
  if (row.length !== KEYS.length) throw new Error(`picture-words: ${lang} has ${row.length} words for ${KEYS.length} keys`);
  return [lang, Object.fromEntries(KEYS.map((k, i) => [k, row[i]]))];
}));
