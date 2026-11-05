# Cherry Mini-App SDK Skills

AI-powered integration assistant for `@cherrydotfun/miniapp-sdk`.

## Available Skills

### `cherry-miniapp-integration`

Guides you through integrating the Cherry Mini-App SDK into any existing web3 application. The skill:

1. Discovers your app's structure (framework, wallet setup, auth, backend, hosting)
2. Sets the framing headers Cherry needs (`frame-ancestors`)
3. Replaces connect/login flows with Cherry's seamless auth and verifies the launch token on your backend (Node, Python, Go)
4. Sets up conditional rendering for embedded vs standalone modes
5. Wires the Cherry wallet, wallet-limit/policy error handling, navigation and sharing
6. Adds the app reference key and, if you use Cherry Pay, the fee split
7. Walks through the listing-test checklist

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
