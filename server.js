
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const pgSession = require("connect-pg-simple")(session);
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("render.com")
    ? { rejectUnauthorized: false }
    : process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
});

const SUBJECTS = [
  "English",
  "Kiswahili",
  "Essential Mathematics",
  "Core Mathematics",
  "Community Service Learning",
  "IRE",
  "CRE",
  "Business Studies",
  "Computer Science",
  "Agriculture",
  "Chemistry",
  "Biology"
];

function level(score) {
  score = Number(score);
  if (score >= 90) return "EE1";
  if (score >= 75) return "EE2";
  if (score >= 58) return "ME1";
  if (score >= 41) return "ME2";
  if (score >= 31) return "AE1";
  if (score >= 21) return "AE2";
  if (score >= 11) return "BE1";
  return "BE2";
}

function remark(lv) {
  return {
    EE1: "Excellent",
    EE2: "Very Good",
    ME1: "Good",
    ME2: "Fair",
    AE1: "Average",
    AE2: "Needs Improvement",
    BE1: "Basic Achievement",
    BE2: "Urgent Support Needed"
  }[lv] || "";
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subjects (
      name TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'teacher')),
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teacher_subjects (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT REFERENCES subjects(name) ON DELETE CASCADE,
      PRIMARY KEY (user_id, subject)
    );

    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      adm TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      stream TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS marks (
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      subject TEXT REFERENCES subjects(name) ON DELETE CASCADE,
      score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
      teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, subject)
    );
  `);

  await pool.query(`INSERT INTO settings(key,value) VALUES('schoolName','KINNA SECONDARY SCHOOL') ON CONFLICT DO NOTHING`);
  await pool.query(`INSERT INTO settings(key,value) VALUES('className','Grade 10') ON CONFLICT DO NOTHING`);
  await pool.query(`INSERT INTO settings(key,value) VALUES('term','Term 1 2026') ON CONFLICT DO NOTHING`);

  for (const sub of SUBJECTS) {
    await pool.query(`INSERT INTO subjects(name) VALUES($1) ON CONFLICT DO NOTHING`, [sub]);
  }

  const adminCount = await pool.query(`SELECT COUNT(*) FROM users WHERE role='admin'`);
  if (Number(adminCount.rows[0].count) === 0) {
    await pool.query(
      `INSERT INTO users(name, username, role, password_hash) VALUES($1,$2,$3,$4)`,
      ["Admin", "admin", "admin", bcrypt.hashSync("KinnaAdmin@2026", 10)]
    );
  }

  const teacherCount = await pool.query(`SELECT COUNT(*) FROM users WHERE role='teacher'`);
  if (Number(teacherCount.rows[0].count) === 0) {
    for (let i = 1; i <= 14; i++) {
      await pool.query(
        `INSERT INTO users(name, username, role, password_hash) VALUES($1,$2,$3,$4)`,
        [`Teacher ${i}`, `teacher${i}`, "teacher", bcrypt.hashSync("Kinna@2026", 10)]
      );
    }
  }
}

function layout(title, body, user) {
  const nav = user ? `
    <div class="nav">
      <a href="/">Dashboard</a>
      ${user.role === "admin" ? `<a href="/students">Students</a><a href="/teachers">Teachers</a>` : ""}
      <a href="/marks">Marks Entry</a>
      <a href="/ranking">Ranking</a>
      <a href="/reports">Reports</a>
      <a href="/logout">Logout</a>
    </div>` : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header><h1>KINNA SECONDARY SCHOOL</h1><p>Grade 10 CBC Online Database System</p></header>
${nav}
<main>${body}</main>
</body>
</html>`;
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") return res.status(403).send("Admin only");
  next();
}

async function getSubjects() {
  const r = await pool.query(`SELECT name FROM subjects ORDER BY name`);
  return r.rows.map(x => x.name);
}

