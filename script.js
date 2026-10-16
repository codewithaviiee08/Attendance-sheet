
/* =========================================
   ABHI MANAGER - FIREBASE CONFIGURATION
   ========================================= */

// STEP 1:
// Firebase Console > Project settings > General
// > Your apps > Web app > Config
// Wahan se apni asli values yahan paste karein.

const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_STORAGE_BUCKET",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

const $ = id => document.getElementById(id);

let auth = null;
let db = null;
let user = null;
let employees = [];
let attendanceRecords = [];
let loading = false;
const pendingSaves = new Set();

const STATUSES = ["Present", "Absent", "Half Day", "Weekly Off"];

function showMessage(id, text, isError = false) {
  const el = $(id);
  if (!el) return;

  el.textContent = text;
  el.style.color = isError ? "#dc2626" : "#15803d";
}

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

// STEP 2: Validate Firebase configuration
function validateFirebaseConfig(config) {
  const required = [
    "apiKey",
    "authDomain",
    "projectId",
    "appId"
  ];

  for (const key of required) {
    const value = config[key];

    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.startsWith("PASTE_") ||
      value.startsWith("YOUR_")
    ) {
      throw new Error(
        `Firebase config missing hai: ${key}. Firebase Console se asli value paste karein.`
      );
    }
  }
}

// STEP 3: Initialize Firebase
function initializeFirebase() {
  try {
    if (typeof firebase === "undefined") {
      throw new Error(
        "Firebase SDK load nahi hua. Internet aur HTML script URLs check karein."
      );
    }

    validateFirebaseConfig(firebaseConfig);

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    auth = firebase.auth();
    db = firebase.firestore();

    console.log("Firebase initialized successfully.");
    return true;
  } catch (error) {
    console.error("Firebase initialization:", error);
    showMessage("loginError", error.message, true);
    return false;
  }
}

// User-specific Firestore collections
function employeeCollection(uid = user?.uid) {
  if (!uid) throw new Error("Login required.");
  return db.collection("users").doc(uid).collection("employees");
}

function attendanceCollection(uid = user?.uid) {
  if (!uid) throw new Error("Login required.");
  return db.collection("users").doc(uid).collection("attendance");
}

// STEP 4: Login
$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  showMessage("loginError", "");

  if (!auth) {
    showMessage(
      "loginError",
      "Firebase configuration pehle sahi karein.",
      true
    );
    return;
  }

  const email = $("email").value.trim();
  const password = $("password").value;
  const btn = $("loginBtn");

  btn.disabled = true;
  btn.textContent = "Signing in...";

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (error) {
    console.error("Firebase login error:", error.code, error.message);

    const messages = {
      "auth/invalid-email": "Email address galat format mein hai.",
      "auth/invalid-credential": "Email ya password galat hai.",
      "auth/user-not-found": "Firebase Authentication mein account nahi mila.",
      "auth/wrong-password": "Password galat hai.",
      "auth/too-many-requests": "Bahut login attempts hue. Baad mein try karein.",
      "auth/network-request-failed": "Internet connection check karein.",
      "auth/operation-not-allowed": "Firebase mein Email/Password enable karein.",
      "auth/invalid-api-key": "Firebase API key galat hai.",
      "auth/user-disabled": "Ye account disabled hai."
    };

    showMessage(
      "loginError",
      messages[error.code] || `Login failed: ${error.code || error.message}`,
      true
    );
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in to Dashboard";
  }
});

// STEP 5: Logout
$("logoutBtn").addEventListener("click", async () => {
  if (!auth) return;

  try {
    await auth.signOut();
  } catch (error) {
    console.error("Logout error:", error);
    showMessage("attendanceMessage", "Logout nahi hua.", true);
  }
});

// STEP 6: Authentication state
async function handleAuthState(currentUser) {
  user = currentUser;

  $("loginSection").hidden = !!user;
  $("appSection").hidden = !user;

  if (!user) {
    employees = [];
    attendanceRecords = [];
    pendingSaves.clear();

    $("attendanceBody").replaceChildren();
    $("salaryBody").replaceChildren();
    $("totalEmployees").textContent = "0";
    $("presentToday").textContent = "0";
    $("absentToday").textContent = "0";
    $("totalSalary").textContent = money(0);
    $("userEmail").textContent = "";
    return;
  }

  $("userEmail").textContent = user.email || "";
  $("attendanceDate").value = localDateString();
  $("reportMonth").value = localDateString().slice(0, 7);

  $("todayLabel").textContent = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  await refreshData();
}

