from __future__ import annotations

import sys
import threading
from contextlib import contextmanager
from typing import Iterator

from app.runtime_paths import data_root


_PROCESS_LOCK = threading.RLock()
_LOCK_STATE = threading.local()


@contextmanager
def data_file_lock() -> Iterator[None]:
    """Serialize shared data access across both threads and processes."""
    with _PROCESS_LOCK:
        depth = getattr(_LOCK_STATE, "depth", 0)
        if depth:
            _LOCK_STATE.depth = depth + 1
            try:
                yield
            finally:
                _LOCK_STATE.depth -= 1
            return

        data_dir = data_root()
        data_dir.mkdir(parents=True, exist_ok=True)
        lock_path = data_dir / ".deepseekwrite.lock"
        with lock_path.open("a+b") as lock_file:
            if sys.platform.startswith("win"):
                import msvcrt  # noqa: PLC0415

                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)

                def unlock() -> None:
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl  # noqa: PLC0415

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)

                def unlock() -> None:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

            _LOCK_STATE.depth = 1
            try:
                yield
            finally:
                _LOCK_STATE.depth = 0
                lock_file.seek(0)
                unlock()
