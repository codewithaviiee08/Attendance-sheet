
/* ==========================================
   ABHI MANAGER - FIREBASE APPLICATION
   HTML + CSS + JavaScript
========================================== */

// 1. Firebase Console se actual config paste karein.
const firebaseConfig = {
  apiKey: "AIzaSy...YOUR_REAL_KEY",
  authDomain: "your-actual-project.firebaseapp.com",
  projectId: "your-actual-project",
  storageBucket: "your-actual-project.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
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

// 2. Firebase initialize
function initializeFirebase() {
  try {
    if (typeof firebase === "undefined") {
      throw new Error("Firebase SDK load nahi hua.");
    }

    const required = [
      firebaseConfig.apiKey,
      firebaseConfig.authDomain,
      firebaseConfig.projectId,
      firebaseConfig.appId
    ];

    if (required.some(v => !v || v.startsWith("YOUR_"))) {
      throw new Error(
        "script.js mein Firebase Console ki asli config paste karein."
      );
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    auth = firebase.auth();
    db = firebase.firestore();
    return true;
  } catch (error) {
    console.error(error);
    message("loginError", error.message, true);
    return false;
  }
}

// 3. Helpers
function message(id, text, error = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.style.color = error ? "#dc2626" : "#15803d";
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}

// 4. User-specific Firestore collections
function employeeCollection(uid = user?.uid) {
  if (!uid || !db) throw new Error("Login required.");
  return db.collection("users").doc(uid).collection("employees");
}

function attendanceCollection(uid = user?.uid) {
  if (!uid || !db) throw new Error("Login required.");
  return db.collection("users").doc(uid).collection("attendance");
}

// 5. Login
$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  message("loginError", "");

  if (!auth) {
    message("loginError", "Firebase config check karein.", true);
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
    console.error("Login error:", error.code, error.message);

    const errors = {
      "auth/invalid-email": "Email address sahi nahi hai.",
      "auth/invalid-credential": "Email ya password galat hai.",
      "auth/user-not-found": "Account nahi mila.",
      "auth/wrong-password": "Password galat hai.",
      "auth/too-many-requests": "Bahut attempts hue. Baad mein try karein.",
      "auth/network-request-failed": "Internet connection check karein.",
      "auth/operation-not-allowed": "Email/Password provider enable karein.",
      "auth/invalid-api-key": "Firebase API key check karein.",
      "auth/user-disabled": "Account disabled hai."
    };

    message(
      "loginError",
      errors[error.code] || `Login failed: ${error.code || error.message}`,
      true
    );
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in to Dashboard";
  }
});

// 6. Logout
$("logoutBtn").addEventListener("click", async () => {
  if (!auth) return;

  try {
    await auth.signOut();
  } catch (error) {
    console.error("Logout error:", error);
    message("attendanceMessage", "Logout failed.", true);
  }
});

// 7. Authentication state
authStateSetup();

function authStateSetup() {
  if (!initializeFirebase()) return;

  auth.onAuthStateChanged(async currentUser => {
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
    $("attendanceDate").value = today();
    $("reportMonth").value = today().slice(0, 7);
    $("todayLabel").textContent = new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });

    await refreshData();
  });
}

// 8. Add record
$("employeeForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!user) {
    message("employeeMessage", "Pehle login karein.", true);
    return;
  }

  const name = $("empName").value.trim();
  const code = $("empCode").value.trim();
  const rawSalary = $("empSalary").value;
  const salary = Number(rawSalary);
  const btn = $("addRecordBtn");

  if (
    !name || !code || code.includes("/") ||
    rawSalary === "" || !Number.isFinite(salary) || salary < 0
  ) {
    message("employeeMessage", "Valid details enter karein.", true);
    return;
  }

  const uid = user.uid;
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
    message("employeeMessage", "Record successfully saved.");
    await refreshData();
  } catch (error) {
    console.error("Record save error:", error);

    message(
      "employeeMessage",
      error.message === "DUPLICATE_RECORD"
        ? "Ye Record ID pehle se maujood hai."
        : error.code === "permission-denied"
          ? "Firestore permission denied. Security Rules check karein."
          : "Record save nahi hua. Console check karein.",
      true
    );
  } finally {
    btn.disabled = false;
    btn.textContent = "+ Add Record";
  }
});

// 9. Reload Firestore data
async function refreshData() {
  if (!user || loading) return;

  loading = true;
  const uid = user.uid;

  try {
    const [empSnap, attSnap] = await Promise.all([
      employeeCollection(uid).get(),
      attendanceCollection(uid).get()
    ]);

    if (!user || user.uid !== uid) return;

    employees = empSnap.docs.map(doc => ({
      ...doc.data(),
      code: doc.id
    }));

    attendanceRecords = attSnap.docs.map(doc => ({
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
    console.error("Data loading error:", error);
    message(
      "attendanceMessage",
      error.code === "permission-denied"
        ? "Firestore Rules permission deny kar rahe hain."
        : "Data load nahi hua. Firebase config aur internet check karein.",
      true
    );
  } finally {
    loading = false;
  }
}

// 10. Attendance date and salary month filters
$("attendanceDate").addEventListener("change", renderAttendance);
$("reportMonth").addEventListener("change", renderSalaryReport);

// 11. Render attendance table
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
            ${STATUSES.map(s => `
              <option value="${s}" ${status === s ? "selected" : ""}>${s}</option>
            `).join("")}
          </select>
        </td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll(".status-select").forEach(select => {
    select.addEventListener("change", saveAttendance);
  });
}

// 12. Save attendance
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
    message("attendanceMessage", "Invalid status.", true);
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
        attendanceRecords[index] = { ...attendanceRecords[index], ...record };
      } else {
        attendanceRecords.push({ ...record, id: docId });
      }
    }

    if (!user || user.uid !== uid) return;

    message(
      "attendanceMessage",
      status ? "Attendance saved successfully." : "Attendance mark removed."
    );

    renderSalaryReport();
    updateDashboard();
  } catch (error) {
    console.error("Attendance save error:", error);
    message(
      "attendanceMessage",
      error.code === "permission-denied"
        ? "Permission denied. Firestore Rules check karein."
        : "Attendance save nahi hui. Dobara try karein.",
      true
    );

    await refreshData();
  } finally {
    pendingSaves.delete(docId);
    if (user && user.uid === uid) renderAttendance();
  }
}

// 13. Monthly salary calculation
function getMonthlyStats(emp, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return {
      present: 0, absent: 0, halfDay: 0,
      weeklyOff: 0, deduction: 0, payableSalary: 0
    };
  }

  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();

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

// 14. Render salary report
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

// 15. Dashboard counters
function updateDashboard() {
  $("totalEmployees").textContent = employees.length;

  const records = attendanceRecords.filter(item => item.date === today());

  $("presentToday").textContent = records.filter(
    item => item.status === "Present"
  ).length;

  $("absentToday").textContent = records.filter(
    item => item.status === "Absent"
  ).length;

  renderSalaryReport();
}
