
/*
  Firebase Console se apni Web App configuration yahan paste karein.
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

let user = null;
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
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function showMessage(id, message, error = false) {
  $(id).textContent = message;
  $(id).style.color = error ? "#dc2626" : "#15803d";
}

// All personal data belongs to the authenticated UID.
function employeeCollection() {
  return db.collection("users").doc(user.uid)
    .collection("employees");
}

function attendanceCollection() {
  return db.collection("users").doc(user.uid)
    .collection("attendance");
}

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
      "Login failed. Email, password aur Firebase settings check karein.",
      true
    );
  }
});

$("logoutBtn").addEventListener("click", () => auth.signOut());

auth.onAuthStateChanged(async (currentUser) => {
  user = currentUser;
  $("loginSection").hidden = !!user;
  $("appSection").hidden = !user;

  if (!user) {
    employees = [];
    attendanceRecords = [];
    $("attendanceBody").innerHTML = "";
    $("salaryBody").innerHTML = "";
    return;
  }

  $("attendanceDate").value = localDateString();
  $("reportMonth").value = localDateString().slice(0, 7);
  $("todayLabel").textContent = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  await refreshData();
});

// Add personal record
$("employeeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!user) return;

  const name = $("empName").value.trim();
  const code = $("empCode").value.trim();
  const salary = Number($("empSalary").value);

  if (!name || !code || code.includes("/") ||
      !Number.isFinite(salary) || salary < 0) {
    showMessage("employeeMessage", "Valid details enter karein.", true);
    return;
  }

  try {
    const ref = employeeCollection().doc(code);
    const existing = await ref.get();

    if (existing.exists) {
      showMessage("employeeMessage", "Ye ID pehle se maujood hai.", true);
      return;
    }

    await ref.set({
      name,
      code,
      monthlySalary: salary,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    $("employeeForm").reset();
    showMessage("employeeMessage", "Personal record successfully saved.");
    await refreshData();
  } catch (error) {
    console.error(error);
    showMessage("employeeMessage", "Save failed. Firebase rules check karein.", true);
  }
});

$("attendanceDate").addEventListener("change", () => {
  renderAttendance();
  updateDashboard();
});

$("reportMonth").addEventListener("change", renderSalaryReport);

async function refreshData() {
  if (!user) return;

  try {
    const [empSnapshot, attSnapshot] = await Promise.all([
      employeeCollection().get(),
      attendanceCollection().get()
    ]);

    employees = empSnapshot.docs.map((doc) => ({
      ...doc.data(),
      code: doc.id
    }));

    attendanceRecords = attSnapshot.docs.map((doc) => ({
      ...doc.data(),
      id: doc.id
    }));

    employees.sort((a, b) => a.name.localeCompare(b.name));

    renderAttendance();
    renderSalaryReport();
    updateDashboard();
  } catch (error) {
    console.error(error);
    alert("Data load failed. Firebase configuration aur rules check karein.");
  }
}

function renderAttendance() {
  const date = $("attendanceDate").value;
  const body = $("attendanceBody");

  if (!date) {
    body.innerHTML = "";
    return;
  }

  if (!employees.length) {
    body.innerHTML =
      '<tr><td colspan="3">Pehle apna personal record add karein.</td></tr>';
    return;
  }

  body.innerHTML = employees.map((employee) => {
    const record = attendanceRecords.find(
      (item) => item.date === date && item.employeeId === employee.code
    );

    const status = record?.status || "";
    const options = ["Present", "Absent", "Half Day", "Weekly Off"];

    return `
      <tr>
        <td>${escapeHTML(employee.code)}</td>
        <td>${escapeHTML(employee.name)}</td>
        <td>
          <select class="status-select"
            data-code="${escapeHTML(employee.code)}"
            aria-label="Attendance for ${escapeHTML(employee.name)}">
            <option value="" ${!status ? "selected" : ""}>Unmarked</option>
            ${options.map((option) =>
              `<option value="${option}" ${status === option ? "selected" : ""}>${option}</option>`
            ).join("")}
          </select>
        </td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll(".status-select").forEach((select) => {
    select.addEventListener("change", async () => {
      if (saving) {
        showMessage("attendanceMessage", "Please wait for the current save.", true);
        return;
      }

      const dateValue = $("attendanceDate").value;
      const code = select.dataset.code;
      const status = select.value;
      const documentId = `${dateValue}_${code}`;

      saving = true;
      select.disabled = true;

      try {
        const ref = attendanceCollection().doc(documentId);

        if (!status) {
          await ref.delete();
          attendanceRecords = attendanceRecords.filter(
            (item) => item.id !== documentId
          );
        } else {
          const record = {
            employeeId: code,
            date: dateValue,
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

        showMessage("attendanceMessage", "Attendance saved successfully.");
        renderSalaryReport();
        updateDashboard();
      } catch (error) {
        console.error(error);
        showMessage("attendanceMessage", "Save failed. Please try again.", true);
        await refreshData();
      } finally {
        saving = false;
        renderAttendance();
      }
    });
  });
}

function getMonthlyStats(employee, month) {
  const [year, monthNum] = month.split("-").map(Number);
  const days = new Date(year, monthNum, 0).getDate();

  const records = attendanceRecords.filter(
    (item) => item.employeeId === employee.code &&
      item.date.startsWith(month + "-")
  );

  const count = (status) =>
    records.filter((item) => item.status === status).length;

  const present = count("Present");
  const absent = count("Absent");
  const halfDay = count("Half Day");
  const weeklyOff = count("Weekly Off");

  const dailyRate = Number(employee.monthlySalary) / days;
  const deduction = dailyRate * (absent + halfDay * 0.5);

  return {
    present,
    absent,
    halfDay,
    weeklyOff,
    deduction,
    payableSalary: Math.max(0, Number(employee.monthlySalary) - deduction)
  };
}

function renderSalaryReport() {
  const month = $("reportMonth").value;
  const body = $("salaryBody");

  if (!month) {
    body.innerHTML = "";
    return;
  }

  if (!employees.length) {
    body.innerHTML = '<tr><td colspan="6">No personal records found.</td></tr>';
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
        <td><strong>${money(stats.payableSalary)}</strong><br>
          <small>Deduction: ${money(stats.deduction)}</small>
        </td>
      </tr>
    `;
  }).join("");

  $("totalSalary").textContent = money(total);
}

function updateDashboard() {
  $("totalEmployees").textContent = employees.length;

  const today = attendanceRecords.filter(
    (item) => item.date === $("attendanceDate").value
  );

  $("presentToday").textContent =
    today.filter((item) => item.status === "Present").length;

  $("absentToday").textContent =
    today.filter((item) => item.status === "Absent").length;

  renderSalaryReport();
}
