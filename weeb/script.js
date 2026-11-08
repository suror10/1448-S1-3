const API_URL = "https://script.google.com/macros/s/AKfycbx2AIjN9-XkAOwWaSc1Q53WSMB7tEe7F_dkVeG5SjPCcaLxdW-G0y_KeVefzGnxWKvzCw/exec";

const STORAGE_PREFIX = "ali_halaqa_v2_";

const FULL_9_HEADERS = [
  "اليوم",
  "المطلوب (المراجعة)",
  "مطلوب إضافي (الحفظ)",
  "التقييم",
  "مقرر المراجعة",
  "منجز المراجعة",
  "مقرر الحفظ",
  "منجز الحفظ",
  "الحالة"
];

const MERGED_6_HEADERS = [
  "اليوم",
  "المطلوب",
  "التقييم",
  "المقرر (م-ع-ص)",
  "المنجز (ع-ص)",
  "الحالة"
];

let allStudentNamesList = [];
let allStudentsMemoryCache = {}; // ذاكرة فورية في المتصفح لجميع خطط الطلاب (0 ثانية عند اختيار الطالب)
let allWeeksData = [];
let currentWeekNumber = 1;
let isSyncingInBackground = false;
let autoSyncIntervalId = null;

function safeGetStorage(key) {
  try {
    return localStorage.getItem(STORAGE_PREFIX + key);
  } catch (e) {
    return null;
  }
}

function safeSetStorage(key, val) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, val);
  } catch (e) {}
}

function clearSavedCacheAndReload() {
  try {
    localStorage.clear();
  } catch (e) {}
  allStudentsMemoryCache = {};
  loadStudentNames(true);
}

window.addEventListener('load', () => {
  try {
    const lastApi = localStorage.getItem(STORAGE_PREFIX + 'api_url');
    if (lastApi !== API_URL) {
      localStorage.removeItem('allStudentNames');
      localStorage.removeItem('lastSearchName');
      localStorage.setItem(STORAGE_PREFIX + 'api_url', API_URL);
    }
  } catch (e) {}

  loadStudentNames(true);

  // تحديث تلقائي فوري بمجرد رجوع المعلم أو الطالب إلى نافذة الموقع بعد التعديل في قوقل شيت
  window.addEventListener('focus', () => {
    silentBackgroundSync();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      silentBackgroundSync();
    }
  });

  // مزامنة دورية صامتة كل 20 ثانية أثناء بقاء الصفحة مفتوحة
  if (autoSyncIntervalId) clearInterval(autoSyncIntervalId);
  autoSyncIntervalId = setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      silentBackgroundSync();
    }
  }, 20000);
});

/**
 * مزامنة صامتة في الخلفية: تجلب أحدث التعديلات من قوقل شيت دون إخفاء الجدول المعروض أو إزعاج المستخدم
 */
async function silentBackgroundSync() {
  if (!navigator.onLine || isSyncingInBackground) return;
  isSyncingInBackground = true;
  try {
    const response = await fetch(`${API_URL}?action=getAllData&nocache=1&t=${Date.now()}`);
    const result = await response.json();

    if (result.status === 'success' && Array.isArray(result.names)) {
      allStudentNamesList = result.names;
      if (result.students) {
        allStudentsMemoryCache = result.students;
        safeSetStorage('allStudentsBulkData', JSON.stringify({
          names: result.names,
          students: result.students
        }));
      }
      safeSetStorage('allStudentNames', JSON.stringify(result.names));
      populateSelect(result.names, true);

      const activeStudent = document.getElementById('searchInput').value;
      if (activeStudent && allStudentsMemoryCache[activeStudent]) {
        applyStudentResult(allStudentsMemoryCache[activeStudent], false, true);
      }
    }
  } catch (e) {
    // في حال فشل التحديث الصامت نبقي البيانات المعروضة كما هي
  } finally {
    isSyncingInBackground = false;
  }
}