async function getRankedStudents() {
  const students = await pool.query(`SELECT * FROM students ORDER BY name`);
  const marks = await pool.query(`SELECT * FROM marks`);
  const arr = students.rows.map(st => {
    const ms = marks.rows.filter(m => m.student_id === st.id);
    const vals = ms.map(m => Number(m.score));
    const total = vals.reduce((a,b)=>a+b,0);
    const mean = vals.length ? total / vals.length : 0;
    const lv = level(mean);
    return {...st, marks: ms, subjectsTaken: vals.length, total, mean, level: lv, remark: remark(lv)};
  });
  arr.sort((a,b)=>b.mean-a.mean);
  return arr.map((s,i)=>({...s, rank:i+1}));
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  store: new pgSession({
    pool,
    tableName: "session",
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

app.get("/login", (req, res) => {
  res.send(layout("Login", `
    <section class="card login">
      <h2>Login</h2>
      <form method="post" action="/login">
        <label>Username</label>
        <input name="username" required>
        <label>Password</label>
        <input name="password" type="password" required>
        <button>Login</button>
      </form>
      <p class="hint">Admin: admin / KinnaAdmin@2026</p>
      <p class="hint">Teachers: teacher1 to teacher14 / Kinna@2026</p>
    </section>
  `, null));
});

app.post("/login", async (req, res) => {
  const r = await pool.query(`SELECT * FROM users WHERE username=$1`, [req.body.username]);
  const user = r.rows[0];
  if (!user || !bcrypt.compareSync(req.body.password, user.password_hash)) {
    return res.send(layout("Wrong login", `<section class="card"><h2>Wrong login</h2><a href="/login">Try again</a></section>`, null));
  }
  const subjects = await pool.query(`SELECT subject FROM teacher_subjects WHERE user_id=$1`, [user.id]);
  req.session.user = {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    subjects: subjects.rows.map(s => s.subject)
  };
  res.redirect("/");
});

app.get("/logout", (req,res)=>req.session.destroy(()=>res.redirect("/login")));

app.get("/", requireLogin, async (req,res)=>{
  const ranked = await getRankedStudents();
  const teachers = await pool.query(`SELECT COUNT(*) FROM users WHERE role='teacher'`);
  res.send(layout("Dashboard", `
    <section class="card">
      <h2>Welcome, ${req.session.user.name}</h2>
      <div class="grid">
        <div class="box"><b>${ranked.length}</b><span>Learners</span></div>
        <div class="box"><b>${teachers.rows[0].count}</b><span>Teachers</span></div>
        <div class="box"><b>${ranked[0] ? ranked[0].mean.toFixed(1) : "0"}</b><span>Top Mean</span></div>
      </div>
    </section>
  `, req.session.user));
});

app.get("/students", requireAdmin, async (req,res)=>{
  const r = await pool.query(`SELECT * FROM students ORDER BY name`);
  res.send(layout("Students", `
    <section class="card">
      <h2>Add Learner</h2>
      <form method="post" action="/students" class="inline-form">
        <input name="adm" placeholder="Adm No" required>
        <input name="name" placeholder="Learner Name" required>
        <input name="stream" placeholder="Stream">
        <button>Add</button>
      </form>
    </section>
    <section class="card">
      <h2>Learners</h2>
      <table><tr><th>Adm</th><th>Name</th><th>Stream</th><th>Action</th></tr>
      ${r.rows.map(s=>`<tr><td>${s.adm}</td><td>${s.name}</td><td>${s.stream||""}</td><td><form method="post" action="/students/delete"><input type="hidden" name="id" value="${s.id}"><button class="danger">Delete</button></form></td></tr>`).join("")}
      </table>
    </section>
  `, req.session.user));
});

app.post("/students", requireAdmin, async (req,res)=>{
  try {
    await pool.query(`INSERT INTO students(adm,name,stream) VALUES($1,$2,$3)`, [req.body.adm, req.body.name, req.body.stream || ""]);
  } catch(e) {}
  res.redirect("/students");
});

app.post("/students/delete", requireAdmin, async (req,res)=>{
  await pool.query(`DELETE FROM students WHERE id=$1`, [req.body.id]);
  res.redirect("/students");
});

app.get("/teachers", requireAdmin, async (req,res)=>{
  const users = await pool.query(`SELECT * FROM users WHERE role='teacher' ORDER BY username`);
  const subjects = await getSubjects();
  const assignments = await pool.query(`SELECT * FROM teacher_subjects`);
  res.send(layout("Teachers", `
    <section class="card">
      <h2>Teachers & Subject Assignment</h2>
      <table>
        <tr><th>Name</th><th>Username</th><th>Assigned Subjects</th><th>Update</th></tr>
        ${users.rows.map(u=>{
          const assigned = assignments.rows.filter(a=>a.user_id===u.id).map(a=>a.subject);
          return `<tr>
            <form method="post" action="/teachers/update">
              <td><input name="name" value="${u.name}"></td>
              <td>${u.username}<input type="hidden" name="id" value="${u.id}"></td>
              <td class="left">${subjects.map(sub=>`<label><input type="checkbox" name="subjects" value="${sub}" ${assigned.includes(sub)?"checked":""}> ${sub}</label><br>`).join("")}</td>
              <td><input name="password" type="password" placeholder="New password optional"><button>Save</button></td>
            </form>
          </tr>`;
        }).join("")}
      </table>
    </section>
  `, req.session.user));
});

app.post("/teachers/update", requireAdmin, async (req,res)=>{
  await pool.query(`UPDATE users SET name=$1 WHERE id=$2`, [req.body.name, req.body.id]);
  if (req.body.password) {
    await pool.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [bcrypt.hashSync(req.body.password, 10), req.body.id]);
  }
  await pool.query(`DELETE FROM teacher_subjects WHERE user_id=$1`, [req.body.id]);
  const subs = Array.isArray(req.body.subjects) ? req.body.subjects : (req.body.subjects ? [req.body.subjects] : []);
  for (const sub of subs) {
    await pool.query(`INSERT INTO teacher_subjects(user_id, subject) VALUES($1,$2) ON CONFLICT DO NOTHING`, [req.body.id, sub]);
  }
  res.redirect("/teachers");
});

app.get("/marks", requireLogin, async (req,res)=>{
  const subjects = req.session.user.role === "admin" ? await getSubjects() : req.session.user.subjects;
  const selectedSubject = req.query.subject || subjects[0] || "";
  const students = await pool.query(`SELECT * FROM students ORDER BY name`);
  const marks = await pool.query(`SELECT * FROM marks WHERE subject=$1`, [selectedSubject]);

  const rows = students.rows.map(st=>{
    const existing = marks.rows.find(m=>m.student_id===st.id);
    return `<tr><td>${st.adm}</td><td>${st.name}</td><td>${st.stream||""}</td><td><input type="number" min="0" max="100" name="score_${st.id}" value="${existing ? existing.score : ""}"></td></tr>`;
  }).join("");

  res.send(layout("Marks Entry", `
    <section class="card">
      <h2>Marks Entry</h2>
      ${subjects.length ? `
      <form method="get" action="/marks" class="inline-form">
        <select name="subject" onchange="this.form.submit()">
          ${subjects.map(s=>`<option ${s===selectedSubject?"selected":""}>${s}</option>`).join("")}
        </select>
      </form>
      <form method="post" action="/marks">
        <input type="hidden" name="subject" value="${selectedSubject}">
        <table><tr><th>Adm</th><th>Name</th><th>Stream</th><th>${selectedSubject} Mark</th></tr>${rows}</table>
        <button>Save Marks</button>
      </form>` : `<p>No subject assigned. Ask admin to assign subject.</p>`}
    </section>
  `, req.session.user));
});

app.post("/marks", requireLogin, async (req,res)=>{
  const subject = req.body.subject;
  if (req.session.user.role !== "admin" && !req.session.user.subjects.includes(subject)) return res.status(403).send("Subject not assigned.");

  const students = await pool.query(`SELECT * FROM students`);
  for (const st of students.rows) {
    const raw = req.body["score_" + st.id];
    if (raw === "") {
      await pool.query(`DELETE FROM marks WHERE student_id=$1 AND subject=$2`, [st.id, subject]);
    } else {
      const score = Math.max(0, Math.min(100, Number(raw)));
      await pool.query(
        `INSERT INTO marks(student_id, subject, score, teacher_id, updated_at)
         VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)
         ON CONFLICT(student_id, subject)
         DO UPDATE SET score=$3, teacher_id=$4, updated_at=CURRENT_TIMESTAMP`,
        [st.id, subject, score, req.session.user.id]
      );
    }
  }
  res.redirect("/marks?subject=" + encodeURIComponent(subject));
});

app.get("/ranking", requireLogin, async (req,res)=>{
  const ranked = await getRankedStudents();
  res.send(layout("Ranking", `
    <section class="card">
      <h2>Grade 10 Ranking</h2>
      <a class="button" href="/export">Export CSV</a>
      <table>
        <tr><th>Rank</th><th>Adm</th><th>Name</th><th>Stream</th><th>Subjects</th><th>Total</th><th>Mean</th><th>Level</th><th>Remark</th></tr>
        ${ranked.map(s=>`<tr><td>${s.rank}</td><td>${s.adm}</td><td>${s.name}</td><td>${s.stream||""}</td><td>${s.subjectsTaken}</td><td>${s.total}</td><td>${s.mean.toFixed(2)}</td><td>${s.level}</td><td>${s.remark}</td></tr>`).join("")}
      </table>
    </section>
  `, req.session.user));
});

app.get("/reports", requireLogin, async (req,res)=>{
  const ranked = await getRankedStudents();
  const selected = Number(req.query.student || 0);
  const st = ranked.find(s=>s.id === selected);
  let report = "";
  if (st) {
    const rows = st.marks.map(m=>`<tr><td>${m.subject}</td><td>${m.score}</td><td>${level(m.score)}</td><td>${remark(level(m.score))}</td></tr>`).join("");
    report = `
      <section class="report" id="printArea">
        <div class="report-head"><h2>KINNA SECONDARY SCHOOL</h2><h3>GRADE 10 CBC LEARNER'S REPORT</h3></div>
        <div class="report-grid">
          <div><b>Name:</b> ${st.name}</div><div><b>Adm:</b> ${st.adm}</div>
          <div><b>Stream:</b> ${st.stream||""}</div><div><b>Position:</b> ${st.rank} out of ${ranked.length}</div>
        </div>
        <table><tr><th>Learning Area</th><th>Score</th><th>Level</th><th>Comment</th></tr>${rows}</table>
        <p><b>Total:</b> ${st.total}</p>
        <p><b>Mean:</b> ${st.mean.toFixed(2)}</p>
        <p><b>Overall Level:</b> ${st.level}</p>
        <p><b>Class Teacher Comment:</b> ${st.remark}</p>
        <div class="signatures"><span>Class Teacher</span><span>Principal</span><span>Parent/Guardian</span></div>
      </section>`;
  }
  res.send(layout("Reports", `
    <section class="card no-print">
      <h2>Reports</h2>
      <form method="get" action="/reports" class="inline-form">
        <select name="student" onchange="this.form.submit()">
          <option value="">Select learner</option>
          ${ranked.map(s=>`<option value="${s.id}" ${s.id===selected?"selected":""}>${s.rank}. ${s.name}</option>`).join("")}
        </select>
      </form>
      ${st ? `<button onclick="window.print()">Print Report</button>` : ""}
    </section>
    ${report}
  `, req.session.user));
});

app.get("/export", requireLogin, async (req,res)=>{
  const subjects = await getSubjects();
  const ranked = await getRankedStudents();
  const header = ["Rank","Adm","Name","Stream","Subjects Taken",...subjects,"Total","Mean","Level","Remark"];
  const lines = [header];
  ranked.forEach(st=>{
    const map = {};
    st.marks.forEach(m=>map[m.subject]=m.score);
    lines.push([st.rank,st.adm,st.name,st.stream||"",st.subjectsTaken,...subjects.map(s=>map[s]||""),st.total,st.mean.toFixed(2),st.level,st.remark]);
  });
  const csv = lines.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  res.header("Content-Type","text/csv");
  res.attachment("Kinna_Grade10_CBC_Ranking.csv");
  res.send(csv);
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`App running on port ${PORT}`));
}).catch(err => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});
