-- v1.2 W6: operators acknowledge alerts with a note. An acknowledged open alert stays open (the dedupe key keeps
-- repeats from creating a second row) but stops counting toward the sidebar badge.
ALTER TABLE alerts ADD COLUMN acked_at TEXT;
ALTER TABLE alerts ADD COLUMN acked_by TEXT;
ALTER TABLE alerts ADD COLUMN ack_note TEXT;
