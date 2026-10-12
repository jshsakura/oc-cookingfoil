/**
 * Settling which game a patch is for. A wrong title id is worse than a missing
 * patch: the files would load into another game. So an id is settled only when
 * one id from the evidence is a real game in titledb; anything else goes to
 * review with its candidates.
 *
 * Evidence, strongest first: ids written in the post or the page it links to,
 * then the package's own file name (pixeldrain uploads are named <tid>.zip).
 */
export function resolveTitleId({ ids = [], fileIds = [] }, index) {
  for (const [by, list] of [["page", ids], ["file", fileIds]]) {
    const known = list.filter((t) => index.has(t));
    if (known.length === 1) return { tid: known[0], by };
    if (known.length > 1) return { tid: null, candidates: known, reason: "여러 게임 id 가 함께 적혀 있습니다" };
  }
  return { tid: null, candidates: [], reason: "본문과 배포처에 title id 가 없습니다" };
}
