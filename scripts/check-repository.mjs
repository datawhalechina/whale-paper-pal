import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const root = new URL("..", import.meta.url);
const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
const pendingDeletes = new Set(git(["diff", "--name-only", "--diff-filter=D"]).split("\n").filter(Boolean));
const problems = [];

const forbidden = /^(?:node_modules|dist|output|tmp|src-tauri\/target|\.runtime|\.secrets|\.playwright-cli)\//;
for (const path of tracked) {
  if (forbidden.test(path)) problems.push(`生成物或本地状态被纳入 Git：${path}`);
  try {
    if (statSync(new URL(path, root)).size > 100 * 1024 * 1024) {
      problems.push(`文件超过 GitHub 单文件限制（100 MB）：${path}`);
    }
  } catch {
    if (pendingDeletes.has(path)) continue;
    problems.push(`Git 记录的文件在工作树中不存在：${path}`);
  }
}

const secretPattern = /(?:sk-[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN (?:RSA|OPENSSH|EC|DSA|PRIVATE) KEY-----)/;
for (const path of tracked) {
  if (/\.(?:png|webp|onnx|icns|ico|ttf|woff2?|pdf|pfb|bcmap|crx)$/i.test(path)) continue;
  let text;
  try {
    text = readFileSync(new URL(path, root), "utf8");
  } catch {
    continue;
  }
  if (secretPattern.test(text)) problems.push(`疑似凭据出现在跟踪文件中：${path}`);
}

if (problems.length) {
  console.error(problems.map((problem) => `- ${problem}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Repository hygiene check passed (${tracked.length} tracked files).`);
}
