# Cherry Mini-App SDK Skills

AI-powered integration assistant for `@cherrydotfun/miniapp-sdk`.

## Available Skills

### `cherry-miniapp-integration`

Guides you through integrating the Cherry Mini-App SDK into any existing web3 application. The skill:

1. Discovers your app's structure (framework, wallet setup, UI components)
2. Asks what to hide when running inside Cherry
3. Walks through SDK installation and configuration step by step
4. Sets up conditional rendering for embedded vs standalone modes
5. Configures wallet adapter, navigation, and token verification

## Installation

### Claude Code

Copy the skill to your Claude Code skills directory:

```bash
cp -r skills/cherry-miniapp-integration ~/.claude/skills/
```

Or symlink it:

```bash
ln -s $(pwd)/skills/cherry-miniapp-integration ~/.claude/skills/cherry-miniapp-integration
```

Then invoke with `/cherry-miniapp-integration` in Claude Code.

### Codex

Copy the skill to the Codex skills directory:

```bash
cp -r skills/cherry-miniapp-integration ~/.agents/skills/
```

### Project-Level (CLAUDE.md)

Add to your project's `CLAUDE.md`:

```markdown
## Cherry Mini-App Integration

When integrating Cherry Mini-App SDK, follow the skill at:
`node_modules/@cherrydotfun/miniapp-sdk/skills/cherry-miniapp-integration/SKILL.md`
```

## Usage

In Claude Code or Codex, simply say:

> "Integrate Cherry Mini-App SDK into this project"

The skill will activate and guide you through the process.
