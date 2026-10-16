
/* ==========================================
   ABHI'S PERSONAL ATTENDANCE MANAGER
   Firebase Login + Attendance + Salary
========================================== */

// IMPORTANT: Apni asli Firebase config yahan paste karein.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const $ = (id) => document.getElementById(id);

let auth = null;
let db = null;
let user = null;
let employees = [];
let attendanceRecords = [];
let loadingData = false;
const savingAttendance = new Set();

const STATUSES = ["Present", "Absent", "Half Day", "Weekly Off"];

// ---------- FIREBASE INITIALIZATION ----------

function initializeFirebase() {
  try {
    if (typeof firebase === "undefined") {
      throw new Error("Firebase SDK load nahi hua.");
    }

    const configValues = [
      firebaseConfig.apiKey,
      firebaseConfig.authDomain,
      firebaseConfig.projectId,
      firebaseConfig.appId
    ];

    if (configValues.some(
      value => !value || value.includes("YOUR_")
    )) {
      throw new Error(
        "script.js mein actual Firebase configuration paste karein."
      );
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    auth = firebase.auth();
    db = firebase.firestore();
    return true;

  } catch (error) {
    console.error("Firebase initialization:", error);
    showMessage("loginError", error.message, true);
    return false;
  }
}

// ---------- COMMON HELPERS ----------

function money(value) {
  const amount = Number(value) || 0;

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(amount);
}

function todayString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function showMessage(id, message, error = false) {
  const element = $(id);
  if (!element) return;

  element.textContent = message;
  element.style.color = error ? "#dc2626" : "#15803d";
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function databaseError(id, error) {
  console.error("Firebase error:", error.code, error.message);

  let message = "Operation failed. Dobara try karein.";

  if (error.code === "permission-denied") {
    message = "Firestore permission denied. Security Rules check karein.";
  } else if (error.code === "unavailable") {
    message = "Database unavailable hai. Internet check karein.";
  } else if (error.code === "unauthenticated") {
    message = "Session expire ho gaya. Dobara login karein.";
  }

  showMessage(id, message, true);
}

// ---------- USER DATA COLLECTIONS ----------

function employeeCollection(uid = user?.uid) {
  if (!db || !uid) throw new Error("Login required.");

  return db.collection("users").doc(uid).collection("employees");
}

function attendanceCollection(uid = user?.uid) {
  if (!db || !uid) throw new Error("Login required.");

  return db.collection("users").doc(uid).collection("attendance");
}

// ---------- LOGIN ----------

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  showMessage("loginError", "");

  if (!auth) {
    showMessage("loginError", "Firebase configuration check karein.", true);
    return;
  }

  const email = $("email").value.trim();
  const password = $("password").value;
  const button = $("loginForm").querySelector('[type="submit"]');

  button.disabled = true;
  button.textContent = "Logging in...";

  try {
    await auth.signInWithEmailAndPassword(email, password);

  } catch (error) {
    console.error("Login error:", error.code, error.message);

    const messages = {
      "auth/invalid-email": "Email address sahi nahi hai.",
      "auth/invalid-credential": "Email ya password galat hai.",
      "auth/user-not-found": "Account nahi mila.",
      "auth/wrong-password": "Password galat hai.",
      "auth/too-many-requests": "Bahut attempts hue. Baad mein try karein.",
      "auth/network-request-failed": "Internet connection check karein.",
      "auth/operation-not-allowed": "Email/Password sign-in enable karein.",
      "auth/invalid-api-key": "Firebase API key galat hai.",
      "auth/user-disabled": "Yeh account disabled hai."
    };

    showMessage(
      "loginError",
      messages[error.code] || `Login failed: ${error.code || error.message}`,
      true
    );

  } finally {
    button.disabled = false;
    button.textContent = "Login to Dashboard";
  }
});

// ---------- LOGOUT ----------

$("logoutBtn").addEventListener("click", async () => {
  if (!auth) return;

  try {
    await auth.signOut();
  } catch (error) {
    console.error("Logout error:", error);
    showMessage("attendanceMessage", "Logout failed.", true);
  }
});