// STEP 7: Add record
$("employeeForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!user) {
    showMessage("employeeMessage", "Pehle login karein.", true);
    return;
  }

  const name = $("empName").value.trim();
  const code = $("empCode").value.trim();
  const rawSalary = $("empSalary").value;
  const salary = Number(rawSalary);
  const btn = $("addRecordBtn");
  const uid = user.uid;

  if (
    !name ||
    !code ||
    code.includes("/") ||
    rawSalary === "" ||
    !Number.isFinite(salary) ||
    salary < 0
  ) {
    showMessage("employeeMessage", "Valid details enter karein.", true);
    return;
  }

  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const ref = employeeCollection(uid).doc(code);

    await db.runTransaction(async transaction => {
      const existing = await transaction.get(ref);

      if (existing.exists) {
        throw new Error("DUPLICATE_RECORD");
      }

      transaction.set(ref, {
        name,
        code,
        monthlySalary: salary,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    $("employeeForm").reset();
    showMessage("employeeMessage", "Record successfully saved.");
    await refreshData();
  } catch (error) {
    console.error("Record save error:", error);

    showMessage(
      "employeeMessage",
      error.message === "DUPLICATE_RECORD"
        ? "Ye Record ID pehle se maujood hai."
        : error.code === "permission-denied"
          ? "Firestore Rules ne permission deny ki."
          : "Record save nahi hua. Console check karein.",
      true
    );
  } finally {
    btn.disabled = false;
    btn.textContent = "+ Add Record";
  }
});

// STEP 8: Load Firestore data
async function refreshData() {
  if (!user || loading) return;

  loading = true;
  const uid = user.uid;

  try {
    const [empSnapshot, attSnapshot] = await Promise.all([
      employeeCollection(uid).get(),
      attendanceCollection(uid).get()
    ]);

    if (!user || user.uid !== uid) return;

    employees = empSnapshot.docs.map(doc => ({
      ...doc.data(),
      code: doc.id
    }));

    attendanceRecords = attSnapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id
    }));

    employees.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );

    renderAttendance();
    renderSalaryReport();
    updateDashboard();
  } catch (error) {
    console.error("Firestore load error:", error);

    showMessage(
      "attendanceMessage",
      error.code === "permission-denied"
        ? "Firestore Security Rules check karein."
        : "Data load nahi hua. Firebase configuration check karein.",
      true
    );
  } finally {
    loading = false;
  }
}

// STEP 9: Attendance controls
$("attendanceDate").addEventListener("change", () => {
  renderAttendance();
  updateDashboard();
});

$("reportMonth").addEventListener("change", renderSalaryReport);

