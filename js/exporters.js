// SMS配信リスト／Excel書き出し（データ整形＋CSV/Excel 出力）。
// render.js の依存解決後に、DOM 出力と XLSX/cptable 参照を伴う
// exportExcel / smsResult / smsPreview / smsExport もここへ集約した。
// XLSX / cptable は従来通り window グローバル参照のまま。ロジックは不変。
import { state } from "./state.js";
import { pd, todayYmd } from "./dateutil.js";
import { toast } from "./render.js";

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

export function smsResult() {
  const list = smsFilteredRows();
  let agg = smsAggregate(list, document.getElementById("smsDedupe").checked);
  const minV = Math.max(1, parseInt(document.getElementById("smsMinVisits").value) || 1);
  if (minV > 1) agg = agg.filter((e) => e.cnt >= minV);
  return { list, agg, minV };
}
export function smsPreview() {
  const { list, agg, minV } = smsResult();
  const extra = minV > 1 ? `・予約${minV}回以上` : "";
  document.getElementById("smsMsg").innerHTML =
    `該当 <b>${list.length}</b> 件 ／ 配信先（ユニーク携帯${extra}） <b>${agg.length}</b> 件`;
  return agg;
}
export function smsExport() {
  if (typeof XLSX === "undefined") {
    toast("CSV機能の読み込みに失敗しました");
    return;
  }
  const { agg } = smsResult();
  if (!agg.length) {
    document.getElementById("smsMsg").innerHTML =
      '<span style="color:#b35900">該当する配信先がありません（携帯番号070/080/090がある人・条件一致が必要）</span>';
    return;
  }
  const aoa = [["携帯番号", "氏名", "姓", "最終プレー日", "コース", "経路", "予約回数"]];
  agg.forEach((e) => aoa.push([e.mob, e.n, smsSurname(e.n), e.play, e.course, e.route, e.cnt]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const csv = XLSX.utils.sheet_to_csv(ws); // UTF-8文字列
  let bytes,
    enc = "Shift-JIS";
  try {
    bytes = new Uint8Array(cptable.utils.encode(932, csv));
  } catch (e) {
    // 真のShift-JIS
    console.warn("sjis encode failed, fallback utf8", e);
    bytes = new TextEncoder().encode(csv);
    enc = "UTF-8";
  }
  const blob = new Blob([bytes], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "SMS配信リスト_" + todayYmd() + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  document.getElementById("smsMsg").innerHTML =
    `<span style="color:#1a7f37;font-weight:700">${agg.length} 件を書き出しました（SMSLINK用CSV・${enc}）</span>`;
  toast(agg.length + " 件のSMS配信リストを書き出しました");
}

export function exportExcel() {
  if (typeof XLSX === "undefined") {
    toast("Excel機能の読み込みに失敗しました");
    return;
  }
  if (!state.rows.length) {
    toast("書き出すデータがありません");
    return;
  }
  const head = [
    "抽出日",
    "受付日",
    "プレー日",
    "曜日",
    "代表者氏名",
    "連絡先電話番号",
    "携帯電話番号",
    "コース名",
    "時間",
    "組数",
    "人数",
    "経路",
    "連絡可能時間帯",
    "①予約1日後",
    "②60日前",
    "③35日前",
    "④18日前",
    "出欠締切日",
    "組数確定",
    "備考",
    "組合せ入力",
  ];
  const aoa = [["予約チェック台帳（HTMLツール書き出し）"], head];
  state.rows.forEach((r) => {
    const s = r.s || ["", "", "", ""],
      d = r.d || ["", "", "", ""];
    aoa.push([
      "",
      r.recv || "",
      r.play || "",
      r.wd || "",
      r.n || "",
      r.tel || "",
      r.mob || "",
      r.course || "",
      r.time || "",
      r.g || "",
      r.p || "",
      r.route || "",
      "",
      s[0] || d[0] || "",
      s[1] || d[1] || "",
      s[2] || d[2] || "",
      s[3] || d[3] || "",
      "",
      r.kk || "",
      r.memo || "",
      r.kumi || "",
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "予約チェック進捗確認シート");
  XLSX.writeFile(wb, "予約チェック_backup_" + todayYmd() + ".xlsx");
  toast("Excelを書き出しました（" + state.rows.length + "件）");
}
