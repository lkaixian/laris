-- A fourth AI mode: the Assistant may read the business's own records (masked) to answer. It needs its own consent (disclosure version 2).
ALTER TABLE tenant_ai DROP CONSTRAINT IF EXISTS tenant_ai_mode_check;
ALTER TABLE tenant_ai ADD CONSTRAINT tenant_ai_mode_check CHECK (mode IN ('off','guide','guide_data','rag'));
