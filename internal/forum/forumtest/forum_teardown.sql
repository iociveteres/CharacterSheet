DO $$ BEGIN EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', current_setting('search_path')); END $$;
