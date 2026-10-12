#!/usr/bin/env python3
"""서울시 공공서비스예약(종합) API -> 가족용 정적 뉴스 피드.

Uses official dataset tvYeyakCOllect with SEOUL_API_KEY set in environment.
Designed for daily GitHub Actions execution, with robust pagination and fail-closed updates.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
FEED_FILE = ROOT / "data" / "events.json"
SEOUL_TZ = ZoneInfo("Asia/Seoul")
SERVICE = "tvYeyakCOllect"
PAGE_SIZE = 1000
MAX_PAGES = 30
CATEGORY_ALLOWED = ("문화체험", "교육강좌")


def clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def grade_match(title: str, target: str) -> str | None:
    """confirmed: explicit grade 4~6; candidate: age needs manual checking; None: excluded.

    We deliberately avoid interpreting general public and adult courses as elementary.
    Detailed descriptions may be more restrictive than API metadata, so links remain mandatory.
    """
    words = clean(f"{title} {target}").replace("～", "~").replace("∼", "~").replace("〜", "~").replace("–", "-").replace("~ ", "~")
    if not words:
        return None
    grades: set[int] = set()
    for match in re.finditer(r"(?<!\d)([1-6])\s*(?:학년)?\s*[~\-]\s*([1-6])\s*학년", words):
        lo, hi = int(match.group(1)), int(match.group(2))
        grades.update(range(min(lo, hi), max(lo, hi) + 1))
    for match in re.finditer(r"(?<!\d)([1-6])\s*학년", words):
        grades.add(int(match.group(1)))
    has_school = bool(re.search(r"초등|초교|초\s*등|어린이|아동|가족", words))
    if not has_school:
        return None
    if "고학년" in words or any(g in grades for g in (4, 5, 6)):
        return "confirmed"
    if grades and max(grades) <= 3:
        return None
    if "저학년" in words and "고학년" not in words:
        return None
    if re.search(r"미취학|유아|유치원", words) and not re.search(r"초등|초교|고학년", words):
        return None
    if re.search(r"초등|초교|어린이|아동", words):
        return "candidate"
    return None


def topic_for(title: str, subclass: str) -> str:
    words = f"{title} {subclass}".lower()
    groups = [
        ("과학·기술", ("과학", "수학", "로봇", "코딩", "인공지능", "ai ", "3d", "천문", "별자리", "우주", "실험", "디지털", "정보통신", "발명", "메이커")),
        ("역사·박물관", ("역사", "유적", "박물관", "고고학", "문화재", "고궁", "궁궐", "조선", "고려", "해설", "선사", "전통", "독립", "전시")),
        ("예술·만들기", ("미술", "공예", "그림", "드로잉", "만들기", "도예", "미디어아트", "캘리", "음악", "악기", "연극", "디자인", "예술", "책", "글쓰기", "웹툰", "취미")),
        ("자연·생태", ("자연", "숲", "공원", "생태", "식물", "정원", "농장", "농업", "환경", "곤충", "동물", "산림", "텃밭", "기후", "하천")),
    ]
    for topic, terms in groups:
        if any(term in words for term in terms):
            return topic
    return "기타 교육·체험"


def parse_datetime(value: str) -> datetime | None:
    text = clean(value)
    if not text:
        return None
    if re.fullmatch(r"\d{14}", text):
        return datetime.strptime(text, "%Y%m%d%H%M%S").replace(tzinfo=SEOUL_TZ)
    text = text.replace(".", "-").replace("/", "-").replace("T", " ").rstrip("-")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=SEOUL_TZ)
        except ValueError:
            pass
    return None


def normalize(row: dict, now: datetime) -> dict | None:
    cat = clean(row.get("MAXCLASSNM"))
    if not any(x in cat for x in CATEGORY_ALLOWED):
        return None
    title = clean(row.get("SVCNM"))
    target = clean(row.get("USETGTINFO"))
    eligibility = grade_match(title, target)
    if not eligibility:
        return None
    svc_id = clean(row.get("SVCID"))
    if not re.fullmatch(r"S\d{10,25}", svc_id):
        return None
    end = parse_datetime(row.get("RCPTENDDT"))
    # Explicitly expired reception windows should not show as currently available.
    if end is not None and end < now:
        return None
    service_end = parse_datetime(row.get("SVCOPNENDDT"))
    if service_end is not None and service_end < now:
        return None
    status = clean(row.get("SVCSTATNM"))
    if any(word in status for word in ("예약마감", "접수마감", "예약종료", "이용종료", "취소")):
        return None
    sub = clean(row.get("MINCLASSNM"))
    area = clean(row.get("AREANM"))
    return {
        "id": svc_id,
        "title": title,
        "category": "문화체험" if "문화" in cat else "교육강좌",
        "subcategory": sub,
        "topic": topic_for(title, sub),
        "area": area or "서울",
        "place": clean(row.get("PLACENM")),
        "target": target,
        "eligibility": eligibility,
        "pay": clean(row.get("PAYATNM")),
        "status": status,
        "receiptStart": clean(row.get("RCPTBGNDT")),
        "receiptEnd": clean(row.get("RCPTENDDT")),
        "eventStart": clean(row.get("SVCOPNBGNDT")),
        "eventEnd": clean(row.get("SVCOPNENDDT")),
        "url": f"https://yeyak.seoul.go.kr/web/reservation/selectReservView.do?rsv_svc_id={quote(svc_id)}",
    }


def request_page(key: str, start: int, end: int) -> dict:
    path = "/".join((quote(key, safe=""), "json", SERVICE, str(start), str(end))) + "/"
    last_exception = None
    # Prefer TLS if the API gateway supports it; legacy official endpoint documents HTTP/8088.
    for scheme in ("https", "http"):
        url = f"{scheme}://openapi.seoul.go.kr:8088/{path}"
        try:
            req = Request(url, headers={"User-Agent": "SeoulKidsClassNews/1.0 (+personal-use)", "Accept": "application/json"})
            with urlopen(req, timeout=35) as response:
                data = json.loads(response.read())
            if not isinstance(data, dict):
                raise ValueError("API에서 JSON 객체를 반환하지 않았습니다.")
            return data
        except Exception as exc:
            last_exception = exc
    raise RuntimeError("서울시 API 접속 실패 (HTTPS 및 공식 HTTP 포트 확인 필요)") from last_exception


def fetch_all(key: str) -> tuple[list[dict], int]:
    merged: list[dict] = []
    total: int | None = None
    for page in range(MAX_PAGES):
        start = page * PAGE_SIZE + 1
        end = start + PAGE_SIZE - 1
        payload = request_page(key, start, end)
        body = payload.get(SERVICE)
        if not isinstance(body, dict):
            result = payload.get("RESULT") or {}
            raise RuntimeError(f"서울시 API 오류: {result.get('CODE', '알 수 없음')} {result.get('MESSAGE', '')}".strip())
        result = body.get("RESULT") or {}
        if result.get("CODE") not in (None, "INFO-000", "INFO-200"):
            raise RuntimeError(f"API 결과 오류 {result.get('CODE')}: {result.get('MESSAGE')}")
        if total is None:
            total = int(body.get("list_total_count") or 0)
        rows = body.get("row") or []
        if not isinstance(rows, list):
            raise RuntimeError("서울시 API row 형식이 유효하지 않습니다.")
        merged.extend(rows)
        print(f"Page {page + 1}: {len(rows)} rows, total {total}")
        if not rows or len(merged) >= total:
            return merged, total
    raise RuntimeError(f"최대 페이지({MAX_PAGES}) 도달: 잘못된 부분 피드 게시를 방지합니다")


def load_old() -> dict:
    try:
        return json.loads(FEED_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"mode": "preview", "items": [], "newIds": []}


def build_feed(rows: list[dict], previous: dict, now: datetime, source_total: int) -> dict:
    values: dict[str, dict] = {}
    for row in rows:
        normalized = normalize(row, now)
        if normalized:
            values[normalized["id"]] = normalized
    items = list(values.values())
    if rows and not items:
        # A schema change or unexpected field values must not silently erase a working feed.
        raise RuntimeError("필터링 후 데이터 0개: API 스키마 변경 여부 확인 필요")
    old_ids = {item["id"] for item in previous.get("items", []) if "id" in item}
    is_first = previous.get("mode") != "live"
    new_ids = [] if is_first else [item["id"] for item in items if item["id"] not in old_ids]
    items.sort(key=lambda x: (x["receiptEnd"] or "9999", x["title"]))
    return {
        "mode": "live",
        "capturedAt": now.isoformat(timespec="seconds"),
        "lastSuccess": now.isoformat(timespec="seconds"),
        "source": "서울특별시 서울열린데이터광장: tvYeyakCOllect",
        "notice": "공식 API 자료를 하루 한 번 수집합니다. 잔여석과 세부 자격은 서울시 원문 확인 필수.",
        "totalSourceCount": source_total,
        "newIds": new_ids,
        "items": items,
    }


def main() -> int:
    key = os.getenv("SEOUL_API_KEY", "").strip()
    if not key:
        print("INFO: SEOUL_API_KEY 미설정. 기존 자료 보존, 미리보기 웹앱 게시 가능.")
        return 0
    now = datetime.now(SEOUL_TZ)
    rows, count = fetch_all(key)
    if count == 0:
        raise RuntimeError("API가 총 0건 반환: 덮어쓰지 않고 종료")
    data = build_feed(rows, load_old(), now, count)
    # Only write a fully validated feed. If fetch fails, the previous file survives.
    temp = FEED_FILE.with_suffix(".json.tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(FEED_FILE)
    print(f"완료: 공공예약 {count}건에서 고학년 대상 후보 {len(data['items'])}건 추출, 신규 {len(data['newIds'])}건")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
