import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// This test verifies that PipeReader properly frees its internal buffer.
// The fix in SubprocessPipeReader.toOwnedSlice() ensures the buffer is
// shrunk to fit before transferring ownership, so consumers that track
// only the slice length (like Blob.Store.Bytes) correctly free all memory.

test("PipeReader buffer is properly freed after subprocess stdout consumption", async () => {
  const outputSize = 1024 * 1024; // 1MB per subprocess
  const iterations = 100;

  // Warm up to stabilize memory
  for (let i = 0; i < 5; i++) {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", `process.stdout.write("x".repeat(${outputSize}))`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = await new Response(proc.stdout).text();
    expect(text.length).toBe(outputSize);
    await proc.exited;
  }

  // Force GC and get baseline
  Bun.gc(true);
  await Bun.sleep(100);
  Bun.gc(true);
  const baselineRss = process.memoryUsage.rss();

  // Run many iterations - each reads 1MB of data
  for (let i = 0; i < iterations; i++) {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", `process.stdout.write("x".repeat(${outputSize}))`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "ignore",
    });

    const text = await new Response(proc.stdout).text();
    expect(text.length).toBe(outputSize);

    await proc.exited;
  }

  // Force GC and measure final
  Bun.gc(true);
  await Bun.sleep(200);
  Bun.gc(true);

  const finalRss = process.memoryUsage.rss();
  const rssGrowth = finalRss - baselineRss;

  // We processed 100MB of data total (100 iterations * 1MB each)
  // If buffers are being properly freed, RSS should not grow significantly
  // Allow 50MB for normal variance, but a severe leak would show 100MB+ growth
  const maxAllowedGrowth = 50 * 1024 * 1024; // 50MB

  console.log(`Baseline RSS: ${(baselineRss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Final RSS: ${(finalRss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`RSS Growth: ${(rssGrowth / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Total data processed: ${((iterations * outputSize) / 1024 / 1024).toFixed(0)} MB`);

  expect(rssGrowth).toBeLessThan(maxAllowedGrowth);
}, 300000);
