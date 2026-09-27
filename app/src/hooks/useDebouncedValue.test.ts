import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("only reflects the latest value after the delay, not every intermediate keystroke", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: "a" } });
    expect(result.current).toBe("a");

    rerender({ value: "ab" });
    act(() => vi.advanceTimersByTime(100));
    rerender({ value: "abc" });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("a"); // still not settled

    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe("abc");
  });
});
