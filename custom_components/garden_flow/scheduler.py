from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
import logging
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_call_later, async_track_point_in_time
from homeassistant.util import dt as dt_util

from .models import Program, ProgramBlock
from .storage import GardenFlowStore

_LOGGER = logging.getLogger(__name__)


def _split_service_name(service_name: str) -> tuple[str, str]:
    domain, service = service_name.split(".", 1)
    return domain, service


@dataclass(slots=True)
class _ProgramRun:
    hass: HomeAssistant
    program: Program
    service_caller: Callable[[ProgramBlock, str, dict[str, Any]], Any]
    on_finish: Callable[[str], None]
    _handles: list[Callable[[], None]] = field(default_factory=list)
    _active_blocks: dict[str, ProgramBlock] = field(default_factory=dict)
    _closed: bool = False

    async def async_start(self) -> None:
        for block in self.program.blocks:
            self._schedule_block_start(block)
            if block.stop_service is not None:
                self._schedule_block_stop(block)

        finish_after_minutes = max(
            (
                block.offset_minutes + (block.duration_minutes if block.stop_service else 0)
                for block in self.program.blocks
            ),
            default=0,
        )
        finish_after_seconds = max(finish_after_minutes * 60, 1)

        @callback
        def _finish(_now: datetime) -> None:
            self.hass.async_create_task(self.async_stop(force=False))

        self._handles.append(async_call_later(self.hass, finish_after_seconds, _finish))

    async def async_stop(self, *, force: bool) -> None:
        if self._closed:
            return

        self._closed = True
        while self._handles:
            cancel = self._handles.pop()
            cancel()

        if force:
            for block in list(self._active_blocks.values()):
                if block.stop_service is None:
                    continue
                await self.service_caller(block, block.stop_service, block.stop_service_data)
                self._active_blocks.pop(block.id, None)

        self.on_finish(self.program.id)

    def _schedule_block_start(self, block: ProgramBlock) -> None:
        @callback
        def _run_block(_now: datetime) -> None:
            self.hass.async_create_task(self._async_start_block(block))

        self._handles.append(
            async_call_later(self.hass, block.offset_minutes * 60, _run_block)
        )

    def _schedule_block_stop(self, block: ProgramBlock) -> None:
        @callback
        def _stop_block(_now: datetime) -> None:
            self.hass.async_create_task(self._async_stop_block(block))

        self._handles.append(
            async_call_later(
                self.hass,
                (block.offset_minutes + block.duration_minutes) * 60,
                _stop_block,
            )
        )

    async def _async_start_block(self, block: ProgramBlock) -> None:
        if self._closed:
            return

        await self.service_caller(block, block.start_service, block.service_data)
        if block.stop_service is not None:
            self._active_blocks[block.id] = block

    async def _async_stop_block(self, block: ProgramBlock) -> None:
        if self._closed:
            return
        if block.id not in self._active_blocks or block.stop_service is None:
            return

        await self.service_caller(block, block.stop_service, block.stop_service_data)
        self._active_blocks.pop(block.id, None)


class GardenFlowScheduler:
    """Schedule and execute Garden Flow programs."""

    def __init__(self, hass: HomeAssistant, storage: GardenFlowStore) -> None:
        self.hass = hass
        self._storage = storage
        self._scheduled: dict[str, Callable[[], None]] = {}
        self._next_runs: dict[str, datetime] = {}
        self._active_runs: dict[str, _ProgramRun] = {}

    async def async_reload(self) -> None:
        for cancel in self._scheduled.values():
            cancel()
        self._scheduled = {}
        self._next_runs = {}

        for program in self._storage.iter_programs():
            self._schedule_program(program)

    async def async_unload(self) -> None:
        for cancel in self._scheduled.values():
            cancel()
        self._scheduled = {}
        self._next_runs = {}

        for run in list(self._active_runs.values()):
            await run.async_stop(force=True)
        self._active_runs = {}

    async def async_run_program(self, program_id: str, *, source: str) -> None:
        program = self._storage.get_program(program_id)
        if program is None:
            raise ValueError(f"Unknown program '{program_id}'")
        if not program.blocks:
            raise ValueError("Program has no blocks")
        if program_id in self._active_runs:
            raise ValueError("Program is already running")

        _LOGGER.info("Starting Garden Flow program %s (%s)", program.name, source)
        run = _ProgramRun(
            hass=self.hass,
            program=program,
            service_caller=self._async_call_block_service,
            on_finish=self._handle_run_finished,
        )
        self._active_runs[program.id] = run
        await run.async_start()

    async def async_stop_program(self, program_id: str) -> bool:
        run = self._active_runs.get(program_id)
        if run is None:
            return False
        await run.async_stop(force=True)
        return True

    def running_program_ids(self) -> list[str]:
        return sorted(self._active_runs)

    def next_runs(self) -> dict[str, str]:
        return {
            program_id: dt_util.as_local(next_run).isoformat()
            for program_id, next_run in self._next_runs.items()
        }

    async def _async_call_block_service(
        self,
        block: ProgramBlock,
        service_name: str,
        service_data: dict[str, Any],
    ) -> None:
        domain, service = _split_service_name(service_name)
        try:
            await self.hass.services.async_call(
                domain,
                service,
                service_data=dict(service_data),
                target={"entity_id": block.entity_id},
                blocking=True,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning(
                "Garden Flow failed calling %s for %s: %s",
                service_name,
                block.entity_id,
                err,
            )

    def _schedule_program(self, program: Program) -> None:
        if not program.enabled or not program.weekdays or not program.blocks:
            return

        next_run = self._find_next_run(program)
        if next_run is None:
            return

        @callback
        def _trigger(_now: datetime) -> None:
            self._scheduled.pop(program.id, None)
            self._next_runs.pop(program.id, None)
            self.hass.async_create_task(self._async_run_scheduled_program(program.id))

        self._next_runs[program.id] = next_run
        self._scheduled[program.id] = async_track_point_in_time(
            self.hass, _trigger, next_run
        )

    async def _async_run_scheduled_program(self, program_id: str) -> None:
        program = self._storage.get_program(program_id)
        if program is None:
            return

        self._schedule_program(program)
        try:
            await self.async_run_program(program_id, source="schedule")
        except ValueError as err:
            _LOGGER.warning("Skipping scheduled Garden Flow program %s: %s", program_id, err)

    def _find_next_run(self, program: Program) -> datetime | None:
        now = dt_util.now()
        start_hour, start_minute = map(int, program.start_time.split(":"))

        for days_ahead in range(0, 8):
            candidate_date = (now + timedelta(days=days_ahead)).date()
            if candidate_date.weekday() not in program.weekdays:
                continue

            candidate = datetime.combine(
                candidate_date,
                time(hour=start_hour, minute=start_minute, tzinfo=now.tzinfo),
            )
            if candidate > now:
                return candidate

        return None

    @callback
    def _handle_run_finished(self, program_id: str) -> None:
        self._active_runs.pop(program_id, None)
