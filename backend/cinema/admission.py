"""Finite SQLite admission budgets. Call mutation checks under BEGIN IMMEDIATE."""
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

MIB = 1024 * 1024
METADATA_ALLOWANCE = 128 * 1024
OUTPUT_LIMITS = {
    'script': (0, 0), 'preflight': (0, 0), 'image': (32 * MIB, 4),
    'video': (100 * MIB, 1), 'music': (8 * MIB, 1), 'render': (128 * MIB, 1),
}


class AdmissionError(Exception):
    def __init__(self, code, message, status=429):
        self.code, self.message, self.status = code, message, status


def _setting(name, default, maximum):
    try:
        value = int(os.environ.get('CINEMA_' + name, str(default)))
    except (ValueError, TypeError):
        value = 0
    if not 1 <= value <= maximum:
        raise ValueError(f'CINEMA_{name} must be an integer from 1 to {maximum}.')
    return value


@dataclass(frozen=True)
class Admission:
    directory: Path
    pending_session: int
    pending_global: int
    accepted_session: int
    accepted_global: int
    bytes_session: int
    bytes_global: int
    assets_session: int
    assets_global: int
    disk_headroom: int
    sessions_global: int
    projects_session: int
    projects_global: int
    project_bytes_session: int
    project_bytes_global: int
    connections_per_provider: int
    connections_global: int
    connection_bytes_global: int

    @classmethod
    def from_env(cls, directory):
        return cls(
            Path(directory),
            _setting('MAX_PENDING_JOBS_PER_SESSION', 2, 100),
            _setting('MAX_PENDING_JOBS_GLOBAL', 8, 1000),
            _setting('MAX_ACCEPTED_JOBS_PER_SESSION', 40, 10000),
            _setting('MAX_ACCEPTED_JOBS_GLOBAL', 1000, 100000),
            _setting('MAX_ASSET_BYTES_PER_SESSION', 512 * MIB, 1024**4),
            _setting('MAX_ASSET_BYTES_GLOBAL', 20 * 1024**3, 10 * 1024**4),
            _setting('MAX_ASSETS_PER_SESSION', 256, 100000),
            _setting('MAX_ASSETS_GLOBAL', 10000, 1000000),
            _setting('MIN_FREE_DISK_BYTES', 1024**3, 1024**4),
            _setting('MAX_SESSIONS_GLOBAL', 512, 100000),
            _setting('MAX_PROJECTS_PER_SESSION', 128, 10000),
            _setting('MAX_PROJECTS_GLOBAL', 2048, 100000),
            _setting('MAX_PROJECT_BYTES_PER_SESSION', 64 * MIB, 1024**4),
            _setting('MAX_PROJECT_BYTES_GLOBAL', 512 * MIB, 10 * 1024**4),
            _setting('MAX_CONNECTIONS_PER_PROVIDER', 2, 100),
            _setting('MAX_CONNECTIONS_GLOBAL', 1024, 100000),
            _setting('MAX_CONNECTION_BYTES_GLOBAL', 10 * MIB, 1024**3),
        )

    def check_session(self, c, now):
        if c.execute('SELECT COUNT(*) FROM sessions').fetchone()[0] >= self.sessions_global:
            # Reclaim only expired ownership records with no retained data.
            # Never remove projects, job history, media or live connections.
            c.execute('''DELETE FROM sessions WHERE expires<=?
                AND NOT EXISTS(SELECT 1 FROM projects WHERE session=sessions.id)
                AND NOT EXISTS(SELECT 1 FROM jobs WHERE session=sessions.id)
                AND NOT EXISTS(SELECT 1 FROM assets WHERE session=sessions.id)
                AND NOT EXISTS(SELECT 1 FROM connections WHERE session=sessions.id)''', (now,))
        if c.execute('SELECT COUNT(*) FROM sessions').fetchone()[0] >= self.sessions_global:
            raise AdmissionError('SESSION_LIMIT', 'The retained visitor allowance is full. Existing visitors can continue; contact the service operator.')
        self.check_disk(c, additional=4096)

    def check_connection(self, c, sid, provider, secret_len):
        now = time.time()
        c.execute('DELETE FROM connections WHERE expires<=?', (now,))
        row = c.execute('''SELECT COUNT(*) AS total_count,
            COALESCE(SUM(CASE WHEN session=? AND provider=? THEN 1 ELSE 0 END),0) AS user_provider_count,
            COALESCE(SUM(length(secret)),0) AS total_bytes
            FROM connections''', (sid, provider)).fetchone()
        if row['user_provider_count'] >= self.connections_per_provider:
            raise AdmissionError('CONNECTION_LIMIT', 'Maximum active connections for this provider reached. Revoke an old connection first.')
        if row['total_count'] >= self.connections_global:
            raise AdmissionError('CONNECTION_LIMIT', 'The active connection allowance is full. Revoke an old connection or contact the service operator.')
        if row['total_bytes'] + secret_len > self.connection_bytes_global:
            raise AdmissionError('CONNECTION_STORAGE_LIMIT', 'Encrypted connection storage is full. Revoke an old connection or contact the service operator.', 507)
        self.check_disk(c, additional=secret_len + 512)

    def check_project(self, c, sid, byte_size, *, replacing=None):
        rows = c.execute('''SELECT session, COUNT(*) AS count,
            COALESCE(SUM(length(CAST(document AS BLOB))),0) AS size
            FROM projects GROUP BY session''').fetchall()
        own = next((row for row in rows if row['session'] == sid), None)
        count, own_count = sum(row['count'] for row in rows), own['count'] if own else 0
        used, own_used = sum(row['size'] for row in rows), own['size'] if own else 0
        previous = 0
        if replacing is None:
            if count >= self.projects_global or own_count >= self.projects_session:
                raise AdmissionError('PROJECT_LIMIT', 'The retained project allowance is full. Existing projects remain available; contact the service operator.')
        else:
            row = c.execute('SELECT length(CAST(document AS BLOB)) AS size FROM projects WHERE id=? AND session=?', (replacing, sid)).fetchone()
            if row is None:
                raise AdmissionError('NOT_FOUND', 'Project not found.', 404)
            previous = row['size']
        growth = byte_size - previous
        # Lowered operator limits must not prevent shrinking an existing document.
        if growth > 0 and (used + growth > self.project_bytes_global or own_used + growth > self.project_bytes_session):
            raise AdmissionError('PROJECT_STORAGE_LIMIT', 'Saved project storage is full. Reduce the document or export existing work and contact the service operator.', 507)
        # Replacing a row can rewrite the full document into SQLite/WAL, even if
        # its quota delta is small. Keep queued media reservations available too.
        self.check_disk(c, additional=byte_size + 4096)

    def check_jobs(self, c, sid):
        rows = c.execute("SELECT session, status FROM jobs").fetchall()
        own = [r for r in rows if r['session'] == sid]
        if len(rows) >= self.accepted_global or len(own) >= self.accepted_session:
            raise AdmissionError('JOB_LIMIT', 'The retained job allowance is exhausted. Existing jobs remain available; contact the service operator.')
        pending = lambda rows: sum(r['status'] in ('queued', 'running') for r in rows)
        if pending(rows) >= self.pending_global or pending(own) >= self.pending_session:
            raise AdmissionError('QUEUE_FULL', 'The job queue is full. Wait for an existing job to finish.')

    def check_storage(self, c, sid, byte_size, count, *, credit_job=None, disk=True):
        # Content and UTF-8 metadata both count. A job can consume only its own
        # reservation; imports cannot take capacity promised to queued generation.
        rows = c.execute('SELECT session, COALESCE(SUM(length(content)+length(CAST(metadata AS BLOB))),0) AS size, COUNT(*) AS count FROM assets GROUP BY session').fetchall()
        used = sum(r['size'] for r in rows)
        own_used = sum(r['size'] for r in rows if r['session'] == sid)
        assets = sum(r['count'] for r in rows)
        own_assets = sum(r['count'] for r in rows if r['session'] == sid)
        reservations = c.execute('SELECT id, session, reserved_bytes, reserved_assets FROM jobs WHERE reserved_bytes>0 OR reserved_assets>0').fetchall()
        reserved = sum(r['reserved_bytes'] for r in reservations if r['id'] != credit_job)
        own_reserved = sum(r['reserved_bytes'] for r in reservations if r['id'] != credit_job and r['session'] == sid)
        reserved_assets = sum(r['reserved_assets'] for r in reservations if r['id'] != credit_job)
        own_reserved_assets = sum(r['reserved_assets'] for r in reservations if r['id'] != credit_job and r['session'] == sid)
        if used + reserved + byte_size > self.bytes_global or own_used + own_reserved + byte_size > self.bytes_session:
            raise AdmissionError('STORAGE_LIMIT', 'Media storage is full or reserved for pending jobs. Export existing work and contact the service operator.', 507)
        if assets + reserved_assets + count > self.assets_global or own_assets + own_reserved_assets + count > self.assets_session:
            raise AdmissionError('ASSET_LIMIT', 'The retained media item allowance is exhausted or reserved for pending jobs.', 507)
        if disk:
            # SQLite may hold both database and WAL copies during commit. Existing
            # assets already consume free space; outstanding writes need headroom.
            self.check_disk(c, additional=byte_size, credit_job=credit_job)

    def check_disk(self, c, *, additional=0, credit_job=None):
        reserved = c.execute('SELECT COALESCE(SUM(reserved_bytes),0) FROM jobs WHERE id IS NOT ?', (credit_job,)).fetchone()[0]
        if shutil.disk_usage(self.directory).free < self.disk_headroom + 2 * (reserved + additional):
            raise AdmissionError('STORAGE_UNAVAILABLE', 'Disk capacity is reserved or low. Contact the service operator before starting more work.', 507)

    def reservation(self, kind):
        byte_size, count = OUTPUT_LIMITS[kind]
        return byte_size + count * METADATA_ALLOWANCE, count

    def reserve(self, c, sid, kind):
        byte_size, count = self.reservation(kind)
        self.check_storage(c, sid, byte_size, count)
        return byte_size, count
