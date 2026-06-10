// エントリポイント。各モジュールを束ね、onclick属性ハンドラ用に必要関数を window へ公開し、
// 初期化を実行する。ここに残すのは「複数モジュールを跨ぐ画面オーケストレーションと一覧操作
// （setS/setF 等のミューテーション）」のみ。ロジックは Phase 1 を通じて1文字も変えていない。
import { state, FSA_SUPPORTED } from "./state.js";
import { recompute } from "./domain.js";
import { WD, parseRow, xstat, xkk, xkumi, xclean, xnum } from "./importers.js";
import { smsSurname, smsFilteredRows, smsAggregate } from "./exporters.js";
import {
  render,
  renderDetail,
  renderStrip,
  renderStats,
  editCell,
  routeSelect,
  toast,
  copyText,
  rebuildLabels,
} from "./render.js";
import { xdate, xtime } from "./dateutil.js";
import {
  markDirty,
  applyJson,
  reloadFromFile,
  onOpenFile,
  onNewFile,
  onReauth,
  onSetBackupDir,
  manualBackup,
  updateBackupStatus,
  saveUpdatedBy,
} from "./storage.js";

/* global XLSX, cptable */

// ===== 一覧操作（state ミューテーション → markDirty/render）。Phase 4 で addEventListener 化予定 =====
function setMemo(gi, val) {
  if (state.rows[gi]) {
    state.rows[gi].memo = val;
    markDirty();
  }
}
function setNum(gi, key, val) {
  if (!state.rows[gi]) return;
  const n = parseInt(String(val).replace(/[^0-9]/g, "")) || 0;
  if ((state.rows[gi][key] || 0) === n) return;
  state.rows[gi][key] = n;
  markDirty();
  render();
}
function setText(gi, key, val) {
  if (!state.rows[gi]) return;
  const v = (val || "").trim();
  if ((state.rows[gi][key] || "") === v) return;
  state.rows[gi][key] = v;
  markDirty();
  render();
}
function setPlay(gi, val) {
  if (!state.rows[gi]) return;
  const m = (val || "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return;
  const y = +m[1],
    mo = +m[2],
    dd = +m[3];
  state.rows[gi].play = y + "/" + String(mo).padStart(2, "0") + "/" + String(dd).padStart(2, "0");
  state.rows[gi].wd = WD[new Date(y, mo - 1, dd).getDay()];
  recompute();
  markDirty();
  render();
} // プレー日変更→③④予定日も再計算

function onSearch(v) {
  state.searchQ = v;
  render();
}
function setContact(f) {
  state.contactFilter = f;
  [
    ["", "cfAll"],
    ["0", "cf0"],
    ["1", "cf1"],
    ["2", "cf2"],
    ["3", "cf3"],
  ].forEach(([v, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("on", state.contactFilter === v);
  });
  render();
}
function setS(gi, i, val, quiet) {
  const r = state.rows[gi];
  if (r.s[i] === val) return;
  state.undoStack.push({ gi, t: "s", i, prev: r.s[i] });
  r.s[i] = val;
  r._touch = true;
  state.selIdx = gi;
  document.getElementById("undoBtn").disabled = false;
  if (!quiet) {
    if (val === "") toast(state.lbl[i] + "を空に戻しました");
    else if (val === "不在") toast(state.lbl[i] + "＝不在（繰越で残ります）");
    else toast(state.lbl[i] + "＝" + val + "（更新するまで一覧に残ります）");
  }
  markDirty();
  render();
}
function setF(gi, key, val, jp) {
  const r = state.rows[gi];
  if ((r[key] || "") === val) return;
  state.undoStack.push({ gi, t: "f", key, prev: r[key] || "" });
  r[key] = val;
  r._touch = true;
  state.selIdx = gi;
  document.getElementById("undoBtn").disabled = false;
  toast(jp + "＝" + (val === "" ? "未" : val) + "（更新するまで一覧に残ります）");
  markDirty();
  render();
}
function skipToEarly(gi) {
  const r = state.rows[gi];
  const prev = [r.s[0], r.s[1], r.s[2]];
  if (prev.every((v) => v === "不要")) {
    toast("①〜③は既にスキップ済みです");
    return;
  }
  state.undoStack.push({ gi, t: "s3", prev });
  r.s[0] = "不要";
  r.s[1] = "不要";
  r.s[2] = "不要";
  r._touch = true;
  state.selIdx = gi;
  document.getElementById("undoBtn").disabled = false;
  toast("①〜③をスキップ（不要）。④だけ残します");
  markDirty();
  render();
}
function setNext(gi, v) {
  state.rows[gi].next = v ? v.replace(/-/g, "/") : "";
  state.rows[gi]._touch = true;
  markDirty();
  toast(
    v
      ? "次回連絡日 " + state.rows[gi].next + "（その日まで今日やることから外します）"
      : "次回連絡日をクリア"
  );
  render();
}
function undoLast() {
  if (state.undoStack.length === 0) {
    toast("戻す操作がありません");
    return;
  }
  const u = state.undoStack.pop();
  if (u.t === "f") {
    state.rows[u.gi][u.key] = u.prev;
  } else if (u.t === "s3") {
    [0, 1, 2].forEach((i, k) => (state.rows[u.gi].s[i] = u.prev[k]));
  } else {
    state.rows[u.gi].s[u.i] = u.prev;
  }
  state.rows[u.gi]._touch = true;
  state.selIdx = u.gi;
  document.getElementById("undoBtn").disabled = state.undoStack.length === 0;
  toast("元に戻しました：" + state.rows[u.gi].n);
  markDirty();
  render();
}
function refreshList() {
  state.rows.forEach((r) => (r._touch = false));
  state.undoStack = [];
  document.getElementById("undoBtn").disabled = true;
  toast("一覧を整理しました（解決済みを除外）");
  render();
}
function toggleMode() {
  state.showAll = !state.showAll;
  render();
}
function setMode(all) {
  state.showAll = all;
  render();
}
function setSort(k) {
  state.sortKey = k;
  document.getElementById("sortPlay").classList.toggle("on", k === "play");
  document.getElementById("sortRecv").classList.toggle("on", k === "recv");
  render();
}
function delRow(gi) {
  const r = state.rows[gi];
  if (!r) return;
  if (confirm(r.n + " を削除しますか？\n（この操作は元に戻せません）")) {
    state.rows.splice(gi, 1);
    if (state.selIdx >= state.rows.length)
      state.selIdx = Math.max(0, state.rows.length - 1);
    toast("削除しました：" + r.n);
    markDirty();
    render();
  }
}

// ===== 画面遷移 =====
function showScreen(name) {
  const main = name === "main";
  document.getElementById("screenMain").classList.toggle("hidden", name !== "main");
  document.getElementById("screenImport").classList.toggle("hidden", name !== "import");
  document
    .getElementById("screenSettings")
    .classList.toggle("hidden", name !== "settings");
  document.getElementById("screenSms").classList.toggle("hidden", name !== "sms");
  document.getElementById("screenStats").classList.toggle("hidden", name !== "stats");
  ["modeSeg", "undoBtn", "toImport", "toSettings", "toSms", "toStats"].forEach((id) =>
    document.getElementById(id).classList.toggle("hidden", !main)
  );
  document.getElementById("refBtn").classList.toggle("hidden", !main || state.showAll);
  document.getElementById("toMain").classList.toggle("hidden", main);
  if (name === "settings") {
    const sb = document.getElementById("setUpdatedBy");
    if (sb) sb.value = state.updatedBy || "";
    updateBackupStatus();
  }
  if (name === "stats") {
    renderStats();
  }
}
function setImpMode() {
  // 日次CSV取込画面の初期化（移行UIは設定メニューへ集約済み）
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
function onXlsxPicked(input) {
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

function migrate() {
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
function saveSettings() {
  state.o1 = +document.getElementById("so1").value || 0;
  state.o2 = +document.getElementById("so2").value || 0;
  state.o3 = +document.getElementById("so3").value || 0;
  state.o4 = +document.getElementById("so4").value || 0;
  state.excludeKakutei = document.getElementById("setExKakutei").checked;
  state.todayTouch = [0, 1, 2, 3].map((i) => document.getElementById("tt" + i).checked);
  rebuildLabels();
  recompute();
  document.getElementById("setMsg").innerHTML =
    '<span style="color:#1a7f37;font-weight:700">保存しました（①〜④の予定日とラベルを再計算）。一覧へ戻ると反映されています</span>';
  toast("設定を保存しました");
  markDirty();
  render();
}
function dzOver(e) {
  e.preventDefault();
  document.getElementById("dropZone").classList.add("over");
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
}
function dzLeave(e) {
  if (e.target.id === "dropZone")
    document.getElementById("dropZone").classList.remove("over");
}
function dzDrop(e) {
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
function onCsvFile(input) {
  const f = input.files && input.files[0];
  if (f) {
    readCsvFile(f);
    input.value = "";
  }
}
function readCsvFile(f) {
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
function extract() {
  const t = document.getElementById("ta").value.trim();
  if (!t) {
    document.getElementById("impMsg").textContent = "CSVを貼り付けてください";
    return;
  }
  const lines = t
    .split(/\r?\n/)
    .filter((l) => l.trim() && l.indexOf("プレー日") < 0);
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
  const fresh = uniq.filter(
    (r) => !state.rows.some((ex) => ex.n === r.n && ex.play === r.play)
  );
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
function register() {
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

// ===== Excel書き出し（現行台帳と同じ形式＝バックアップ＆再取込可能） =====
// ===== SMS配信リスト書き出し（SMSLINK一括配信用） =====
function smsResult() {
  const list = smsFilteredRows();
  let agg = smsAggregate(list, document.getElementById("smsDedupe").checked);
  const minV = Math.max(1, parseInt(document.getElementById("smsMinVisits").value) || 1);
  if (minV > 1) agg = agg.filter((e) => e.cnt >= minV);
  return { list, agg, minV };
}
function smsPreview() {
  const { list, agg, minV } = smsResult();
  const extra = minV > 1 ? `・予約${minV}回以上` : "";
  document.getElementById("smsMsg").innerHTML =
    `該当 <b>${list.length}</b> 件 ／ 配信先（ユニーク携帯${extra}） <b>${agg.length}</b> 件`;
  return agg;
}
function smsExport() {
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
  agg.forEach((e) =>
    aoa.push([e.mob, e.n, smsSurname(e.n), e.play, e.course, e.route, e.cnt])
  );
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
  const n = new Date();
  const ymd =
    n.getFullYear() +
    String(n.getMonth() + 1).padStart(2, "0") +
    String(n.getDate()).padStart(2, "0");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "SMS配信リスト_" + ymd + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  document.getElementById("smsMsg").innerHTML =
    `<span style="color:#1a7f37;font-weight:700">${agg.length} 件を書き出しました（SMSLINK用CSV・${enc}）</span>`;
  toast(agg.length + " 件のSMS配信リストを書き出しました");
}

function exportExcel() {
  if (typeof XLSX === "undefined") {
    toast("Excel機能の読み込みに失敗しました");
    return;
  }
  if (!state.rows.length) {
    toast("書き出すデータがありません");
    return;
  }
  const head = [
    "抽出日", "受付日", "プレー日", "曜日", "代表者氏名", "連絡先電話番号", "携帯電話番号",
    "コース名", "時間", "組数", "人数", "経路", "連絡可能時間帯", "①予約1日後", "②60日前",
    "③35日前", "④18日前", "出欠締切日", "組数確定", "備考", "組合せ入力",
  ];
  const aoa = [["予約チェック台帳（HTMLツール書き出し）"], head];
  state.rows.forEach((r) => {
    const s = r.s || ["", "", "", ""],
      d = r.d || ["", "", "", ""];
    aoa.push([
      "", r.recv || "", r.play || "", r.wd || "", r.n || "", r.tel || "", r.mob || "",
      r.course || "", r.time || "", r.g || "", r.p || "", r.route || "", "",
      s[0] || d[0] || "", s[1] || d[1] || "", s[2] || d[2] || "", s[3] || d[3] || "",
      "", r.kk || "", r.memo || "", r.kumi || "",
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "予約チェック進捗確認シート");
  const n = new Date();
  const ymd =
    n.getFullYear() +
    String(n.getMonth() + 1).padStart(2, "0") +
    String(n.getDate()).padStart(2, "0");
  XLSX.writeFile(wb, "予約チェック_backup_" + ymd + ".xlsx");
  toast("Excelを書き出しました（" + state.rows.length + "件）");
}

// ===== onclick属性ハンドラ用に window へ公開（Phase 4 で addEventListener 化予定） =====
// テスト用フック __state も併せて公開する。
Object.assign(window, {
  // 状態フック
  __state: state,
  // FSA / 保存（storage.js）
  reloadFromFile,
  onOpenFile,
  onNewFile,
  onReauth,
  onSetBackupDir,
  manualBackup,
  saveUpdatedBy,
  // Excel / SMS 書き出し
  exportExcel,
  smsPreview,
  smsExport,
  // 集計・ストリップ（render.js）
  renderStrip,
  renderStats,
  // 一覧操作
  setMode,
  toggleMode,
  refreshList,
  undoLast,
  setSort,
  setContact,
  onSearch,
  setS,
  setF,
  skipToEarly,
  setNext,
  setMemo,
  setNum,
  setText,
  setPlay,
  delRow,
  copyText,
  routeSelect,
  editCell,
  // 画面遷移・描画
  showScreen,
  render,
  renderDetail,
  // 設定
  saveSettings,
  // 取込・移行
  dzOver,
  dzLeave,
  dzDrop,
  onCsvFile,
  extract,
  register,
  onXlsxPicked,
  migrate,
  // テスト互換: applyJson（storage.js）
  applyJson,
});

// テスト互換: 既存E2Eが `window.TODAY = ...` で基準日を差し替えるため、
// state.TODAY と同期するアクセサを定義する（state が単一の真実）。
Object.defineProperty(window, "TODAY", {
  get() {
    return state.TODAY;
  },
  set(v) {
    state.TODAY = v;
  },
  configurable: true,
});

// ===== 初期化 =====
rebuildLabels();
recompute();
setImpMode("new");
render();
