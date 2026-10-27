"""Offline parser regressions. Every workbook is generated from invented records."""

import io
import unittest
from unittest.mock import patch

from openpyxl import Workbook

from scripts.misis import Links, download, parse_workbook


def workbook_bytes(rows, merges=()):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Учебный лист"
    for row in rows:
        sheet.append(row)
    for cell_range in merges:
        sheet.merge_cells(cell_range)
    output = io.BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def timetable(upper, lower):
    return workbook_bytes(
        [
            ["Дата", "Номер", "Время", "ТЕСТ-1", "", "", ""],
            ["", "", "", "1", "", "2", ""],
            ["Понедельник", "1", "10:50 - 12:20", upper, "101", upper, "101"],
            ["", "", "", lower, "101", lower, "101"],
        ],
        ["A3:A4", "C3:C4"],
    )


class TimetableTests(unittest.TestCase):
    def test_subgroups_and_alternating_weeks(self):
        result = parse_workbook(timetable("Физика (Лекционные)", "Математика (Практические)"))
        group = result["groups"][0]
        self.assertEqual(group["subgroups"], [1, 2])
        self.assertEqual(len(group["lessons"]), 2)
        upper, lower = group["lessons"]
        self.assertEqual((upper["subject"], upper["week"]), ("Физика", "odd"))
        self.assertEqual((lower["subject"], lower["week"]), ("Математика", "even"))
        self.assertEqual(upper["subgroups"], [1, 2])
        self.assertEqual((upper["day"], upper["start"], upper["end"]), (1, "10:50", "12:20"))

    def test_identical_weeks_merge_and_ids_are_stable(self):
        data = timetable("Физика (Лекционные)", "Физика (Лекционные)")
        first = parse_workbook(data)["groups"][0]["lessons"]
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0]["week"], "all")
        self.assertEqual(first, parse_workbook(data)["groups"][0]["lessons"])

    def test_inline_time_override_and_date_restriction(self):
        result = parse_workbook(
            timetable("с 9:00 до 10:30 Физика (Лекционные)", "Физика (Лекционные) до 12.10")
        )["groups"][0]
        self.assertEqual(len(result["lessons"]), 1)
        self.assertEqual(result["lessons"][0]["start"], "09:00")
        self.assertEqual(result["lessons"][0]["end"], "10:30")
        self.assertTrue(result["unparsed"])
        self.assertIn("ограничения", result["unparsed"][0]["reason"])

    def test_day_time_layout(self):
        data = workbook_bytes(
            [
                ["День недели", "Время", "ТЕСТ-2", ""],
                ["", "", "", ""],
                ["Вторник", "08:30 - 10:00", "Физика (Лекционные)", "201"],
                ["", "", "Математика (Практические)", "201"],
            ],
            ["A3:A4", "B3:B4"],
        )
        group = parse_workbook(data)["groups"][0]
        self.assertEqual(group["name"], "ТЕСТ-2")
        self.assertEqual(group["subgroups"], [1])
        self.assertEqual([lesson["week"] for lesson in group["lessons"]], ["odd", "even"])

    def test_unsupported_and_header_only_files_are_explicit(self):
        for rows in [[["Произвольная таблица"]], [["Дата", "Номер", "Время", "ТЕСТ"]]]:
            result = parse_workbook(workbook_bytes(rows))
            self.assertEqual(result["groups"], [])
            self.assertTrue(result["warnings"])

    def test_html_links_allow_only_official_file_paths(self):
        parser = Links()
        parser.feed('<a href="/files/test.xls">Учебный <b>институт</b></a>')
        parser.feed('<a href="https://example.com/test.xls">Чужой файл</a>')
        self.assertEqual(
            parser.links, [{"name": "Учебный институт", "url": "https://misis.ru/files/test.xls"}]
        )
        with patch("scripts.misis.urllib.request.build_opener") as opener:
            with self.assertRaises(ValueError):
                download("https://misis.ru.example.com/test.xls")
            opener.assert_not_called()


if __name__ == "__main__":
    unittest.main()
