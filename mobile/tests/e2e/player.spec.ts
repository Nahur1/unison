import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
const tone = readFileSync(new URL("../fixtures/tone.mp3", import.meta.url));
async function importTone(page: import("@playwright/test").Page) {
  await page.locator("input[type=file]").first().setInputFiles({
    name: "Evening.mp3",
    mimeType: "audio/mpeg",
    buffer: tone,
  });
  await expect(page.getByRole("status")).toContainText("files added");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Library", exact: true })
    .click();
  await page.getByRole("button", { name: /Evening Unknown artist/ }).click();
  await expect(
    page.getByRole("heading", { name: "Evening", exact: true }),
  ).toBeVisible();
}
test("phone and tablet layouts stay inside the viewport", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Now Playing" }),
  ).toBeVisible();
  for (const width of [320, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    await page.screenshot({
      path: `test-results/${info.project.name}-${width}-playing.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
test("real local audio, mute, seeking and persistence", async ({
  page,
}, info) => {
  test.skip(
    process.platform === "win32" && info.project.name === "iphone-webkit",
    "Windows WebKit cannot load even a standalone data-URL MP3 on this host; media tests run on macOS CI.",
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await importTone(page);
  if (await page.locator("video,audio").evaluate((v) => v.paused))
    await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator("video,audio")
        .evaluate((v) => (v as HTMLMediaElement).currentTime),
    )
    .toBeGreaterThan(0.5);
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  await expect(page.locator("video,audio")).toHaveJSProperty("muted", true);
  await page.getByRole("button", { name: "Unmute", exact: true }).click();
  await expect(page.locator("video,audio")).toHaveJSProperty("muted", false);
  await page.getByRole("slider", { name: "Playback position" }).fill("8");
  await expect
    .poll(() => page.locator("video,audio").evaluate((v) => v.currentTime))
    .toBeGreaterThan(7);
  await page.getByRole("button", { name: "Add to favorites" }).click();
  await page.getByRole("button", { name: "Playback tools" }).click();
  await page
    .getByRole("textbox", { name: "Bookmark note" })
    .fill("Remember this");
  await page.getByRole("button", { name: "Add bookmark" }).click();
  await expect(
    page.getByRole("button", { name: /Remember this/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close sheet" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.screenshot({
    path: `test-results/${info.project.name}-settings-light.png`,
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Library", exact: true })
    .click();
  await expect(
    page.locator(".track-main").filter({ hasText: "Evening" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(errors).toEqual([]);
});
test("real WASM translation, subtitle continuity and offline restart", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  await importTone(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Subtitles", exact: true })
    .click();
  await page
    .locator("input[type=file]")
    .nth(1)
    .setInputFiles({
      name: "lesson.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "1\n00:00:00,000 --> 00:00:08,000\nThe meeting has been moved to Thursday afternoon.\n\n2\n00:00:08,000 --> 00:00:20,000\nWe need to leave right now!",
      ),
    });
  await expect(
    page.getByRole("heading", { name: "2 subtitle cues" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Translate this subtitle" }).click();
  await expect(page.getByText("2 / 2 translated")).toBeVisible({
    timeout: 150000,
  });
  await expect(page.locator(".cue-list em")).toHaveCount(2);
  for (const text of await page.locator(".cue-list em").allTextContents())
    expect(text).toMatch(/[\u0600-\u06ff]/);
  await page.screenshot({
    path: `test-results/${info.project.name}-persian.png`,
    fullPage: true,
  });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Now Playing" }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Subtitles", exact: true })
    .click();
  await expect(page.locator(".cue-list em")).toHaveCount(2);
  // Subtitles with Persian shown start the offline engine by themselves.
  await expect(page.getByText("Ready offline", { exact: true })).toBeVisible({
    timeout: 60000,
  });
});

test("real video renders frames with subtitles and fullscreen controls", async ({
  page,
}, info) => {
  test.skip(
    process.platform === "win32" && info.project.name === "iphone-webkit",
    "WebKit media requires macOS CI.",
  );
  const file = info.project.name === "iphone-webkit" ? "film.mp4" : "film.webm";
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: file,
      mimeType: file.endsWith("mp4") ? "video/mp4" : "video/webm",
      buffer: readFileSync(new URL("../fixtures/" + file, import.meta.url)),
    });
  await expect(page.getByRole("status")).toContainText("files added");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Library", exact: true })
    .click();
  await page.getByRole("button", { name: "Videos", exact: true }).click();
  await page.locator(".track-main").click();
  if (await page.locator("video").evaluate((v) => v.paused))
    await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v) => v.getVideoPlaybackQuality().totalVideoFrames),
    )
    .toBeGreaterThan(0);
  await page
    .locator("input[type=file]")
    .nth(1)
    .setInputFiles({
      name: "film.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "1\n00:00:00,000 --> 00:00:05,000\nA film, together.",
      ),
    });
  await expect(page.locator(".caption-overlay")).toContainText(
    "A film, together.",
  );
  await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Exit fullscreen", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".fullscreen-controls")
      .getByRole("button", { name: "Mute", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-video-fullscreen.png`,
  });
  await page
    .getByRole("button", { name: "Exit fullscreen", exact: true })
    .click();
});
