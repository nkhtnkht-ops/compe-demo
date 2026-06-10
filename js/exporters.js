// SMS配信リスト／Excel書き出しのデータ整形ロジック。
// Phase 1 ステップ3では state + dateutil にのみ依存する抽出／集計部を移設する。
// （exportExcel / smsExport / smsResult / smsPreview の DOM 出力と XLSX/cptable 参照は
//  toast 等の render 依存解決後にステップ5で exporters へ集約する。）
// XLSX / cptable は従来通り window グローバル参照のまま。ロジックは不変。
import { state } from "./state.js";
import { pd } from "./dateutil.js";

export function smsNormPhone(s) {
  return (s || "").replace(/[^0-9]/g, "");
}
export function smsIsMobile(s) {
  return /^(070|080|090)\d{8}$/.test(smsNormPhone(s));
}
export function smsSurname(n) {
  const s = (n || "").trim();
  const i = s.search(/[\s　]/);
  return i > 0 ? s.slice(0, i) : s;
} // スペース前を姓に。会社名等はそのまま

export function smsFilteredRows() {
  const routes = [...document.querySelectorAll(".smsRoute:checked")].map((c) => c.value);
  const past = document.getElementById("smsPast").checked;
  const exclC = document.getElementById("smsExclCancel").checked;
  const exclInb = document.getElementById("smsExclInbound").checked;
  const exclFor = document.getElementById("smsExclForeign").checked;
  const fromD = pd((document.getElementById("smsFrom").value || "").replace(/-/g, "/"));
  const toD = pd((document.getElementById("smsTo").value || "").replace(/-/g, "/"));
  return state.rows.filter((r) => {
    if (routes.length && !routes.includes(r.route)) return false;
    if (exclC && r.kk === "キャンセル") return false;
    if (exclInb && (r.inbound === "〇" || /インバウンド/.test(r.memo || ""))) return false;
    if (exclFor && smsIsForeignName(r.n)) return false;
    const pl = pd(r.play);
    if (past && (!pl || pl > state.TODAY)) return false;
    if (fromD && (!pl || pl < fromD)) return false;
    if (toD && (!pl || pl > toD)) return false;
    if (!smsIsMobile(r.mob)) return false;
    return true;
  });
}
// 外国名の判定：ローマ字/英字・ハングル・代表的な簡体字を検出（漢字名の韓国・中国は判別不可＝手動マークで対応）
export function smsIsForeignName(n) {
  const s = n || "";
  if (/[A-Za-zＡ-Ｚａ-ｚ]/.test(s)) return true; // ローマ字・英字（全半角）
  if (/[ᄀ-ᇿ㄰-㆏가-힣]/.test(s)) return true; // ハングル
  if (/[张刘陈杨赵韩龙罗郑冯邓萧苏蒋贾顾卢钱孙马严华叶吕齐]/.test(s)) return true; // 主な簡体字（日本語に無い字形）
  return false;
}
export function smsAggregate(list, dedupe) {
  if (!dedupe)
    return list.map((r) => ({
      mob: smsNormPhone(r.mob),
      n: r.n,
      play: r.play,
      course: r.course,
      route: r.route,
      cnt: 1,
    }));
  const map = new Map();
  list.forEach((r) => {
    const k = smsNormPhone(r.mob),
      pl = pd(r.play);
    if (!map.has(k))
      map.set(k, {
        mob: k,
        n: r.n,
        play: r.play,
        course: r.course,
        route: r.route,
        cnt: 1,
        _pl: pl,
      });
    else {
      const e = map.get(k);
      e.cnt++;
      if (pl && (!e._pl || pl > e._pl)) {
        e.n = r.n;
        e.play = r.play;
        e.course = r.course;
        e.route = r.route;
        e._pl = pl;
      }
    }
  });
  return [...map.values()];
}
