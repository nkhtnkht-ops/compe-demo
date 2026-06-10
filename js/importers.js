// CSV取込・Excel移行（パース／正規化＋画面オーケストレーション）。
// render.js / storage.js の依存解決後に、DOM を伴う取込フロー（extract/register/
// readCsvFile/onCsvFile/onXlsxPicked/migrate/dz*/setImpMode）もここへ集約した。
// ロジックは1文字も変えない。XLSX は従来通り window グローバル参照。
import { state, FSA_SUPPORTED } from "./state.js";
import { pd, fmt, xdate, xtime } from "./dateutil.js";
import { recompute } from "./domain.js";
import { render, toast } from "./render.js";
import { markDirty } from "./storage.js";

export const WD = ["日", "月", "火", "水", "木", "金", "土"];

export function cellClean(s) {
  return (s || "")
    .replace(/^['"]+/, "")
    .replace(/['"]+$/, "")
    .trim();
}

export function normRoute(s) {
  s = cellClean(s);
  if (!s) return "その他";
  if (/事務所受け|電話|TEL/i.test(s)) return "電話";
  if (/AGWeb|AG.?Web/i.test(s)) return "AGWeb";
  if (/GORA|ＧＯＲＡ/i.test(s)) return "GORA";
  if (/GDO/i.test(s)) return "GDO";
  if (/RECRUIT|じゃらん|リクルート/i.test(s)) return "RECRUIT";
  if (/VALUE/i.test(s)) return "VALUE";
  return s;
}

export function cleanName(s) {
  return cellClean(s)
    .replace(/代表者名/g, "")
    .trim();
}

// CSV行を rows[] スキーマのオブジェクトへ。列順: 0場名1種別2プレー日3コース4時間5氏名6カナ7組数8人数9連絡先10携帯11FAX12経路13受付日時...
export function parseRow(c) {
  const playDt = pd(c[2]);
  const recvDt = pd(c[13]);
  const g = parseInt((c[7] || "").replace(/[^0-9]/g, "")) || 0;
  const p = parseInt((c[8] || "").replace(/[^0-9]/g, "")) || 0;
  const name = cleanName(c[5]);
  const tm = cellClean(c[4]).match(/(\d{1,2}):(\d{2})/) || [];
  return {
    n: name,
    play: fmt(playDt),
    wd: playDt ? WD[playDt.getDay()] : "",
    course: cellClean(c[3]),
    time: tm.length ? tm[1].padStart(2, "0") + ":" + tm[2] : "",
    g,
    p,
    route: normRoute(c[12]),
    recv: fmt(recvDt),
    d: ["", "", "", ""],
    s: ["", "", "", ""],
    kk: "",
    tel: cellClean(c[9]),
    mob: cellClean(c[10]),
    _playDt: playDt,
  };
}

// ===== 既存Excel台帳の移行用セル正規化 =====
export function xstat(v) {
  const s = (v == null ? "" : String(v)).replace(/['"]/g, "").trim();
  return s === "〇" || s === "不在" || s === "不要" ? s : "";
}
export function xkk(v) {
  const s = (v == null ? "" : String(v)).replace(/['"]/g, "").trim();
  return s === "〇" || s === "キャンセル" ? s : "";
}
export function xkumi(v) {
  const s = (v == null ? "" : String(v)).replace(/['"]/g, "").trim();
  return s === "済" ? "済" : "";
}
export function xclean(v) {
  return (v == null ? "" : String(v)).replace(/['"]/g, "").trim();
}
export function xnum(v) {
  const n = parseInt(String(v == null ? "" : v).replace(/[^0-9]/g, ""));
  return isNaN(n) ? 0 : n;
}

// ===== 日次CSV取込画面の初期化（移行UIは設定メニューへ集約済み） =====
export function setImpMode() {
  const ta = document.getElementById("ta");
  if (ta) {
    ta.value = "";
  }
  const im = document.getElementById("impMsg");
  if (im) im.textContent = "";
  const df = document.getElementById("dzFile");
  if (df) df.textContent = "";
  const cf = document.getElementById("csvFile");
  if (cf) cf.value = "";
  state._migRows = null;
  const bm = document.getElementById("bMig");
  if (bm) bm.disabled = true;
  const xn = document.getElementById("xlsxName");
  if (xn) xn.textContent = "";
  const xf = document.getElementById("xlsxFile");
  if (xf) xf.value = "";
  const mm = document.getElementById("migMsg");
  if (mm) mm.textContent = "";
}

// ===== 既存Excel台帳の移行（SheetJS） =====
export function onXlsxPicked(input) {
  const f = input.files && input.files[0];
  if (!f) {
    return;
  }
  document.getElementById("xlsxName").textContent = "読み込み中… " + f.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });
      const sheetName =
        wb.SheetNames.find((n) => n.indexOf("進捗") >= 0) ||
        wb.SheetNames.find((n) => n.indexOf("チェック") >= 0);
      if (!sheetName) {
        document.getElementById("migMsg").innerHTML =
          '<span style="color:#b91c1c">「進捗確認シート」が見つかりません。シート名をご確認ください。</span>';
        return;
      }
      const ws = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: true,
        cellDates: true,
        defval: null,
      });
      const out = [];
      for (let i = 2; i < aoa.length; i++) {
        // 3行目(index2)からデータ
        const r = aoa[i];
        if (!r) continue;
        const name = xclean(r[4]);
        if (!name) continue;
        const recv = xdate(r[1]),
          play = xdate(r[2]);
        const memoV = xclean(r[19]);
        out.push({
          n: name,
          play,
          wd: xclean(r[3]),
          course: xclean(r[7]),
          time: xtime(r[8]),
          g: xnum(r[9]),
          p: xnum(r[10]),
          route: xclean(r[11]),
          recv,
          d: ["", "", "", ""],
          s: [xstat(r[13]), xstat(r[14]), xstat(r[15]), xstat(r[16])],
          kk: xkk(r[18]),
          kumi: xkumi(r[20]),
          memo: memoV,
          inbound: /インバウンド/.test(memoV) ? "〇" : "", // 備考に記載があれば自動でマーク
          tel: xclean(r[5]),
          mob: xclean(r[6]),
        });
      }
      if (!out.length) {
        document.getElementById("migMsg").innerHTML =
          '<span style="color:#b91c1c">有効な行が見つかりませんでした。</span>';
        return;
      }
      state._migRows = out;
      document.getElementById("xlsxName").textContent =
        "✅ " + f.name + "（シート「" + sheetName + "」）";
      document.getElementById("bMig").disabled = false;
      const cancel = out.filter((x) => x.kk === "キャンセル").length;
      document.getElementById("migMsg").innerHTML =
        `<b>${out.length}</b> 件を読み込みました（うちキャンセル ${cancel} 件）。` +
        `①〜④の対応状況・組数確定・備考も引き継ぎます。` +
        `<br><span style="color:#b35900;font-weight:700">「台帳へ移行」を押すと、現在のデータは全て置き換わります。</span>`;
    } catch (err) {
      console.error(err);
      document.getElementById("migMsg").innerHTML =
        '<span style="color:#b91c1c">読み込みエラー：' + (err.message || err) + "</span>";
    }
  };
  reader.onerror = () => {
    document.getElementById("migMsg").innerHTML =
      '<span style="color:#b91c1c">ファイルを読めませんでした。</span>';
  };
  reader.readAsArrayBuffer(f);
}

export function migrate() {
  if (!state._migRows || !state._migRows.length) {
    document.getElementById("migMsg").textContent = "先にExcelファイルを選択してください";
    return;
  }
  if (
    state.rows.length &&
    !confirm(
      "現在の " +
        state.rows.length +
        " 件を、Excelの " +
        state._migRows.length +
        " 件で置き換えます。よろしいですか？\n（この操作の前のデータには、OneDrive/共有のファイル履歴から戻せます）"
    )
  )
    return;
  const n = state._migRows.length;
  state.rows = state._migRows.map((r) => ({ ...r, d: [...r.d], s: [...r.s] }));
  recompute(); // ①〜④予定日を受付/プレー＋設定日数から計算
  state.dataLoadedFromFile = true;
  state.needsReauth = false;
  state.lastKnownCount = state.rows.length; // 移行データは正本＝保存可能に
  state.selIdx = -1;
  state._migRows = null;
  document.getElementById("bMig").disabled = true;
  document.getElementById("migMsg").innerHTML =
    `<span style="color:#1a7f37;font-weight:700">${n} 件を移行しました。「← 一覧へ戻る」で確認できます（自動保存）。</span>`;
  markDirty();
  toast(n + " 件を移行しました");
  render();
}

export function dzOver(e) {
  e.preventDefault();
  document.getElementById("dropZone").classList.add("over");
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
}
export function dzLeave(e) {
  if (e.target.id === "dropZone") document.getElementById("dropZone").classList.remove("over");
}
export function dzDrop(e) {
  e.preventDefault();
  document.getElementById("dropZone").classList.remove("over");
  const dt = e.dataTransfer;
  if (!dt) return;
  if (dt.files && dt.files.length) {
    readCsvFile(dt.files[0]);
    return;
  }
  const t = dt.getData && dt.getData("text");
  if (t) {
    document.getElementById("ta").value = t;
    document.getElementById("dzFile").textContent = "";
    extract();
  }
}
export function onCsvFile(input) {
  const f = input.files && input.files[0];
  if (f) {
    readCsvFile(f);
    input.value = "";
  }
}
export function readCsvFile(f) {
  if (!/\.(csv|txt)$/i.test(f.name)) {
    document.getElementById("impMsg").innerHTML =
      '<span style="color:#b91c1c">CSV(.csv)またはテキスト(.txt)を選んでください</span>';
    return;
  }
  document.getElementById("dzFile").textContent = "読み込み中… " + f.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    const buf = e.target.result;
    let text = "";
    try {
      text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    } catch (_) {}
    if (!/プレー日|代表者|受付|予約/.test(text)) {
      try {
        text = new TextDecoder("shift-jis").decode(buf);
      } catch (_) {}
    }
    document.getElementById("ta").value = text;
    document.getElementById("dzFile").textContent =
      "読み込み済み：" +
      f.name +
      "（" +
      text.split(/\r?\n/).filter((l) => l.trim()).length +
      "行）";
    extract();
  };
  reader.onerror = () => {
    document.getElementById("impMsg").innerHTML =
      '<span style="color:#b91c1c">ファイルを読めませんでした</span>';
  };
  reader.readAsArrayBuffer(f);
}

// ===== CSV取込（実データ処理） =====
export function extract() {
  const t = document.getElementById("ta").value.trim();
  if (!t) {
    document.getElementById("impMsg").textContent = "CSVを貼り付けてください";
    return;
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim() && l.indexOf("プレー日") < 0);
  let total = 0,
    ge3 = 0,
    future = 0;
  const cand = [];
  lines.forEach((l) => {
    total++;
    const c = l.split(",");
    const r = parseRow(c);
    if (r.g < 3) return;
    ge3++;
    if (!r._playDt || r._playDt < state.TODAY) return;
    future++;
    if (!r.n) return;
    cand.push(r);
  });
  // CSV内重複排除（プレー日+氏名+経路）
  const seen = new Set(),
    uniq = [];
  cand.forEach((r) => {
    const k = r.play + "|" + r.n + "|" + r.route;
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(r);
    }
  });
  // 既存台帳と照合（プレー日+氏名が一致＝既存）→新規のみ
  const fresh = uniq.filter((r) => !state.rows.some((ex) => ex.n === r.n && ex.play === r.play));
  const dupExisting = uniq.length - fresh.length;
  fresh.forEach((r) => {
    delete r._playDt;
  });
  state._pendingImport = fresh;
  document.getElementById("impMsg").innerHTML =
    `抽出 <b>${uniq.length}</b> 件（3組以上・未来日・重複除外後）／ うち新規 <b>${fresh.length}</b> 件` +
    `<br><span style="color:#9ca3af;font-size:12px">読込${total}行 → 3組以上${ge3} → 未来日${future} → 重複/既存除外 ${uniq.length - fresh.length}件（既存台帳と重複 ${dupExisting}件）</span>` +
    (fresh.length
      ? `<br>内容を確認して『台帳へ登録』を押してください`
      : `<br><span style="color:#b35900">新規はありません（全て登録済み or 条件外）</span>`);
  document.getElementById("bReg").disabled = fresh.length === 0;
}
export function register() {
  // ★未接続/未読込のまま取り込むと、再接続時に少数の取込分で台帳が全消しされる事故になる。先に接続を必須化
  if (FSA_SUPPORTED && (!state.fileHandle || !state.dataLoadedFromFile)) {
    document.getElementById("impMsg").innerHTML =
      '<span style="color:#b91c1c;font-weight:700">先に台帳ファイルに接続してください。</span><br>上部の「再接続する」または「開く」で台帳を開いてから取り込みます（接続前に取り込むとデータが失われます）。';
    return;
  }
  if (!state._pendingImport.length) {
    document.getElementById("impMsg").textContent =
      "先にCSVを取り込んでください（ドロップ・ファイル選択・貼り付け）";
    return;
  }
  const n = state._pendingImport.length;
  state._pendingImport.forEach((r) => state.rows.push(r));
  recompute(); // ①〜④予定日を計算
  state._pendingImport = [];
  document.getElementById("ta").value = "";
  document.getElementById("bReg").disabled = true;
  document.getElementById("impMsg").innerHTML =
    `<span style="color:#1a7f37;font-weight:700">${n} 件を台帳に登録しました（自動保存）。『一覧へ戻る』で確認できます</span>`;
  markDirty();
  toast(n + " 件を登録しました");
  render();
}