async function loadStudentNames(forceFresh = true) {
  const select = document.getElementById('searchInput');

  // 1) العرض الفوري من الكاش المحلي في 0 ثانية حتى لا ينتظر المستخدم
  const cachedBulk = safeGetStorage('allStudentsBulkData');
  if (cachedBulk) {
    try {
      const parsed = JSON.parse(cachedBulk);
      if (parsed && Array.isArray(parsed.names) && parsed.students) {
        allStudentNamesList = parsed.names;
        allStudentsMemoryCache = parsed.students;
        populateSelect(parsed.names, true);
      }
    } catch (e) {}
  } else {
    const cachedNames = safeGetStorage('allStudentNames');
    if (cachedNames) {
      try {
        allStudentNamesList = JSON.parse(cachedNames);
        populateSelect(allStudentNamesList, true);
      } catch (e) {}
    }
  }

  if (!navigator.onLine) {
    if (allStudentNamesList.length === 0) {
      select.innerHTML = '<option value="">❌ لا يوجد اتصال بالإنترنت</option>';
    }
    return;
  }

  // 2) جلب أحدث نسخة مباشرة من قوقل شيت وتحديث الشاشة فوراً
  try {
    const nocacheParam = forceFresh ? `&nocache=1&t=${Date.now()}` : `&t=${Date.now()}`;
    const response = await fetch(`${API_URL}?action=getAllData${nocacheParam}`);
    const result = await response.json();

    if (result.status === 'success' && Array.isArray(result.names)) {
      allStudentNamesList = result.names;
      if (result.students) {
        allStudentsMemoryCache = result.students;
        safeSetStorage('allStudentsBulkData', JSON.stringify({
          names: result.names,
          students: result.students
        }));
      }
      safeSetStorage('allStudentNames', JSON.stringify(result.names));
      populateSelect(result.names, true);

      const activeStudent = document.getElementById('searchInput').value;
      if (activeStudent && allStudentsMemoryCache[activeStudent]) {
        applyStudentResult(allStudentsMemoryCache[activeStudent], false, true);
      }
      return;
    }

    const fallbackRes = await fetch(`${API_URL}?action=getNames&t=${Date.now()}`);
    const fallbackData = await fallbackRes.json();
    if (fallbackData.status === 'success' && Array.isArray(fallbackData.names)) {
      allStudentNamesList = fallbackData.names;
      safeSetStorage('allStudentNames', JSON.stringify(fallbackData.names));
      populateSelect(fallbackData.names, true);
    }
  } catch (error) {
    console.error(error);
    if (allStudentNamesList.length === 0) {
      loadNamesFromCache();
    }
  }
}

function loadNamesFromCache() {
  const cachedNames = safeGetStorage('allStudentNames');
  const select = document.getElementById('searchInput');
  if (cachedNames) {
    allStudentNamesList = JSON.parse(cachedNames);
    populateSelect(allStudentNamesList);
  } else {
    select.innerHTML = '<option value="">❌ تعذر الاتصال بالخادم (تأكد من تحديث رابط API_URL في script.js)</option>';
  }
}

function populateSelect(names, preserveSelection = true) {
  const select = document.getElementById('searchInput');
  const currentVal = select.value;
  select.innerHTML = '<option value="">اختر اسم الطالب...</option>';

  names.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.innerText = name;
    select.appendChild(option);
  });

  if (preserveSelection && currentVal && names.includes(currentVal)) {
    select.value = currentVal;
    return;
  }

  const lastSearched = safeGetStorage('lastSearchName');
  if (lastSearched && names.includes(lastSearched)) {
    select.value = lastSearched;
    handleSearch(false);
  }
}

function filterStudentOptions() {
  const q = (document.getElementById('quickFilterInput').value || '').trim();
  if (!q) {
    populateSelect(allStudentNamesList, true);
    return;
  }
  const filtered = allStudentNamesList.filter(n => n.includes(q));
  populateSelect(filtered, true);
  if (filtered.length === 1) {
    document.getElementById('searchInput').value = filtered[0];
    handleSearch(false);
  }
}

window.addEventListener('offline', () => {
  const badge = document.getElementById('networkBadge');
  badge.className = 'network-badge offline';
  badge.innerText = '⚠️ انقطع الاتصال بالإنترنت! تتصفح النسخة المحفوظة محلياً.';
});

window.addEventListener('online', () => {
  const badge = document.getElementById('networkBadge');
  badge.className = 'network-badge online';
  badge.innerText = '✅ عاد الاتصال بالإنترنت! جاري تحديث البيانات...';

  setTimeout(() => { badge.style.display = 'none'; }, 3000);
  loadStudentNames(true);
});

