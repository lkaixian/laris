-- An MCP key is an API key bound to one staff-class role; a key with no role cannot use /api/mcp. Deleting the role switches the key off.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles ON DELETE SET NULL;
ALTER TABLE ai_calls DROP CONSTRAINT IF EXISTS ai_calls_provider_check;
ALTER TABLE ai_calls ADD CONSTRAINT ai_calls_provider_check CHECK (provider IN ('ilmu','custom','mcp'));
