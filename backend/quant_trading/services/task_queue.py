"""Portable database task leasing with per-attempt ownership fencing."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Iterable

from sqlalchemy import and_, or_, select, update
from sqlalchemy.orm import Session

from quant_trading.models.recovery import Task, WorkerHeartbeat, utcnow


ACTIVE_TASK_STATUSES = ("claimed", "running")
TERMINAL_TASK_STATUSES = ("success", "failed", "canceled")


@dataclass(frozen=True, slots=True)
class LeaseToken:
    """The immutable fence for one worker's single claimed task attempt."""

    task_id: str
    worker_id: str
    attempt_count: int


class TaskQueue:
    """Lease tasks atomically without an external queue service.

    Every worker mutation carries a :class:`LeaseToken`.  An expired attempt
    cannot later finish, cancel, fail, or clear ownership after a new worker
    has claimed the task.
    """

    def __init__(self, db: Session, *, worker_id: str, lease_seconds: int):
        self.db = db
        self.worker_id = worker_id
        self.lease_seconds = max(1, int(lease_seconds))

    def _lease_until(self):
        return utcnow() + timedelta(seconds=self.lease_seconds)

    def heartbeat(self, current_task_id: str | None = None) -> WorkerHeartbeat:
        now = utcnow()
        heartbeat = self.db.get(WorkerHeartbeat, self.worker_id)
        if heartbeat is None:
            heartbeat = WorkerHeartbeat(
                worker_id=self.worker_id,
                last_seen_at=now,
                current_task_id=current_task_id,
            )
            self.db.add(heartbeat)
        else:
            heartbeat.last_seen_at = now
            heartbeat.current_task_id = current_task_id
        self.db.flush()
        return heartbeat

    def token_for(self, task: Task) -> LeaseToken:
        if task.worker_id != self.worker_id or task.attempt_count < 1:
            raise ValueError("task is not owned by this worker")
        return LeaseToken(task.id, self.worker_id, int(task.attempt_count))

    def _token(self, task: Task, token: LeaseToken | None) -> LeaseToken:
        if token is not None:
            if token.task_id != task.id or token.worker_id != self.worker_id:
                raise ValueError("invalid task lease token")
            return token
        return self.token_for(task)

    def _expire_exhausted_leases(self, now) -> None:
        self.db.execute(
            update(Task)
            .where(
                or_(
                    Task.status == "queued",
                    and_(
                        Task.status.in_(ACTIVE_TASK_STATUSES),
                        Task.lease_expires_at.is_not(None),
                        Task.lease_expires_at <= now,
                    ),
                ),
                Task.attempt_count >= Task.max_attempts,
            )
            .values(
                status="failed",
                progress=100,
                completed_at=now,
                lease_expires_at=None,
                worker_id=None,
                error_code="TASK_MAX_ATTEMPTS_EXCEEDED",
                error_message="Task exceeded its maximum attempt count",
            ),
            execution_options={"synchronize_session": False},
        )
        self.db.flush()

    def _candidate_ids(self, now) -> Iterable[str]:
        available = or_(
            Task.status == "queued",
            and_(
                Task.status.in_(ACTIVE_TASK_STATUSES),
                Task.lease_expires_at.is_not(None),
                Task.lease_expires_at <= now,
            ),
        )
        statement = (
            select(Task.id)
            .where(available, Task.attempt_count < Task.max_attempts)
            .order_by(Task.priority.desc(), Task.created_at.asc(), Task.id.asc())
        )
        if self.db.get_bind().dialect.name == "postgresql":
            statement = statement.with_for_update(skip_locked=True)
        return list(self.db.scalars(statement))

    def _cancel_unclaimed(self, now) -> Task | None:
        """Converge only a cancel request that has no live owner lease."""

        statement = (
            select(Task)
            .where(
                Task.status == "cancel_requested",
                or_(Task.worker_id.is_(None), Task.lease_expires_at.is_(None), Task.lease_expires_at <= now),
            )
            .order_by(Task.created_at.asc(), Task.id.asc())
        )
        if self.db.get_bind().dialect.name == "postgresql":
            statement = statement.with_for_update(skip_locked=True)
        task = self.db.scalar(statement)
        if task is None:
            return None
        changed = self.db.execute(
            update(Task)
            .where(
                Task.id == task.id,
                Task.status == "cancel_requested",
                or_(Task.worker_id.is_(None), Task.lease_expires_at.is_(None), Task.lease_expires_at <= now),
            )
            .values(
                status="canceled",
                progress=100,
                completed_at=now,
                lease_expires_at=None,
                worker_id=None,
            ),
            execution_options={"synchronize_session": False},
        )
        if changed.rowcount != 1:
            return None
        self.db.expire_all()
        canceled = self.db.get(Task, task.id)
        self.heartbeat(None)
        return canceled

    def claim_next(self) -> Task | None:
        """Claim a priority-ordered task, recovering only expired leases."""

        now = utcnow()
        self._expire_exhausted_leases(now)
        canceled = self._cancel_unclaimed(now)
        if canceled is not None:
            return canceled
        for task_id in self._candidate_ids(now):
            available = or_(
                Task.status == "queued",
                and_(
                    Task.status.in_(ACTIVE_TASK_STATUSES),
                    Task.lease_expires_at.is_not(None),
                    Task.lease_expires_at <= now,
                ),
            )
            claimed = self.db.execute(
                update(Task)
                .where(Task.id == task_id, available, Task.attempt_count < Task.max_attempts)
                .values(
                    status="claimed",
                    worker_id=self.worker_id,
                    claimed_at=now,
                    started_at=None,
                    lease_expires_at=self._lease_until(),
                    attempt_count=Task.attempt_count + 1,
                    error_code=None,
                    error_message=None,
                ),
                execution_options={"synchronize_session": False},
            )
            if claimed.rowcount != 1:
                continue
            self.db.expire_all()
            task = self.db.get(Task, task_id)
            if task is None:  # pragma: no cover - defensive against a deleted row
                continue
            self.heartbeat(task.id)
            return task
        self.heartbeat(None)
        return None

    @staticmethod
    def _active_fence(token: LeaseToken, now, statuses: tuple[str, ...]):
        return (
            Task.id == token.task_id,
            Task.worker_id == token.worker_id,
            Task.attempt_count == token.attempt_count,
            Task.status.in_(statuses),
            Task.lease_expires_at.is_not(None),
            Task.lease_expires_at > now,
        )

    def start(self, task: Task, *, token: LeaseToken | None = None) -> bool:
        """Move a fenced claim into running, honoring an in-lease cancel first."""

        token = self._token(task, token)
        now = utcnow()
        canceled = self.db.execute(
            update(Task)
            .where(*self._active_fence(token, now, ("cancel_requested",)))
            .values(
                status="canceled",
                progress=100,
                completed_at=now,
                lease_expires_at=None,
                worker_id=None,
            ),
            execution_options={"synchronize_session": False},
        )
        if canceled.rowcount == 1:
            self.heartbeat(None)
            self.db.expire_all()
            return False
        started = self.db.execute(
            update(Task)
            .where(*self._active_fence(token, now, ("claimed",)))
            .values(
                status="running",
                started_at=now,
                lease_expires_at=self._lease_until(),
                progress=1,
            ),
            execution_options={"synchronize_session": False},
        )
        if started.rowcount != 1:
            return False
        self.heartbeat(task.id)
        self.db.expire_all()
        return True

    def renew(self, task: Task, *, token: LeaseToken | None = None) -> bool:
        """Extend a still-current active lease at an explicit safe point."""

        token = self._token(task, token)
        now = utcnow()
        renewed = self.db.execute(
            update(Task)
            .where(*self._active_fence(token, now, ACTIVE_TASK_STATUSES))
            .values(lease_expires_at=self._lease_until()),
            execution_options={"synchronize_session": False},
        )
        if renewed.rowcount != 1:
            return False
        self.heartbeat(task.id)
        self.db.expire_all()
        return True

    def should_cancel(self, task: Task, *, token: LeaseToken | None = None) -> bool:
        """Return true for either cancellation or a lost/expired ownership fence."""

        token = self._token(task, token)
        now = utcnow()
        status = self.db.scalar(
            select(Task.status).where(
                Task.id == token.task_id,
                Task.worker_id == token.worker_id,
                Task.attempt_count == token.attempt_count,
                Task.lease_expires_at.is_not(None),
                Task.lease_expires_at > now,
            )
        )
        return status != "running"

    def cancel(self, task: Task, *, token: LeaseToken | None = None) -> bool:
        token = self._token(task, token)
        now = utcnow()
        changed = self.db.execute(
            update(Task)
            .where(*self._active_fence(token, now, ("claimed", "running", "cancel_requested")))
            .values(
                status="canceled",
                progress=100,
                completed_at=now,
                lease_expires_at=None,
                worker_id=None,
            ),
            execution_options={"synchronize_session": False},
        )
        if changed.rowcount != 1:
            return False
        self.heartbeat(None)
        self.db.expire_all()
        return True

    def complete(self, task: Task, *, token: LeaseToken | None = None) -> bool:
        token = self._token(task, token)
        now = utcnow()
        changed = self.db.execute(
            update(Task)
            .where(*self._active_fence(token, now, ("running",)))
            .values(
                status="success",
                progress=100,
                completed_at=now,
                lease_expires_at=None,
                worker_id=None,
            ),
            execution_options={"synchronize_session": False},
        )
        if changed.rowcount != 1:
            return False
        self.heartbeat(None)
        self.db.expire_all()
        return True

    def fail(
        self,
        task_id: str,
        *,
        token: LeaseToken | None = None,
        error_code: str = "TASK_EXECUTION_FAILED",
        error_message: str = "Task processing failed",
        retry: bool = True,
    ) -> bool:
        """Record a sanitized fenced retry/failure outcome."""

        if token is None:
            task = self.db.get(Task, task_id)
            if task is None:
                return False
            token = self._token(task, None)
        if token.task_id != task_id or token.worker_id != self.worker_id:
            raise ValueError("invalid task lease token")
        now = utcnow()
        current = self.db.execute(
            select(Task.attempt_count).where(*self._active_fence(token, now, ACTIVE_TASK_STATUSES))
        ).scalar_one_or_none()
        if current is None:
            return False
        terminal = not retry
        if retry:
            max_attempts = self.db.scalar(select(Task.max_attempts).where(Task.id == task_id))
            terminal = int(current) >= int(max_attempts or 1)
        values = {
            "error_code": error_code[:128],
            "error_message": error_message[:500],
            "lease_expires_at": None,
            "worker_id": None,
            "status": "failed" if terminal else "queued",
            "progress": 100 if terminal else 0,
            "completed_at": now if terminal else None,
        }
        changed = self.db.execute(
            update(Task)
            .where(*self._active_fence(token, now, ACTIVE_TASK_STATUSES))
            .values(**values),
            execution_options={"synchronize_session": False},
        )
        if changed.rowcount != 1:
            return False
        self.heartbeat(None)
        self.db.expire_all()
        return True


def task_counts(db: Session) -> dict[str, int]:
    """Read queue counts without a setup or heartbeat write side effect."""

    return {
        status: len(db.scalars(select(Task.id).where(Task.status == status)).all())
        for status in ("queued", "claimed", "running")
    }


def online_workers(db: Session, *, heartbeat_seconds: int) -> list[WorkerHeartbeat]:
    cutoff = utcnow() - timedelta(seconds=max(1, int(heartbeat_seconds)) * 2)
    return list(
        db.scalars(
            select(WorkerHeartbeat)
            .where(WorkerHeartbeat.last_seen_at >= cutoff)
            .order_by(WorkerHeartbeat.worker_id)
        )
    )
