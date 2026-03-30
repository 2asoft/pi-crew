import { afterEach, test } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverAgents } from "./agent-discovery.js";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
    return;
  }

  process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

function createFixture(): { agentDir: string; projectDir: string } {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-agent-discovery-"));
  const agentDir = path.join(rootDir, "global-agent");
  const projectDir = path.join(rootDir, "project");

  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, ".pi"), { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  return { agentDir, projectDir };
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function findAgent(projectDir: string, name: string) {
  const agent = discoverAgents(projectDir).agents.find((entry) => entry.name === name);
  assert.ok(agent, `Expected bundled agent \"${name}\" to be discovered`);
  return agent;
}

test("jsonc config supports comments and trailing commas and overrides json in the same scope", () => {
  const { agentDir, projectDir } = createFixture();

  writeFile(
    path.join(agentDir, "pi-crew.json"),
    JSON.stringify(
      {
        agents: {
          scout: {
            model: "anthropic/claude-haiku-4-5",
          },
        },
      },
      null,
      2,
    ),
  );
  writeFile(
    path.join(agentDir, "pi-crew.jsonc"),
    `{
			// JSONC should override the JSON file in the same scope
			"agents": {
				"scout": {
					"model": "openai-codex/gpt-5.4",
				},
				"planner": {
					"thinking": "high",
				},
			},
		}`,
  );

  const scout = findAgent(projectDir, "scout");
  const planner = findAgent(projectDir, "planner");

  assert.equal(scout.model, "openai-codex/gpt-5.4");
  assert.equal(planner.thinking, "high");
});

test("config precedence is global json, global jsonc, project json, project jsonc", () => {
  const { agentDir, projectDir } = createFixture();

  writeFile(
    path.join(agentDir, "pi-crew.json"),
    JSON.stringify(
      {
        agents: {
          scout: {
            model: "anthropic/claude-haiku-4-5",
          },
          worker: {
            thinking: "low",
          },
        },
      },
      null,
      2,
    ),
  );
  writeFile(
    path.join(agentDir, "pi-crew.jsonc"),
    `{
			"agents": {
				"scout": {
					"model": "anthropic/claude-sonnet-4-6"
				},
				"planner": {
					"thinking": "high"
				}
			}
		}`,
  );
  writeFile(
    path.join(projectDir, ".pi", "pi-crew.json"),
    JSON.stringify(
      {
        agents: {
          scout: {
            model: "anthropic/claude-opus-4-1",
          },
          worker: {
            thinking: "medium",
          },
        },
      },
      null,
      2,
    ),
  );
  writeFile(
    path.join(projectDir, ".pi", "pi-crew.jsonc"),
    `{
			"agents": {
				"scout": {
					"model": "openai-codex/gpt-5.4"
				},
				"worker": {
					"model": "anthropic/claude-sonnet-4-6"
				}
			}
		}`,
  );

  const scout = findAgent(projectDir, "scout");
  const worker = findAgent(projectDir, "worker");
  const planner = findAgent(projectDir, "planner");

  assert.equal(scout.model, "openai-codex/gpt-5.4");
  assert.equal(worker.thinking, "medium");
  assert.equal(worker.model, "anthropic/claude-sonnet-4-6");
  assert.equal(planner.thinking, "high");
});

test("json files remain strict json", () => {
  const { agentDir, projectDir } = createFixture();

  writeFile(
    path.join(agentDir, "pi-crew.json"),
    `{
			// comments are invalid in .json files
			"agents": {
				"scout": {
					"model": "openai-codex/gpt-5.4",
				},
			}
		}`,
  );

  const discovery = discoverAgents(projectDir);
  const scout = discovery.agents.find((entry) => entry.name === "scout");

  assert.ok(scout, "Expected bundled agent \"scout\" to be discovered");
  assert.equal(scout.model, "anthropic/claude-haiku-4-5");
  assert.ok(
    discovery.warnings.some((warning) => warning.filePath.endsWith("pi-crew.json") && warning.message.includes("JSON could not be parsed")),
    "Expected an invalid JSON warning for pi-crew.json",
  );
});
