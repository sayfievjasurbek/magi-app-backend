// Monitoring domain: one type per table it owns, field for field from migrations/003_exam_schema.sql.
// The four media tables have the same shape; each has its own join table to an attempt.

type MediaRow = {
  id: number;
  url: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  reason: string | null;
};

export type PanoramicView = MediaRow;
export type VideoRecording = MediaRow;
export type FaceSnapshot = MediaRow;
export type Snapshot = MediaRow;

export type AssignmentPanoramicView = { assignment_id: number; panoramic_view_id: number };

export type AssignmentVideoRecording = { assignment_id: number; video_recording_id: number };

export type AssignmentFaceSnapshot = { assignment_id: number; face_snapshot_id: number };

export type AssignmentSnapshot = { assignment_id: number; snapshot_id: number };
