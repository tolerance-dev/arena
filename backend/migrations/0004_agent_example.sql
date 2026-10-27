-- example: the ready agent (agents.Examples slug: the CLI) an agent was made from, '' for an uploaded one. /my groups
-- agents by it, then by model. Agents made before it was stored get it back from their default name ("Codex · …").
ALTER TABLE agents ADD COLUMN IF NOT EXISTS example text NOT NULL DEFAULT '';

UPDATE agents SET example = CASE
        WHEN name LIKE 'Claude Code%' THEN 'claude-code'
        WHEN name LIKE 'Codex%' THEN 'codex'
        WHEN name LIKE 'Gemini CLI%' THEN 'gemini-cli'
        WHEN name LIKE 'Kimi Code%' THEN 'kimi-code'
        WHEN name LIKE 'OpenCode%' THEN 'opencode'
        ELSE '' END
    WHERE model <> '' AND example = '';
