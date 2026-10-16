📋 Attendance & Salary Management System

A responsive web application to manage employee attendance and calculate monthly salaries automatically using HTML, CSS, JavaScript, and Firebase.

🚀 Features
🔐 Login authentication with Firebase
👨‍💼 Add and manage employees
📅 Daily attendance tracking
✅ Present, Absent, Half Day, and Weekly Off options
💰 Automatic salary calculation
📊 Monthly attendance and salary reports
☁️ Cloud data storage using Firebase Firestore
📱 Responsive design for mobile and desktop
🛠️ Technologies Used
HTML5
CSS3
JavaScript
Firebase Authentication
Cloud Firestore
📂 Project Structure
attendance-salary-management-system/
├── index.html
├── style.css
├── script.js
└── README.md

⚙️ Installation and Setup
Clone this repository:
git clone https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git

Open the project folder.
Create a Firebase project at Firebase Console.
Enable Email/Password Authentication.
Create a Cloud Firestore database.
Copy your Firebase web configuration into script.js.
Configure Firestore security rules to restrict access to authorized users.
Run the application using a local development server or deploy it using Firebase Hosting.
💵 Salary Calculation

The application calculates salary based on monthly salary and attendance records.

Present: No deduction
Absent: One day's salary deducted
Half Day: Half day's salary deducted
Weekly Off: No deduction

Formula:

Daily Salary = Monthly Salary / Days in Month

Payable Salary = Monthly Salary
                  - Absent Deduction
                  - Half-Day Deduction


These are default calculation rules and can be customized according to company policies.

🔒 Security

Firebase Authentication and Firestore security rules should be configured before storing real employee data. Never publish passwords or private credentials in your repository.

🌟 Future Improvements
Export reports to Excel and PDF
Employee leave management
Overtime salary calculation
Admin and employee roles
Attendance history and payroll reports
👨‍💻 Author

Your Name

GitHub: Your GitHub Profile

📄 License

This project is available for learning and educational purposes. Add a suitable open-source license if you want others to reuse or modify your code.