// ---------- AUTH STATE ----------

function clearDashboard() {
  employees = [];
  attendanceRecords = [];
  savingAttendance.clear();

  $("attendanceBody").replaceChildren();
  $("salaryBody").replaceChildren();

  $("totalEmployees").textContent = "0";
  $("presentToday").textContent = "0";
  $("absentToday").textContent = "0";
  $("totalSalary").textContent = money(0);
}

function setupAuth() {
  if (!auth) return;

  auth.onAuthStateChanged(async currentUser => {
    user = currentUser;

    $("loginSection").hidden = !!user;
    $("appSection").hidden = !user;

    if (!user) {
      clearDashboard();
      return;
    }

    $("attendanceDate").value = todayString();
    $("reportMonth").value = todayString().slice(0, 7);

    $("todayLabel").textContent = new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });

    await refreshData();
  });
}

// ---------- ADD RECORD ----------

$("employeeForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!user || !db) {
    showMessage("employeeMessage", "Pehle login karein.", true);
    return;
  }

  const name = $("empName").value.trim();
  const code = $("empCode").value.trim();
  const rawSalary = $("empSalary").value;
  const salary = Number(rawSalary);
  const button = $("employeeForm").querySelector('[type="submit"]');

  if (
    !name || !code || code.includes("/") ||
    rawSalary.trim() === "" ||
    !Number.isFinite(salary) || salary < 0
  ) {
    showMessage("employeeMessage", "Valid details enter karein.", true);
    return;
  }

  const uid = user.uid;
  button.disabled = true;
  button.textContent = "Saving...";

  try {
    const ref = employeeCollection(uid).doc(code);

    // Existing record ko overwrite hone se bachata hai.
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);

      if (snapshot.exists) {
        const error = new Error("Yeh Record ID pehle se hai.");
        error.code = "duplicate-record";
        throw error;
      }

      transaction.set(ref, {
        name,
        code,
        monthlySalary: salary,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    $("employeeForm").reset();
    showMessage("employeeMessage", "Record successfully save ho gaya.");

    await refreshData();

  } catch (error) {
    if (error.code === "duplicate-record") {
      showMessage("employeeMessage", error.message, true);
    } else {
      databaseError("employeeMessage", error);
    }
  } finally {
    button.disabled = false;
    button.textContent = "+ Add Record";
  }
});

// ---------- FILTERS ----------

$("attendanceDate").addEventListener("change", renderAttendance);
$("reportMonth").addEventListener("change", renderSalaryReport);

// ---------- LOAD DATA ----------

async function refreshData() {
  if (!user || !db || loadingData) return;

  loadingData = true;
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
    databaseError("attendanceMessage", error);
  } finally {
    loadingData = false;
  }
}

// ---------- ATTENDANCE TABLE ----------

