
/*
  STEP 1:
  Firebase Console se apni Firebase configuration yahan paste karein.
*/
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

const $ = (id) => document.getElementById(id);

const loginSection = $("loginSection");
const appSection = $("appSection");
const attendanceDate = $("attendanceDate");
const reportMonth = $("reportMonth");

let employees = [];
let attendanceRecords = [];
let saving = false;

const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(value);

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function showMessage(id, message, isError = false) {
  const el = $(id);
  el.textContent = message;
  el.style.color = isError ? "#dc2626" : "#15803d";
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// LOGIN
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("loginError", "");

  try {
    await auth.signInWithEmailAndPassword(
      $("email").value.trim(),
      $("password").value
    );
  } catch (error) {
    showMessage(
      "loginError",
      "Login failed. Email/password check karein.",
      true
    );
  }
});

$("logoutBtn").addEventListener("click", () => auth.signOut());

auth.onAuthStateChanged(async (user) => {
  loginSection.hidden = !!user;
  appSection.hidden = !user;

  if (user) {
    attendanceDate.value = localDateString();
    reportMonth.value = localDateString().slice(0, 7);
    await refreshData();
  } else {
    employees = [];
    attendanceRecords = [];
    $("attendanceBody").innerHTML = "";
    $("salaryBody").innerHTML = "";
  }
});

