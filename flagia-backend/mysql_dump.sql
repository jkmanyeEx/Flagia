-- Flagia Database Schema
-- MySQL 8.0+

CREATE DATABASE IF NOT EXISTS flagia_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE flagia_db;

-- ==========================================
-- Users Table
-- ==========================================
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('TEACHER', 'STUDENT') NOT NULL DEFAULT 'STUDENT',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_email (email),
  INDEX idx_users_role (role)
) ENGINE=InnoDB;

-- ==========================================
-- Assignments Table
-- ==========================================
CREATE TABLE IF NOT EXISTS assignments (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  teacher_id VARCHAR(36) NOT NULL,
  title VARCHAR(500) NOT NULL,
  due_date DATETIME NOT NULL,
  time_limit INT NOT NULL DEFAULT 60 COMMENT 'Minutes',
  text_limit INT NOT NULL DEFAULT 3000 COMMENT 'Character count',
  max_score INT NOT NULL DEFAULT 100 COMMENT 'Maximum score possible',
  template_text TEXT COMMENT 'Markdown guideline template',
  mode ENUM('STRICT', 'STANDARD', 'RESEARCH', 'CREATIVE') NOT NULL DEFAULT 'STANDARD',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_assignments_teacher (teacher_id),
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
  status ENUM('IN_PROGRESS', 'SUBMITTED', 'FORCE_CLOSED') NOT NULL DEFAULT 'IN_PROGRESS',
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
