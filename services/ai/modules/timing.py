import time


class StageTimer:
    def __init__(self):
        self._t0 = time.perf_counter()
        self._last = self._t0
        self.timings_ms = {}

    def mark(self, key):
        now = time.perf_counter()
        self.timings_ms[key] = round((now - self._last) * 1000.0, 2)
        self._last = now

    def finish(self):
        now = time.perf_counter()
        self.timings_ms["total"] = round((now - self._t0) * 1000.0, 2)
        return self.timings_ms
