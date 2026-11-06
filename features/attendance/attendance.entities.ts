// Attendance domain: one table, field for field from migrations/036_attendance.sql.

export type Attendance = {
  id: number;
  module_id: number;
  student_id: number;
  date: string;
  present: boolean;
  recorded_by: number;
  created_at: string;
  updated_at: string;
};

// a roster entry for one day - present is null for a student nobody has marked yet
export type AttendanceEntry = {
  student_id: number;
  present: boolean | null;
};