async function handleSearch(forceLiveFetch = true) {
  const nameInput = document.getElementById('searchInput').value;
  const statusDiv = document.getElementById('statusMessage');
  const weeksContainer = document.getElementById('weeksContainer');
  const filterContainer = document.getElementById('filterContainer');
  const summaryBar = document.getElementById('studentSummaryBar');

  if (!nameInput) {
    weeksContainer.innerHTML = '';
    filterContainer.style.display = 'none';
    summaryBar.style.display = 'none';
    statusDiv.className = 'status-message error';
    statusDiv.innerText = '⚠️ الرجاء اختيار اسم الطالب للبحث عنه';
    return;
  }

  safeSetStorage('lastSearchName', nameInput);

  // 1) العرض الفوري اللحظي (0.00 ثانية) من الذاكرة حتى لا يشعر المستخدم بأي تأخير
  let displayedFromCache = false;
  if (allStudentsMemoryCache[nameInput]) {
    applyStudentResult(allStudentsMemoryCache[nameInput], !navigator.onLine);
    displayedFromCache = true;
  } else {
    const cachedSingle = safeGetStorage(`studentData_${nameInput}`);
    if (cachedSingle) {
      try {
        applyStudentResult(JSON.parse(cachedSingle), !navigator.onLine);
        displayedFromCache = true;
      } catch (e) {}
    }
  }

  if (!navigator.onLine) {
    if (!displayedFromCache) {
      loadFromLocalStorage(nameInput, statusDiv, filterContainer);
    }
    return;
  }

  if (!displayedFromCache) {
    weeksContainer.innerHTML = '';
    filterContainer.style.display = 'none';
    summaryBar.style.display = 'none';
    statusDiv.className = 'status-message loading';
    statusDiv.innerText = '⚡ جاري جلب الخطة...';
  }

  // 2) في نفس اللحظة: جلب أحدث نسخة لهذا الطالب مباشرة من الشيت وتحديث الجدول أمامه فوراً إذا تغير شيء!
  if (forceLiveFetch || !displayedFromCache) {
    try {
      const response = await fetch(`${API_URL}?name=${encodeURIComponent(nameInput)}&nocache=1&t=${Date.now()}`);
      const result = await response.json();

      if (result.status === 'success') {
        allStudentsMemoryCache[nameInput] = result;
        safeSetStorage(`studentData_${nameInput}`, JSON.stringify(result));
        // إذا كان الطالب ما يزال هو المختار حالياً، نحدّث الجدول فوراً مع الحفاظ على الأسبوع المختار
        if (document.getElementById('searchInput').value === nameInput) {
          applyStudentResult(result, false, displayedFromCache);
        }
      } else if (!displayedFromCache) {
        statusDiv.className = 'status-message error';
        statusDiv.innerText = `❌ ${result.message}`;
      }
    } catch (error) {
      console.error(error);
      if (!displayedFromCache) {
        loadFromLocalStorage(nameInput, statusDiv, filterContainer);
      }
    }
  }
}

function loadFromLocalStorage(nameInput, statusDiv, filterContainer) {
  const cachedData = safeGetStorage(`studentData_${nameInput}`);

  if (cachedData) {
    const result = JSON.parse(cachedData);
    applyStudentResult(result, true);
  } else {
    statusDiv.className = 'status-message error';
    statusDiv.innerText = '❌ تعذر جلب بيانات الطالب من الخادم، ولا توجد نسخة محفوظة له.';
  }
}

function applyStudentResult(result, isOffline, preserveWeekFilter = false) {
  const statusDiv = document.getElementById('statusMessage');
  const filterContainer = document.getElementById('filterContainer');
  const previousSelectedWeek = document.getElementById('weekSelect').value;

  statusDiv.className = 'status-message success';
  statusDiv.innerText = isOffline
    ? `🔄 (وضع عدم الاتصال) تم عرض بيانات الطالب: ${result.studentName}`
    : `✅ الطالب: ${result.studentName} — الأسبوع الحالي: ${result.currentWeekNum}`;

  allWeeksData = result.weeks || [];
  currentWeekNumber = result.currentWeekNum || 1;

  renderStudentSummary(result);
  populateWeekSelect(allWeeksData, currentWeekNumber, preserveWeekFilter ? previousSelectedWeek : null);
  filterContainer.style.display = 'flex';
  filterWeeks();
}