function renderAttendance() {
  const date = $("attendanceDate").value;
  const body = $("attendanceBody");

  if (!date) {
    body.replaceChildren();
    return;
  }

  if (!employees.length) {
    body.innerHTML =
      '<tr><td colspan="3">Pehle apna personal record add karein.</td></tr>';
    return;
  }

  body.innerHTML = employees.map(employee => {
    const record = attendanceRecords.find(item =>
      item.date === date && item.employeeId === employee.code
    );

    const status = record?.status || "";
    const documentId = `${date}_${employee.code}`;

    const options = STATUSES.map(option => `
      <option value="${option}" ${status === option ? "selected" : ""}>
        ${option}
      </option>
    `).join("");

    return `
      <tr>
        <td>${escapeHTML(employee.code)}</td>
        <td>${escapeHTML(employee.name)}</td>
        <td>
          <select
            class="status-select"
            data-code="${escapeHTML(employee.code)}"
            aria-label="Attendance for ${escapeHTML(employee.name)}"
            ${savingAttendance.has(documentId) ? "disabled" : ""}
          >
            <option value="" ${!status ? "selected" : ""}>Unmarked</option>
            ${options}
          </select>
        </td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll(".status-select").forEach(select => {
    select.addEventListener("change", saveAttendance);
  });
}

// ---------- SAVE ATTENDANCE ----------

async function saveAttendance(event) {
  const select = event.currentTarget;

  if (!user || !db) {
    showMessage("attendanceMessage", "Pehle login karein.", true);
    return;
  }

  const date = $("attendanceDate").value;
  const code = select.dataset.code;
  const status = select.value;

  if (!date || !code) return;

  if (status && !STATUSES.includes(status)) {
    showMessage("attendanceMessage", "Invalid status.", true);
    renderAttendance();
    return;
  }

  const documentId = `${date}_${code}`;

  if (savingAttendance.has(documentId)) return;

  const uid = user.uid;
  savingAttendance.add(documentId);
  select.disabled = true;

  try {
    const ref = attendanceCollection(uid).doc(documentId);

    if (!status) {
      await ref.delete();

      attendanceRecords = attendanceRecords.filter(
        item => item.id !== documentId
      );
    } else {
      const record = {
        employeeId: code,
        date,
        status,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      await ref.set(record);

      const index = attendanceRecords.findIndex(
        item => item.id === documentId
      );

      if (index >= 0) {
        attendanceRecords[index] = {
          ...attendanceRecords[index],
          ...record
        };
      } else {
        attendanceRecords.push({ ...record, id: documentId });
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
    databaseError("attendanceMessage", error);

    try {
      if (user && user.uid === uid) await refreshData();
    } catch (reloadError) {
      console.error(reloadError);
    }
  } finally {
    savingAttendance.delete(documentId);

    if (user && user.uid === uid) {
      renderAttendance();
    }
  }
}

// ---------- MONTHLY SALARY ----------

function getMonthlyStats(employee, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return {
      present: 0,
      absent: 0,
      halfDay: 0,
      weeklyOff: 0,
      deduction: 0,
      payableSalary: 0
    };
  }

  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();

  const records = attendanceRecords.filter(item =>
    item.employeeId === employee.code &&
    typeof item.date === "string" &&
    item.date.startsWith(month + "-")
  );

  const count = status =>
    records.filter(item => item.status === status).length;

  const present = count("Present");
  const absent = count("Absent");
  const halfDay = count("Half Day");
  const weeklyOff = count("Weekly Off");

  const salary = Math.max(0, Number(employee.monthlySalary) || 0);
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

// ---------- SALARY REPORT ----------

function renderSalaryReport() {
  const month = $("reportMonth").value;
  const body = $("salaryBody");

  if (!month) {
    body.replaceChildren();
    $("totalSalary").textContent = money(0);
    return;
  }

  if (!employees.length) {
    body.innerHTML =
      '<tr><td colspan="6">No personal records found.</td></tr>';

    $("totalSalary").textContent = money(0);
    return;
  }

  let total = 0;

  body.innerHTML = employees.map(employee => {
    const stats = getMonthlyStats(employee, month);
    total += stats.payableSalary;

    return `
      <tr>
        <td>
          ${escapeHTML(employee.name)}
          <br><small>${escapeHTML(employee.code)}</small>
        </td>
        <td>${stats.present}</td>
        <td>${stats.absent}</td>
        <td>${stats.halfDay}</td>
        <td>${stats.weeklyOff}</td>
        <td>
          <strong>${money(stats.payableSalary)}</strong>
          <br><small>Deduction: ${money(stats.deduction)}</small>
        </td>
      </tr>
    `;
  }).join("");

  $("totalSalary").textContent = money(total);
}

// ---------- DASHBOARD SUMMARY ----------

function updateDashboard() {
  $("totalEmployees").textContent = employees.length;

  const today = todayString();
  const records = attendanceRecords.filter(item => item.date === today);

  $("presentToday").textContent = records.filter(
    item => item.status === "Present"
  ).length;

  $("absentToday").textContent = records.filter(
    item => item.status === "Absent"
  ).length;

  renderSalaryReport();
}

// ---------- START APP ----------

if (initializeFirebase()) {
  setupAuth();
}
