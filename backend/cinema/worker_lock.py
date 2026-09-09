"""Process ownership for the single-worker SQLite backend on Linux and macOS."""
import errno
import fcntl
import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


class WorkerLockError(RuntimeError):
    """Another backend process already owns this data directory."""


@contextmanager
def acquire_worker_lock(directory: str | os.PathLike[str]) -> Iterator[None]:
    """Hold exclusive ownership throughout lifespan, before recovering any jobs.

    The persistent file is only an OS locking handle; its contents are ignored.
    Never unlink it on release, which could split ownership across two inodes.
    Closing the descriptor, including on process death, releases the lock.
    """
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(
        directory / '.worker.lock',
        os.O_RDWR | os.O_CREAT | os.O_CLOEXEC | os.O_NOFOLLOW,
        0o600,
    )
    try:
        os.fchmod(descriptor, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno in (errno.EACCES, errno.EAGAIN):
                raise WorkerLockError(
                    f'Another Slate backend worker already owns {directory}. '
                    'Run only one backend process per data directory.'
                ) from error
            raise
        yield
    finally:
        os.close(descriptor)
