from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any
from uuid import uuid4

from .const import DEFAULT_PROGRAM_START_TIME, MAX_PROGRAM_MINUTES

TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
SERVICE_RE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")


def _require_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string")
    text = value.strip()
    if not text:
        raise ValueError(f"{field_name} cannot be empty")
    return text


def _coerce_service(value: Any, field_name: str, *, allow_none: bool = False) -> str | None:
    if value in (None, "") and allow_none:
        return None
    service_name = _require_string(value, field_name)
    if SERVICE_RE.match(service_name) is None:
        raise ValueError(
            f"{field_name} must use the format 'domain.service'"
        )
    return service_name


def _coerce_minutes(value: Any, field_name: str, *, min_value: int, max_value: int) -> int:
    if not isinstance(value, int):
        raise ValueError(f"{field_name} must be an integer")
    if value < min_value or value > max_value:
        raise ValueError(f"{field_name} must be between {min_value} and {max_value}")
    return value


def _coerce_time_string(value: Any) -> str:
    time_string = _require_string(value, "start_time")
    if TIME_RE.match(time_string) is None:
        raise ValueError("start_time must use HH:MM in 24h format")
    return time_string


def parse_time_to_minutes(time_string: str) -> int:
    hours, minutes = time_string.split(":", 1)
    return int(hours) * 60 + int(minutes)


def _coerce_mapping(value: Any, field_name: str) -> dict[str, Any]:
    if value in (None, {}):
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return value


def _new_id() -> str:
    return uuid4().hex


@dataclass(slots=True)
class ProgramBlock:
    id: str
    label: str
    entity_id: str
    offset_minutes: int
    duration_minutes: int
    start_service: str
    stop_service: str | None = None
    color: str = "#4f7f52"
    service_data: dict[str, Any] = field(default_factory=dict)
    stop_service_data: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> ProgramBlock:
        entity_id = _require_string(raw.get("entity_id"), "entity_id")
        offset_minutes = _coerce_minutes(
            raw.get("offset_minutes", 0),
            "offset_minutes",
            min_value=0,
            max_value=MAX_PROGRAM_MINUTES - 1,
        )
        duration_minutes = _coerce_minutes(
            raw.get("duration_minutes", 1),
            "duration_minutes",
            min_value=1,
            max_value=MAX_PROGRAM_MINUTES,
        )
        if offset_minutes + duration_minutes > MAX_PROGRAM_MINUTES:
            raise ValueError("A block cannot run beyond 24 hours from the program start")

        return cls(
            id=_require_string(raw.get("id", _new_id()), "block id"),
            label=_require_string(raw.get("label", entity_id), "label"),
            entity_id=entity_id,
            offset_minutes=offset_minutes,
            duration_minutes=duration_minutes,
            start_service=_coerce_service(raw.get("start_service"), "start_service") or "",
            stop_service=_coerce_service(
                raw.get("stop_service"), "stop_service", allow_none=True
            ),
            color=str(raw.get("color", "#4f7f52")),
            service_data=_coerce_mapping(raw.get("service_data"), "service_data"),
            stop_service_data=_coerce_mapping(
                raw.get("stop_service_data"), "stop_service_data"
            ),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "entity_id": self.entity_id,
            "offset_minutes": self.offset_minutes,
            "duration_minutes": self.duration_minutes,
            "start_service": self.start_service,
            "stop_service": self.stop_service,
            "color": self.color,
            "service_data": self.service_data,
            "stop_service_data": self.stop_service_data,
        }


@dataclass(slots=True)
class Program:
    id: str
    name: str
    enabled: bool
    start_time: str
    weekdays: list[int]
    blocks: list[ProgramBlock]

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> Program:
        if not isinstance(raw, dict):
            raise ValueError("program must be an object")

        weekdays_raw = raw.get("weekdays", list(range(7)))
        if not isinstance(weekdays_raw, list):
            raise ValueError("weekdays must be a list")

        weekdays: list[int] = []
        for day in weekdays_raw:
            if not isinstance(day, int) or day < 0 or day > 6:
                raise ValueError("weekdays entries must be integers between 0 and 6")
            if day not in weekdays:
                weekdays.append(day)
        weekdays.sort()

        blocks_raw = raw.get("blocks", [])
        if not isinstance(blocks_raw, list):
            raise ValueError("blocks must be a list")

        blocks = [ProgramBlock.from_dict(block) for block in blocks_raw]
        blocks.sort(key=lambda block: (block.offset_minutes, block.label.lower()))

        return cls(
            id=_require_string(raw.get("id", _new_id()), "program id"),
            name=_require_string(raw.get("name", "New Program"), "name"),
            enabled=bool(raw.get("enabled", True)),
            start_time=_coerce_time_string(
                raw.get("start_time", DEFAULT_PROGRAM_START_TIME)
            ),
            weekdays=weekdays,
            blocks=blocks,
        )

    @property
    def start_minutes(self) -> int:
        return parse_time_to_minutes(self.start_time)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "enabled": self.enabled,
            "start_time": self.start_time,
            "weekdays": self.weekdays,
            "blocks": [block.as_dict() for block in self.blocks],
        }
