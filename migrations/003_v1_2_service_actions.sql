-- v1.2 W4: service-level actions and agent jobs share the single pending slot of an environment.
ALTER TABLE environments ADD COLUMN pending_service_key TEXT;   -- set while pending_action is service_restart|service_reset
ALTER TABLE environments ADD COLUMN pending_job_id TEXT;        -- agent job id (ADAPTER=real only)
ALTER TABLE environments ADD COLUMN last_service_action_json TEXT;  -- {kind,serviceKey,outcome,correlationId,at,reason} of the last finished service action
