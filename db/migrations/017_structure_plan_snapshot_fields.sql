ALTER TABLE suite_workbench.plan_snapshots
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'legacy_plan',
  ADD COLUMN IF NOT EXISTS confirmation_status text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS structure_json jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_snapshots_phase_check') THEN
    ALTER TABLE suite_workbench.plan_snapshots
      ADD CONSTRAINT plan_snapshots_phase_check CHECK (phase IN ('legacy_plan', 'structure_plan'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_snapshots_confirmation_status_check') THEN
    ALTER TABLE suite_workbench.plan_snapshots
      ADD CONSTRAINT plan_snapshots_confirmation_status_check CHECK (confirmation_status IN ('draft', 'confirmed'));
  END IF;
END $$;