function renderStudentSummary(result) {
  const summaryBar = document.getElementById('studentSummaryBar');
  const info = result.planInfo || {};
  let pillsHtml = `<span class="summary-pill primary">👤 ${result.studentName}</span>`;
  if (result.studentNumber) {
    pillsHtml += `<span class="summary-pill">رقم الطالب: ${result.studentNumber}</span>`;
  }
  if (info.direction) {
    pillsHtml += `<span class="summary-pill emerald">الاتجاه: ${info.direction}</span>`;
  }
  if (info.hifdhQuota && info.hifdhQuota !== "-") {
    pillsHtml += `<span class="summary-pill amber">ورد الحفظ: ${info.hifdhQuota} ص</span>`;
  }
  if (info.reviewQuota && info.reviewQuota !== "-") {
    pillsHtml += `<span class="summary-pill primary">ورد المراجعة: ${info.reviewQuota} ص</span>`;
  }
  summaryBar.innerHTML = `<div class="summary-badges">${pillsHtml}</div>`;
  summaryBar.style.display = 'flex';
}

function populateWeekSelect(weeks, currentWeek, preservedValue = null) {
  const select = document.getElementById('weekSelect');
  select.innerHTML = '<option value="all">عرض جميع الأسابيع</option>';

  weeks.forEach((week) => {
    const option = document.createElement('option');
    option.value = week.weekNumber;
    option.innerText = week.title;
    select.appendChild(option);
  });

  if (preservedValue && (preservedValue === 'all' || weeks.some(w => w.weekNumber == preservedValue))) {
    select.value = preservedValue;
    return;
  }

  const hasCurrent = weeks.some(w => w.weekNumber == currentWeek);
  select.value = hasCurrent ? currentWeek : 'all';
}

function isWeekEmpty(week) {
  if (!week || !Array.isArray(week.data)) return true;
  return !week.data.some(row => row.slice(1).some(cell => String(cell || '').trim() !== '' && String(cell || '').trim() !== '-'));
}

function filterWeeks() {
  const selectedValue = document.getElementById('weekSelect').value;
  const hideEmpty = document.getElementById('hideEmptyWeeksToggle')?.checked;

  let filtered = allWeeksData;
  if (selectedValue !== 'all') {
    filtered = allWeeksData.filter(w => w.weekNumber == selectedValue);
  } else if (hideEmpty) {
    filtered = allWeeksData.filter(w => !isWeekEmpty(w) || w.isCurrent);
  }
  renderWeeks(filtered);
}

function isNonEmptyCell(v) {
  const s = String(v !== undefined && v !== null ? v : "").trim();
  return s !== "" && s !== "-";
}

function normalizeRowTo9Cols(row) {
  if (!Array.isArray(row)) return ["", "", "", "", "", "", "", "", ""];
  if (row.length >= 9) return row.slice(0, 9).map(c => String(c !== undefined && c !== null ? c : "").trim());
  if (row.length === 7) {
    const map7to9 = [0, 1, 2, 3, 4, 5, -1, -1, 6];
    return map7to9.map(i => (i >= 0 && row[i] !== undefined ? String(row[i]).trim() : ""));
  }
  const padded = row.map(c => String(c !== undefined && c !== null ? c : "").trim());
  while (padded.length < 9) padded.push("");
  return padded;
}

function buildSmartWeekTable(weekData) {
  const rows9 = (weekData || []).map(normalizeRowTo9Cols);

  const hasDualDayInWeek = rows9.some(r => {
    const hasRev = isNonEmptyCell(r[1]) || isNonEmptyCell(r[4]) || isNonEmptyCell(r[5]);
    const hasHifdh = isNonEmptyCell(r[2]) || isNonEmptyCell(r[6]) || isNonEmptyCell(r[7]);
    return hasRev && hasHifdh;
  });

  let headers = [];
  let processedRows = [];
  let portionColIndices = [];
  let badgeColIndices = [];

  if (!hasDualDayInWeek) {
    headers = MERGED_6_HEADERS.slice();
    portionColIndices = [1];
    badgeColIndices = [2, 5];

    processedRows = rows9.map(r => {
      const hasRev = isNonEmptyCell(r[1]) || isNonEmptyCell(r[4]) || isNonEmptyCell(r[5]);
      const hasHifdh = isNonEmptyCell(r[2]) || isNonEmptyCell(r[6]) || isNonEmptyCell(r[7]);

      const portion = isNonEmptyCell(r[1]) ? r[1] : r[2];
      const quota   = isNonEmptyCell(r[4]) ? r[4] : r[6];
      const done    = isNonEmptyCell(r[5]) ? r[5] : r[7];
      const rowType = hasHifdh && !hasRev ? "hifdh" : (hasRev && !hasHifdh ? "review" : "");

      return {
        cells: [r[0], portion, r[3], quota, done, r[8]],
        rowType: rowType
      };
    });
  } else {
    headers = FULL_9_HEADERS.slice();
    portionColIndices = [1, 2];
    badgeColIndices = [3, 8];

    processedRows = rows9.map(r => ({
      cells: r,
      rowType: "dual"
    }));
  }

  const activeCols = [];
  for (let c = 0; c < headers.length; c++) {
    if (c === 0) {
      activeCols.push(c);
      continue;
    }
    const hasVal = processedRows.some(pr => isNonEmptyCell(pr.cells[c]));
    if (hasVal || c === 1) {
      activeCols.push(c);
    }
  }

  return {
    headers: activeCols.map(c => headers[c]),
    rows: processedRows.map(pr => ({
      rowType: pr.rowType,
      cells: activeCols.map(c => ({
        val: pr.cells[c],
        origCol: c,
        isMergedMode: !hasDualDayInWeek,
        isPortion: portionColIndices.includes(c),
        isBadge: badgeColIndices.includes(c)
      }))
    }))
  };
}

