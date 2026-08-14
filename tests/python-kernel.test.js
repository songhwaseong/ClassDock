const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const python = spawnSync("python", ["--version"], { encoding:"utf8" }).status === 0 ? "python" : "";

test("로컬 Python 커널은 셀 사이의 변수와 파일을 유지한다", { skip:!python }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "classdock-kernel-test-"));
  const runner = path.resolve(__dirname, "../desktop/python_kernel.py");
  const child = spawn(python, ["-u", "-X", "utf8", runner], {
    cwd:root,
    env:{ ...process.env, CLASSDOCK_KERNEL_ROOT:root, PYTHONIOENCODING:"utf-8" },
    stdio:["pipe", "pipe", "pipe"]
  });
  let stdout = "", stderr = "", waiting = null;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    stdout += chunk;
    const newline = stdout.indexOf("\n");
    if (newline < 0 || !waiting) return;
    const line = stdout.slice(0, newline).trim();
    stdout = stdout.slice(newline + 1);
    const resolve = waiting;
    waiting = null;
    resolve(JSON.parse(Buffer.from(line, "base64").toString("utf8")));
  });
  const execute = (source, stdin="") => new Promise((resolve, reject) => {
    if (waiting) return reject(new Error("커널 요청이 겹쳤습니다."));
    waiting = resolve;
    const request = Buffer.from(JSON.stringify({ action:"exec", source, stdin }), "utf8").toString("base64");
    child.stdin.write(request + "\n");
    setTimeout(() => {
      if (!waiting) return;
      waiting = null;
      reject(new Error("커널 응답 시간 초과: " + stderr));
    }, 10000).unref();
  });
  try {
    const first = await execute("value = 41\nprint('첫 셀')");
    assert.equal(first.ok, true);
    assert.match(first.stdout, /첫 셀/);

    const second = await execute("value + 1");
    assert.equal(second.ok, true);
    assert.equal(second.richOutputs[0].data["text/plain"], "42");
    assert.ok(second.variables.some(row => row.name === "value" && row.value === "41"));

    const inputResult = await execute("name = input()\nprint(name)", "커피\n");
    assert.equal(inputResult.stdout.trim(), "커피");

    const displayResult = await execute("%matplotlib inline\ndisplay({'brand': 'coffee'})");
    assert.equal(displayResult.ok, true);
    assert.match(displayResult.richOutputs[0].data["text/plain"], /coffee/);

    const mimeResult = await execute([
      "class RichOutput:",
      "    def _repr_mimebundle_(self):",
      "        return {",
      "            'image/png': b'PNG',",
      "            'text/latex': r'\\\\frac{a}{b}',",
      "            'application/vnd.plotly.v1+json': {'data': [], 'layout': {'title': 'demo'}}",
      "        }",
      "RichOutput()"
    ].join("\n"));
    assert.equal(mimeResult.ok, true);
    assert.equal(mimeResult.richOutputs[0].data["image/png"], "UE5H");
    assert.equal(mimeResult.richOutputs[0].data["text/latex"], "\\\\frac{a}{b}");
    assert.equal(
      mimeResult.richOutputs[0].data["application/vnd.plotly.v1+json"].layout.title,
      "demo"
    );

    const fileResult = await execute("open('result.txt', 'w', encoding='utf-8').write('ok')");
    assert.ok(fileResult.outputs.some(row => row.name === "result.txt" && row.size === 2));
  } finally {
    child.stdin.end();
    child.kill();
    if (child.exitCode == null){
      await new Promise(resolve => {
        child.once("exit", resolve);
        setTimeout(resolve, 3000).unref();
      });
    }
    fs.rmSync(root, { recursive:true, force:true });
  }
});
