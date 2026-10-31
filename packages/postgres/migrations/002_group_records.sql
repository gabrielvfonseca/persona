-- Group chat records imported from WhatsApp exports. The id is a hash of
-- group, time, sender and text, so importing the same export twice adds nothing.
CREATE TABLE IF NOT EXISTS group_records (
  id         text PRIMARY KEY,
  group_name text NOT NULL,
  sender     text NOT NULL,
  text       text NOT NULL,
  ts         bigint NOT NULL,
  window_id  integer NOT NULL
);
CREATE INDEX IF NOT EXISTS group_records_group_ts_idx ON group_records (group_name, ts);
