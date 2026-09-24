import json

import pytest
from pydantic import ValidationError

from cinema.providers import Findings, UiAction
from cinema.ui_tools import AUTO_EXECUTABLE_TOOLS, ui_actions_instruction, validate_ui_actions


def test_validate_ui_actions_keeps_only_allowed_tools_with_dict_args():
    raw = [
        {"tool": "set_view", "args": {"view": "stage"}},
        {"tool": "select_shot", "args": {"shotId": "shot-1"}},
        {"tool": "add_script_mark", "args": {"elementId": "e1"}},
        {"tool": "select_element", "args": "not-a-dict"},
        {"tool": "get_shot", "args": {"shotId": "shot-1"}},
    ]
    valid = validate_ui_actions(raw)
    assert valid == [
        {"tool": "set_view", "args": {"view": "stage"}},
        {"tool": "select_shot", "args": {"shotId": "shot-1"}},
        {"tool": "get_shot", "args": {"shotId": "shot-1"}},
    ]


def test_validate_ui_actions_drops_non_dict_args():
    assert validate_ui_actions([{"tool": "set_view", "args": ["stage"]}]) == []
    assert validate_ui_actions([{"tool": "set_view"}]) == []


def test_validate_ui_actions_bounds_count_and_size():
    many = [{"tool": "get_studio_state", "args": {}}] * 15
    assert len(validate_ui_actions(many)) == 10
    huge = [{"tool": "set_view", "args": {"x": "y" * 2000}}]
    assert validate_ui_actions(huge) == []


def test_validate_ui_actions_accepts_unknown_input():
    assert validate_ui_actions(None) == []
    assert validate_ui_actions({"tool": "set_view"}) == []
    assert validate_ui_actions("not a list") == []


def test_auto_executable_tools_frozenset_contains_only_expected_names():
    assert AUTO_EXECUTABLE_TOOLS == {
        "get_studio_state",
        "get_script_outline",
        "get_shot",
        "get_overhead_state",
        "get_frame_state",
        "get_cut_state",
        "set_view",
        "select_shot",
        "select_element",
    }


def test_ui_actions_instruction_lists_every_allowed_tool():
    text = ui_actions_instruction()
    for name in AUTO_EXECUTABLE_TOOLS:
        assert name in text
    assert "at most 10" in text
    assert "never modify creative" in text.lower() or "never modify" in text.lower()


def test_ui_action_schema_requires_tool_and_defaults_args():
    action = UiAction.model_validate({"tool": "set_view"})
    assert action.tool == "set_view"
    assert action.args == {}
    with pytest.raises(ValidationError):
        UiAction.model_validate({"args": {"view": "stage"}})


def test_findings_schema_round_trips_ui_actions_and_defaults_absent():
    findings = Findings.model_validate(
        {
            "findings": [],
            "ui_actions": [
                {"tool": "set_view", "args": {"view": "edit"}},
                {"tool": "select_shot", "args": {"shotId": "shot-2"}},
            ],
        }
    )
    assert [a.model_dump() for a in findings.ui_actions] == [
        {"tool": "set_view", "args": {"view": "edit"}},
        {"tool": "select_shot", "args": {"shotId": "shot-2"}},
    ]

    empty = Findings.model_validate({"findings": []})
    assert empty.ui_actions == []


def test_findings_schema_rejects_more_than_ten_ui_actions():
    with pytest.raises(ValidationError):
        Findings.model_validate(
            {"findings": [], "ui_actions": [{"tool": "get_studio_state"}] * 11}
        )


def test_findings_json_schema_includes_ui_actions_for_provider_instruction():
    schema = Findings.model_json_schema()
    assert "ui_actions" in schema["properties"]
    assert schema["properties"]["ui_actions"]["type"] == "array"