function renderAttendance() {
  const date = $("attendanceDate").value;
  const body = $("attendanceBody");

  if (!date) {
    body.replaceChildren();
    return;
  }

  if (!employees.length) {
    body.innerHTML =
      '<tr><td colspan="3">Pehle ek record add karein.</td></tr>';
    return;
  }

  body.innerHTML = employees.map(emp => {
    const record = attendanceRecords.find(item =>
      item.date === date && item.employeeId === emp.code
    );

    const status = record?.status || "";
    const docId = `${date}_${emp.code}`;

    return `
      <tr>
        <td>${escapeHTML(emp.code)}</td>
        <td>${escapeHTML(emp.name)}</td>
        <td>
          <select class="status-select"
            data-code="${escapeHTML(emp.code)}"
            aria-label="Attendance for ${escapeHTML(emp.name)}"
            ${pendingSaves.has(docId) ? "disabled" : ""}>
            <option value="" ${!status ? "selected" : ""}>Unmarked</option>
            ${STATUSES.map(s =>
              `<option value="${s}" ${status === s ? "selected" : ""}>${s}</option>`
            ).join("")}
          </select>
        </td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll(".status-select").forEach(select => {
    select.addEventListener("change", saveAttendance);
  });
}

// STEP 10: Save attendance
async function saveAttendance(event) {
  const select = event.currentTarget;
  if (!user) return;

  const uid = user.uid;
  const date = $("attendanceDate").value;
  const code = select.dataset.code;
  const status = select.value;
  const docId = `${date}_${code}`;

  if (pendingSaves.has(docId)) return;

  if (status && !STATUSES.includes(status)) {
    showMessage("attendanceMessage", "Invalid attendance status.", true);
    return;
  }

  pendingSaves.add(docId);
  select.disabled = true;

  try {
    const ref = attendanceCollection(uid).doc(docId);

    if (!status) {
      await ref.delete();
      attendanceRecords = attendanceRecords.filter(
        item => item.id !== docId
      );
    } else {
      const record = {
        employeeId: code,
        date,
        status,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      await ref.set(record);

      const index = attendanceRecords.findIndex(item => item.id === docId);

      if (index >= 0) {
        attendanceRecords[index] = {
          ...attendanceRecords[index],
          ...record
        };
      } else {
        attendanceRecords.push({ ...record, id: docId });
      }
    }

    if (!user || user.uid !== uid) return;

    showMessage(
      "attendanceMessage",
      status ? "Attendance saved successfully." : "Attendance mark removed."
    );

    renderSalaryReport();
    updateDashboard();
  } catch (error) {
    console.error("Attendance save error:", error);

    showMessage(
      "attendanceMessage",
      error.code === "permission-denied"
        ? "Firestore permission denied. Rules check karein."
        : "Attendance save nahi hui. Dobara try karein.",
      true
    );

    await refreshData();
  } finally {
    pendingSaves.delete(docId);
    if (user && user.uid === uid) renderAttendance();
  }
}

// STEP 11: Calculate monthly salary
function getMonthlyStats(emp, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return {
      present: 0, absent: 0, halfDay: 0,
      weeklyOff: 0, deduction: 0, payableSalary: 0
    };
  }

  const [year, monthNum] = month.split("-").map(Number);
  const days = new Date(year, monthNum, 0).getDate();

  const records = attendanceRecords.filter(item =>
    item.employeeId === emp.code &&
    typeof item.date === "string" &&
    item.date.startsWith(month + "-")
  );

  const count = status =>
    records.filter(item => item.status === status).length;

  const present = count("Present");
  const absent = count("Absent");
  const halfDay = count("Half Day");
  const weeklyOff = count("Weekly Off");

  const salary = Math.max(0, Number(emp.monthlySalary) || 0);
  const dailyRate = salary / days;
  const deduction = Math.min(
    salary,
    dailyRate * (absent + halfDay * 0.5)
  );

  return {
    present,
    absent,
    halfDay,
    weeklyOff,
    deduction,
    payableSalary: Math.max(0, salary - deduction)
  };
}

// STEP 12: Render monthly salary report
function renderSalaryReport() {
  const month = $("reportMonth").value;
  const body = $("salaryBody");

  if (!month) {
    body.replaceChildren();
    $("totalSalary").textContent = money(0);
    return;
  }

  $("salaryMonthLabel").textContent = month;

  if (!employees.length) {
    body.innerHTML =
      '<tr><td colspan="6">No records found.</td></tr>';
    $("totalSalary").textContent = money(0);
    return;
  }

  let total = 0;

  body.innerHTML = employees.map(emp => {
    const stats = getMonthlyStats(emp, month);
    total += stats.payableSalary;

    return `
      <tr>
        <td>${escapeHTML(emp.name)}<br>
          <small>${escapeHTML(emp.code)}</small></td>
        <td>${stats.present}</td>
        <td>${stats.absent}</td>
        <td>${stats.halfDay}</td>
        <td>${stats.weeklyOff}</td>
        <td><strong>${money(stats.payableSalary)}</strong><br>
          <small>Deduction: ${money(stats.deduction)}</small></td>
      </tr>
    `;
  }).join("");

  $("totalSalary").textContent = money(total);
}

// STEP 13: Update dashboard counters
function updateDashboard() {
  $("totalEmployees").textContent = employees.length;

  const records = attendanceRecords.filter(
    item => item.date === $("attendanceDate").value
  );

  $("presentToday").textContent = records.filter(
    item => item.status === "Present"
  ).length;

  $("absentToday").textContent = records.filter(
    item => item.status === "Absent"
  ).length;

  renderSalaryReport();
}

// STEP 14: Start app only after initialization
if (initializeFirebase()) {
  auth.onAuthStateChanged(handleAuthState);
}
