-- Flagia Database Schema
-- MySQL 8.0+

CREATE DATABASE IF NOT EXISTS flagia CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE flagia;

-- ==========================================
-- Users Table
-- ==========================================
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('TEACHER', 'STUDENT', 'ADMIN') NOT NULL DEFAULT 'STUDENT',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_email (email),
  INDEX idx_users_role (role)
) ENGINE=InnoDB;

-- ==========================================
-- Classrooms Table
-- A teacher-owned group. Always has a join code; students join via code.
-- ==========================================
CREATE TABLE IF NOT EXISTS classrooms (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  teacher_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  join_code VARCHAR(8) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_classrooms_teacher (teacher_id)
) ENGINE=InnoDB;

-- ==========================================
-- Classroom Members (student enrolment)
-- ==========================================
CREATE TABLE IF NOT EXISTS classroom_members (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  classroom_id VARCHAR(36) NOT NULL,
  student_id VARCHAR(36) NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_classroom_student (classroom_id, student_id),
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_cm_student (student_id)
) ENGINE=InnoDB;

-- ==========================================
-- Assignments Table
-- classroom_id is nullable: assignments may belong to a classroom OR be
-- standalone (legacy direct-join via the assignment's own join_code).
-- ==========================================
CREATE TABLE IF NOT EXISTS assignments (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  teacher_id VARCHAR(36) NOT NULL,
  classroom_id VARCHAR(36) NULL,
  title VARCHAR(500) NOT NULL,
  due_date DATETIME NOT NULL,
  time_limit INT NOT NULL DEFAULT 60 COMMENT 'Minutes',
  text_limit INT NOT NULL DEFAULT 3000 COMMENT 'Character count',
  max_score INT NOT NULL DEFAULT 100 COMMENT 'Maximum score possible',
  template_text TEXT COMMENT 'Markdown guideline template',
  mode ENUM('STRICT', 'STANDARD', 'RESEARCH', 'CREATIVE') NOT NULL DEFAULT 'STANDARD',
  join_code VARCHAR(8) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
  INDEX idx_assignments_teacher (teacher_id),
  INDEX idx_assignments_classroom (classroom_id),
  INDEX idx_assignments_due (due_date)
) ENGINE=InnoDB;

-- ==========================================
-- Submissions Table
-- ==========================================
CREATE TABLE IF NOT EXISTS submissions (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  assignment_id VARCHAR(36) NOT NULL,
  student_id VARCHAR(36) NOT NULL,
  final_markdown LONGTEXT,
  -- ASSIGNED = joined but editor never opened; IN_PROGRESS = actively writing
  status ENUM('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'FORCE_CLOSED') NOT NULL DEFAULT 'ASSIGNED',
  time_spent_sec INT NOT NULL DEFAULT 0 COMMENT 'Cumulative active writing seconds across sessions (excludes time away from the site)',
  score DECIMAL(5, 2) DEFAULT NULL COMMENT 'Teacher score',
  feedback TEXT DEFAULT NULL COMMENT 'Teacher feedback',
  submitted_at DATETIME DEFAULT NULL,

  -- Flagia Engine Analysis Results
  flagia_score DECIMAL(5,2) DEFAULT NULL COMMENT '0~100 human writing confidence',
  flag_status ENUM('GREEN', 'AMBER', 'RED') DEFAULT NULL,
  coefficient_of_variation DECIMAL(10,6) DEFAULT NULL COMMENT 'IKI Cv = stdev/mean',
  revision_ratio DECIMAL(10,4) DEFAULT NULL COMMENT 'totalKeystrokes / finalTextLen',
  total_paste_count INT DEFAULT 0,
  total_blur_duration DECIMAL(10,2) DEFAULT 0 COMMENT 'Seconds',

  -- v2: cached full analysis JSON
  analysis_json LONGTEXT DEFAULT NULL COMMENT 'JSON cache of full analysis result',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_assignment_student (assignment_id, student_id),
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_submissions_assignment (assignment_id),
  INDEX idx_submissions_student (student_id),
  INDEX idx_submissions_status (status)
) ENGINE=InnoDB;

-- ==========================================
-- Sessions Table (Independent writing sessions)
-- ==========================================
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  submission_id VARCHAR(36) NOT NULL,
  start_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_time DATETIME DEFAULT NULL,
  ip_address VARCHAR(45) DEFAULT NULL COMMENT 'IPv4/IPv6',
  user_agent TEXT DEFAULT NULL,
  events_blob LONGTEXT DEFAULT NULL COMMENT 'JSON array of raw telemetry events',

  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  INDEX idx_sessions_submission (submission_id),
  INDEX idx_sessions_time (start_time)
) ENGINE=InnoDB;