// ADD EMPLOYEE
$("employeeForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = $("empName").value.trim();
  const code = $("empCode").value.trim();
  const salary = Number($("empSalary").value);

  if (!name || !code || !Number.isFinite(salary) || salary < 0) {
    showMessage("employeeMessage", "Valid details bharein.", true);
    return;
  }

  // Employee ID Firestore document ID hai.
  if (code.includes("/") || code === "." || code === "..") {
    showMessage("employeeMessage", "Employee ID mein / use na karein.", true);
    return;
  }

  try {
    const ref = db.collection("employees").doc(code);
    const existing = await ref.get();

    if (existing.exists) {
      showMessage("employeeMessage", "Ye Employee ID pehle se hai.", true);
      return;
    }

    await ref.set({
      name,
      code,
      monthlySalary: salary,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    $("employeeForm").reset();
    showMessage("employeeMessage", "Employee successfully add ho gaya.");
    await refreshData();
  } catch (error) {
    showMessage("employeeMessage", "Employee save nahi hua.", true);
    console.error(error);
  }
});

// ATTENDANCE DATE CHANGE
attendanceDate.addEventListener("change", renderAttendance);
reportMonth.addEventListener("change", renderSalaryReport);

async function refreshData() {
  try {
    const [employeeSnapshot, attendanceSnapshot] = await Promise.all([
      db.collection("employees").get(),
      db.collection("attendance").get()
    ]);

    employees = employeeSnapshot.docs.map((doc) => ({
      ...doc.data(),
      code: doc.id
    }));

    attendanceRecords = attendanceSnapshot.docs.map((doc) => ({
      ...doc.data(),
      id: doc.id
    }));

    employees.sort((a, b) => a.name.localeCompare(b.name));

    renderAttendance();
    renderSalaryReport();
    updateDashboard();
  } catch (error) {
    console.error(error);
    alert("Data load nahi hua. Firebase settings aur rules check karein.");
  }
}

// DAILY ATTENDANCE SHEET
function renderAttendance() {
  const date = attendanceDate.value;
  const body = $("attendanceBody");

  if (!date) {
    body.innerHTML = "";
    return;
  }

  if (!employees.length) {
    body.innerHTML =
      '<tr><td colspan="3">Pehle employee add karein.</td></tr>';
    return;
  }

  body.innerHTML = employees.map((employee) => {
    const record = attendanceRecords.find(
      (item) => item.date === date && item.employeeId === employee.code
    );

    const currentStatus = record?.status || "";

    return `
      <tr>
        <td>${escapeHTML(employee.code)}</td>
        <td>${escapeHTML(employee.name)}</td>
        <td>
          <select
            data-employee="${escapeHTML(employee.code)}"
            class="status-select"
            aria-label="Attendance for ${escapeHTML(employee.name)}"
          >
            <option value="" ${currentStatus === "" ? "selected" : ""}>
              Unmarked
            </option>
            <option value="Present" ${currentStatus === "Present" ? "selected" : ""}>
              Present
            </option>
            <option value="Absent" ${currentStatus === "Absent" ? "selected" : ""}>
              Absent
            </option>
            <option value="Half Day" ${currentStatus === "Half Day" ? "selected" : ""}>
              Half Day
            </option>
            <option value="Weekly Off" ${currentStatus === "Weekly Off" ? "selected" : ""}>
              Weekly Off
            </option>
          </select>
        </td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll(".status-select").forEach((select) => {
    select.addEventListener("change", async () => {
      if (saving) {
        showMessage("attendanceMessage", "Ek save complete hone dein.", true);
        return;
      }

      const employeeId = select.dataset.employee;
      const status = select.value;
      const documentId = `${date}_${employeeId}`;
      saving = true;
      select.disabled = true;

      try {
        const ref = db.collection("attendance").doc(documentId);

        if (!status) {
          await ref.delete();
          attendanceRecords = attendanceRecords.filter(
            (item) => item.id !== documentId
          );
        } else {
          const record = {
            employeeId,
            date,
            status,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          };

          await ref.set(record);

          const index = attendanceRecords.findIndex(
            (item) => item.id === documentId
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

        showMessage("attendanceMessage", "Attendance cloud mein save ho gayi.");
        renderSalaryReport();
        updateDashboard();
      } catch (error) {
        console.error(error);
        showMessage("attendanceMessage", "Save failed. Firebase rules check karein.", true);
        await refreshData();
      } finally {
        saving = false;
        renderAttendance();
      }
    });
  });
}

// MONTHLY SALARY CALCULATION
function getMonthlyStats(employee, month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();

  const records = attendanceRecords.filter((item) =>
    item.employeeId === employee.code &&
    item.date.startsWith(`${month}-`)
  );

  const count = (status) =>
    records.filter((item) => item.status === status).length;

  const present = count("Present");
  const absent = count("Absent");
  const halfDay = count("Half Day");
  const weeklyOff = count("Weekly Off");

  const dailyRate = Number(employee.monthlySalary) / daysInMonth;

  // Assumption: weekly off is paid.
  // Absent = one day's deduction; Half Day = half day's deduction.
  const deduction = dailyRate * (absent + halfDay * 0.5);
  const payableSalary = Math.max(
    0,
    Number(employee.monthlySalary) - deduction
  );

  return {
    present,
    absent,
    halfDay,
    weeklyOff,
    deduction,
    payableSalary
  };
}

function renderSalaryReport() {
  const month = reportMonth.value;
  const body = $("salaryBody");

  if (!month) {
    body.innerHTML = "";
    return;
  }

  if (!employees.length) {
    body.innerHTML =
      '<tr><td colspan="6">Koi employee add nahi hua.</td></tr>';
    $("totalSalary").textContent = money(0);
    return;
  }

  let total = 0;

  body.innerHTML = employees.map((employee) => {
    const stats = getMonthlyStats(employee, month);
    total += stats.payableSalary;

    return `
      <tr>
        <td>${escapeHTML(employee.name)}<br>
          <small>${escapeHTML(employee.code)}</small>
        </td>
        <td>${stats.present}</td>
        <td>${stats.absent}</td>
        <td>${stats.halfDay}</td>
        <td>${stats.weeklyOff}</td>
        <td>
          <strong>${money(stats.payableSalary)}</strong><br>
          <small>Deduction: ${money(stats.deduction)}</small>
        </td>
      </tr>
    `;
  }).join("");

  $("totalSalary").textContent = money(total);
}

// DASHBOARD
function updateDashboard() {
  $("totalEmployees").textContent = employees.length;

  const today = attendanceRecords.filter(
    (item) => item.date === attendanceDate.value
  );

  $("presentToday").textContent =
    today.filter((item) => item.status === "Present").length;

  $("absentToday").textContent =
    today.filter((item) => item.status === "Absent").length;

  renderSalaryReport();
}