function formatSmartCell(cellObj, rowType) {
  const val = String(cellObj.val !== undefined && cellObj.val !== null ? cellObj.val : "").trim();
  if (val === "") return "-";

  if (cellObj.isPortion) {
    let contentHtml = val;
    if (val.includes("/")) {
      const parts = val.split("/").map(p => p.trim());
      contentHtml = `<span class="portion-split">سورة مكتملة: ${parts[0]}</span><br><span>تكملة الورد: ${parts[1]}</span>`;
    }
    if (cellObj.isMergedMode && rowType === "hifdh") {
      return `<span class="type-tag hifdh">حفظ</span>${contentHtml}`;
    }
    if (cellObj.isMergedMode && rowType === "review") {
      return `<span class="type-tag review">مراجعة</span>${contentHtml}`;
    }
    return contentHtml;
  }

  if (cellObj.isBadge) {
    if (val === "أنجز" || val === "ممتاز") {
      return `<span class="badge-status badge-done">${val}</span>`;
    }
    if (val.includes("غياب") || val.includes("لم يسم") || val === "لم ينجز") {
      return `<span class="badge-status badge-not-done">${val}</span>`;
    }
    if (val.includes("جيد")) {
      return `<span class="badge-status badge-excused">${val}</span>`;
    }
  }

  return val;
}

function renderWeeks(weeks) {
  const container = document.getElementById('weeksContainer');
  container.innerHTML = '';

  if (!weeks || weeks.length === 0) {
    container.innerHTML = '<div class="status-message error" style="display:block;">لا توجد بيانات للعرض في هذا الفلتر.</div>';
    return;
  }

  weeks.forEach((week) => {
    const card = document.createElement('div');
    card.className = week.isCurrent ? 'week-card current-week' : 'week-card';

    let totalRevDone = 0;
    let totalHifdhDone = 0;
    (week.data || []).forEach(rawRow => {
      const r = normalizeRowTo9Cols(rawRow);
      const revDone = parseFloat(r[5]);
      const hifdhDone = parseFloat(r[7]);
      if (!isNaN(revDone)) totalRevDone += revDone;
      if (!isNaN(hifdhDone)) totalHifdhDone += hifdhDone;
    });

    const smartTable = buildSmartWeekTable(week.data);

    let statsChipsHtml = '';
    if (totalRevDone > 0) {
      statsChipsHtml += `<span class="week-stat-chip">منجز المراجعة: ${totalRevDone} ص</span>`;
    }
    if (totalHifdhDone > 0) {
      statsChipsHtml += `<span class="week-stat-chip">منجز الحفظ: ${totalHifdhDone} ص</span>`;
    }

    let cardHtml = `
      <div class="week-card-header">
        <h3>📅 ${week.title}</h3>
        <div class="week-stats">${statsChipsHtml}</div>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              ${smartTable.headers.map(h => `<th>${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
    `;

    smartTable.rows.forEach((rowObj) => {
      cardHtml += '<tr>';
      rowObj.cells.forEach((cellObj, idx) => {
        const tdClass = idx === 0 ? 'day-cell' : (cellObj.isPortion ? 'portion-cell' : '');
        cardHtml += `<td class="${tdClass}">${formatSmartCell(cellObj, rowObj.rowType)}</td>`;
      });
      cardHtml += '</tr>';
    });

    cardHtml += `
          </tbody>
        </table>
      </div>
    `;

    card.innerHTML = cardHtml;
    container.appendChild(card);
  });
}
