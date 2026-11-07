-- Keep historical review decisions and admit the edit actions the app records.
ALTER TABLE "kublai_room_detection_feedback"
  DROP CONSTRAINT "kublai_room_detection_feedback_decision_check";
ALTER TABLE "kublai_room_detection_feedback"
  ADD CONSTRAINT "kublai_room_detection_feedback_decision_check"
  CHECK (decision IN ('approved', 'rejected', 'pending', 'corrected', 'added', 'renamed', 'cleared'));
