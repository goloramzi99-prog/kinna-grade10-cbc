KINNA SECONDARY SCHOOL - GRADE 10 CBC ONLINE DATABASE WEB APP

This version uses PostgreSQL database, so marks are saved permanently online.

DEFAULT LOGINS
Admin:
username: admin
password: KinnaAdmin@2026

Teachers:
username: teacher1 to teacher14
password: Kinna@2026

RENDER SETUP
1. Upload these files to GitHub.
2. In Render, create a PostgreSQL database.
3. Copy the database Internal Database URL.
4. Open your Web Service on Render.
5. Go to Environment.
6. Add:
   DATABASE_URL = your Render PostgreSQL Internal Database URL
   SESSION_SECRET = any long secret text, e.g. KinnaSecret2026Marks
7. Build Command:
   npm install
8. Start Command:
   npm start
9. Deploy.

After deployment:
- Login as admin.
- Go to Teachers.
- Assign subjects to teacher1-teacher14.
- Add students.
- Teachers login and enter marks.
- Use Ranking and Reports.
