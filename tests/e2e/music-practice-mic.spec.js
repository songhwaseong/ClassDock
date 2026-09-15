const { test, expect, chromium } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collapseSidebar } = require("./helpers");

// 🎤 따라 부르기. 여기서만 확인할 수 있는 것 — 실제 getUserMedia → AnalyserNode → 음높이 찾기 →
// 따라치기 채점까지가 한 줄로 이어지는지. 크롬의 가짜 마이크에 "학교종"을 한 옥타브 낮게 부른
// WAV 를 물려(옥타브 통과 규칙도 함께 본다) 끝까지 맞게 따라 불렀다고 나오는지 본다.

const RATE = 48000;
const MIDI_TO_FREQ = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
// 학교종: 솔솔라라 솔솔미 솔솔미미 레 — 한 옥타브 아래(G3=55)로 부른다
const MELODY = [55, 55, 57, 57, 55, 55, 52, 55, 55, 52, 52, 50];

function singingWav(file){
  const parts = [];
  const silence = (ms) => parts.push(new Float32Array(Math.round(RATE * ms / 1000)));
  const sing = (midi, ms) => {
    const n = Math.round(RATE * ms / 1000), freq = MIDI_TO_FREQ(midi), out = new Float32Array(n);
    for (let i = 0; i < n; i++){
      const env = Math.min(1, i / 800, (n - i) / 800);
      const t = i / RATE;
      out[i] = env * 0.35 * (Math.sin(2 * Math.PI * freq * t) + 0.5 * Math.sin(4 * Math.PI * freq * t)
        + 0.25 * Math.sin(6 * Math.PI * freq * t));
    }
    parts.push(out);
  };
  silence(2000);                                      // 첫 음을 들려주는 동안(마이크를 막는 시간)보다 길게
  for (const midi of MELODY){ sing(midi, 420); silence(180); }
  silence(3000);
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const buffer = Buffer.alloc(44 + total * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + total * 2, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(RATE, 24); buffer.writeUInt32LE(RATE * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(total * 2, 40);
  let offset = 44;
  for (const part of parts){
    for (const value of part){ buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), offset); offset += 2; }
  }
  fs.writeFileSync(file, buffer);
}

test("가짜 마이크로 학교종을 부르면 끝까지 맞게 따라 부른 것으로 채점한다", async ({ baseURL }) => {
  test.setTimeout(60_000);
  const wav = path.join(os.tmpdir(), `classdock-sing-${Date.now()}.wav`);
  singingWav(wav);
  const browser = await chromium.launch({ args:[
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"
  ] });
  try {
    const page = await browser.newPage({ baseURL });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
    });
    await collapseSidebar(page);
    await page.goto("/");
    await page.evaluate(() => {
      const sheet = musicExampleSheet("school-bell");
      return handleFiles([new File([musicSerialize(sheet)], "학교종.msheet", { type:"application/json" })], { isScratch:true });
    });
    await expect(page.locator(".music-score svg").last()).toBeVisible({ timeout:15_000 });
    // 도구 갈래 중 따라치기가 든 탭을 연다
    const micBtn = page.locator(".music-practice-mic").last();
    for (const tab of await page.locator(".music-tab").all()){
      if (await micBtn.isVisible()) break;
      await tab.click();
    }
    await micBtn.click();
    await expect(micBtn).toHaveClass(/is-on/, { timeout:10_000 });
    await expect(page.locator(".music-practice-mic-meter").last()).toBeVisible();
    // 다 부르면 따라치기가 저절로 끝나고 마이크 단추가 꺼진다
    await expect(micBtn).not.toHaveClass(/is-on/, { timeout:30_000 });
    await expect(page.locator(".toast", { hasText:"다 따라 불렀어요" }).last()).toContainText("정확도 100%");
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    fs.rmSync(wav, { force:true });
  }
});
