from PIL import Image, ImageDraw, ImageFont
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "architecture" / "site-workflow-bpmn.png"

WIDTH = 3200
HEIGHT = 2100
MARGIN_X = 70
HEADER_H = 110
LANE_LABEL_W = 230
LANE_H = 340
LANE_GAP = 18

BG = "#f5f1e8"
INK = "#201a17"
GRID = "#d6cec0"
LANE_FILL = "#fbf8f1"
TASK_FILL = "#fffdf8"
TASK_ACCENT = "#6f7f5a"
TASK_ACCENT_2 = "#8b5e3c"
TASK_ACCENT_3 = "#446d7d"
GATE_FILL = "#fdf2cf"
EVENT_FILL = "#ecf6ef"
STORE_FILL = "#e8f0fb"
NOTE_FILL = "#fff6df"
MSG = "#5b7ea6"


def load_font(size: int, bold: bool = False):
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/tahoma.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


FONT_TITLE = load_font(36, bold=True)
FONT_SUB = load_font(20, bold=False)
FONT_LANE = load_font(26, bold=True)
FONT_BOX = load_font(18, bold=False)
FONT_BOX_BOLD = load_font(18, bold=True)
FONT_SMALL = load_font(15, bold=False)


img = Image.new("RGB", (WIDTH, HEIGHT), BG)
draw = ImageDraw.Draw(img)


def text_size(text, font):
    box = draw.multiline_textbbox((0, 0), text, font=font, spacing=4)
    return box[2] - box[0], box[3] - box[1]


def draw_centered_text(box, text, font, fill=INK, spacing=4):
    x1, y1, x2, y2 = box
    tw, th = text_size(text, font)
    tx = x1 + (x2 - x1 - tw) / 2
    ty = y1 + (y2 - y1 - th) / 2
    draw.multiline_text((tx, ty), text, font=font, fill=fill, spacing=spacing, align="center")


def draw_lane(index, label):
    top = HEADER_H + index * (LANE_H + LANE_GAP)
    bottom = top + LANE_H
    draw.rounded_rectangle((MARGIN_X, top, WIDTH - MARGIN_X, bottom), radius=24, fill=LANE_FILL, outline=GRID, width=3)
    draw.line((MARGIN_X + LANE_LABEL_W, top, MARGIN_X + LANE_LABEL_W, bottom), fill=GRID, width=3)
    draw_centered_text((MARGIN_X + 18, top + 16, MARGIN_X + LANE_LABEL_W - 18, bottom - 16), label, FONT_LANE)
    return top, bottom


LANES = {
    "user": draw_lane(0, "Пользователь"),
    "spa": draw_lane(1, "Браузер / SPA"),
    "api": draw_lane(2, "Node.js API"),
    "store": draw_lane(3, "Хранилище"),
    "rt": draw_lane(4, "Realtime / SSE"),
}


def lane_mid(name):
    top, bottom = LANES[name]
    return (top + bottom) // 2


def task(x, lane, w, h, text, accent=TASK_ACCENT, fill=TASK_FILL):
    y = lane_mid(lane) - h // 2
    box = (x, y, x + w, y + h)
    draw.rounded_rectangle(box, radius=18, fill=fill, outline=INK, width=3)
    draw.line((x, y, x, y + h), fill=accent, width=8)
    draw_centered_text(box, text, FONT_BOX)
    return {
        "box": box,
        "left": (x, y + h // 2),
        "right": (x + w, y + h // 2),
        "top": (x + w // 2, y),
        "bottom": (x + w // 2, y + h),
    }


def event(x, lane, d, text, fill=EVENT_FILL, double=False):
    y = lane_mid(lane) - d // 2
    box = (x, y, x + d, y + d)
    draw.ellipse(box, fill=fill, outline=INK, width=3)
    if double:
        draw.ellipse((x + 8, y + 8, x + d - 8, y + d - 8), outline=INK, width=3)
    draw_centered_text((x - 22, y + d + 8, x + d + 22, y + d + 58), text, FONT_SMALL)
    return {
        "box": box,
        "left": (x, y + d // 2),
        "right": (x + d, y + d // 2),
        "top": (x + d // 2, y),
        "bottom": (x + d // 2, y + d),
    }


def gateway(x, lane, size, text):
    cy = lane_mid(lane)
    cx = x + size // 2
    points = [(cx, cy - size // 2), (cx + size // 2, cy), (cx, cy + size // 2), (cx - size // 2, cy)]
    draw.polygon(points, fill=GATE_FILL, outline=INK)
    draw.line((cx - 16, cy, cx + 16, cy), fill=INK, width=3)
    draw.line((cx, cy - 16, cx, cy + 16), fill=INK, width=3)
    draw_centered_text((x - 26, cy - size // 2 - 72, x + size + 26, cy - size // 2 - 12), text, FONT_SMALL)
    return {
        "cx": cx,
        "cy": cy,
        "left": (cx - size // 2, cy),
        "right": (cx + size // 2, cy),
        "top": (cx, cy - size // 2),
        "bottom": (cx, cy + size // 2),
    }


def store_box(x, lane, w, h, text, accent=None):
    y = lane_mid(lane) - h // 2
    box = (x, y, x + w, y + h)
    fill = STORE_FILL if accent is None else STORE_FILL
    draw.rounded_rectangle(box, radius=18, fill=fill, outline=INK, width=3)
    draw.arc((x + 18, y + 8, x + w - 18, y + 34), 0, 180, fill=INK, width=3)
    draw.arc((x + 18, y + h - 34, x + w - 18, y + h - 8), 180, 360, fill=INK, width=3)
    draw_centered_text(box, text, FONT_BOX)
    return {
        "box": box,
        "left": (x, y + h // 2),
        "right": (x + w, y + h // 2),
        "top": (x + w // 2, y),
        "bottom": (x + w // 2, y + h),
    }


def note(x, y, w, h, text):
    draw.rounded_rectangle((x, y, x + w, y + h), radius=14, fill=NOTE_FILL, outline=TASK_ACCENT_2, width=2)
    draw.multiline_text((x + 14, y + 12), text, font=FONT_SMALL, fill=INK, spacing=4)


def arrow(p1, p2, label=None, color=INK, dashed=False, width=3):
    x1, y1 = p1
    x2, y2 = p2
    if not dashed:
        draw.line((x1, y1, x2, y2), fill=color, width=width)
    else:
        steps = 24
        for i in range(steps):
            if i % 2 == 0:
                sx = x1 + (x2 - x1) * i / steps
                sy = y1 + (y2 - y1) * i / steps
                ex = x1 + (x2 - x1) * (i + 1) / steps
                ey = y1 + (y2 - y1) * (i + 1) / steps
                draw.line((sx, sy, ex, ey), fill=color, width=width)
    import math
    ang = math.atan2(y2 - y1, x2 - x1)
    ah = 14
    a1 = ang + math.pi * 0.86
    a2 = ang - math.pi * 0.86
    p3 = (x2 + ah * math.cos(a1), y2 + ah * math.sin(a1))
    p4 = (x2 + ah * math.cos(a2), y2 + ah * math.sin(a2))
    draw.polygon([p2, p3, p4], fill=color)
    if label:
        lx = (x1 + x2) / 2
        ly = (y1 + y2) / 2
        tw, th = text_size(label, FONT_SMALL)
        pad = 5
        draw.rounded_rectangle((lx - tw / 2 - pad, ly - th / 2 - pad, lx + tw / 2 + pad, ly + th / 2 + pad),
                               radius=8, fill=BG)
        draw.text((lx - tw / 2, ly - th / 2), label, font=FONT_SMALL, fill=color)


def orth_arrow(p1, p2, mid_x=None, mid_y=None, label=None, color=INK, dashed=False):
    x1, y1 = p1
    x2, y2 = p2
    points = [p1]
    if mid_x is not None:
        points.append((mid_x, y1))
        points.append((mid_x, y2))
    elif mid_y is not None:
        points.append((x1, mid_y))
        points.append((x2, mid_y))
    points.append(p2)
    for a, b in zip(points, points[1:-1]):
        arrow(a, b, color=color, dashed=dashed)
    arrow(points[-2], points[-1], label=label, color=color, dashed=dashed)


draw.text((MARGIN_X, 26), "BPMN-модель работы сайта TSPCC", font=FONT_TITLE, fill=INK)
draw.text(
    (MARGIN_X, 70),
    "Основано на фактическом SPA bootstrap, session-first маршрутизации, scope data loading, security-load и SSE.",
    font=FONT_SUB,
    fill=TASK_ACCENT_3,
)


# Main objects
start = event(330, "user", 70, "Старт")
open_url = task(450, "user", 210, 86, "Открыть URL /\nF5 / deep link", TASK_ACCENT_2)
spa_boot = task(430, "spa", 250, 96, "DOMContentLoaded\nrunAppBootstrap()", TASK_ACCENT_3)
server_fallback = task(460, "api", 250, 96, "server.js:\nSPA fallback -> index.html", TASK_ACCENT_3)
static_assets = store_box(470, "store", 240, 96, "index.html\nstyle.css\njs/app.*")

prep = task(760, "spa", 280, 110, "Hide app + show loader\nattach popstate\nrestoreSession()", TASK_ACCENT)
session_req = task(770, "api", 240, 96, "GET /api/session", TASK_ACCENT_3)
session_store = store_box(770, "store", 240, 96, "session cookie\ncsrf + authStore", TASK_ACCENT_3)
auth_ok = gateway(1085, "spa", 84, "Сессия\nвалидна?")
auth_overlay = task(1210, "spa", 240, 104, "showAuthOverlay()\nожидание пароля", TASK_ACCENT_2)
enter_pwd = task(1200, "user", 220, 86, "Ввести пароль", TASK_ACCENT_2)
login_req = task(1230, "api", 220, 96, "POST /api/login", TASK_ACCENT_2)
login_valid = task(1480, "api", 250, 96, "Проверить пароль,\nсоздать session/csrf", TASK_ACCENT_2)

boot_app = task(1470, "spa", 260, 110, "bootstrapApp()\nstartTopProgress()", TASK_ACCENT)
route_loading = task(1760, "spa", 285, 110, "handleRoute(fullPath,\nloading:true)", TASK_ACCENT)
scope_pick = gateway(2100, "spa", 90, "Какой scope\nнужен?")
data_req = task(2230, "api", 265, 110, "GET /api/data\n?scope=cards-basic |\ndirectories | production | full", TASK_ACCENT_3)
db_main = store_box(2240, "store", 270, 110, "data/database.json\ncards, ops, centers,\nareas, shifts, receipts", TASK_ACCENT_3)

render_shell = task(2545, "spa", 270, 118, "renderEverything()\nhandleRoute(final)\nshow active page", TASK_ACCENT)
security_gate = gateway(2865, "spa", 90, "Маршрут\nтребует\nsecurity?")
security_req = task(2730, "api", 255, 110, "GET /api/security/users\nGET /api/security/access-levels", TASK_ACCENT_3)
security_store = store_box(2740, "store", 245, 96, "users\naccessLevels", TASK_ACCENT_3)
bg_hydrate = task(2540, "spa", 285, 108, "Background hydration:\nloadData(scope=full)\nre-render current route", TASK_ACCENT)

nav = task(520, "user", 220, 86, "Навигация:\nменю / back / forward", TASK_ACCENT_2, fill="#fff9ef")
route_change = task(860, "spa", 290, 110, "navigateToPath() /\npopstate -> handleRoute()", TASK_ACCENT)
route_access = gateway(1200, "spa", 86, "Доступ\nразрешён?")
page_branch = task(1335, "spa", 360, 118, "Открыть раздел:\n/dashboard, /cards, /cards/:id,\n/profile/:id, /receipts,\n/directories, /production/*", TASK_ACCENT)

user_action = task(1770, "user", 270, 90, "Создать/изменить карту,\nсогласовать, спланировать,\nобработать приёмку", TASK_ACCENT_2)
local_state = task(2080, "spa", 280, 110, "Изменить domain state\nв клиенте + page patch", TASK_ACCENT)
save_req = task(2400, "api", 245, 96, "POST /api/data\nили спец. API\nproduction/*", TASK_ACCENT_3)
persist = store_box(2685, "store", 255, 102, "Сохранить JSON,\nвложения, журналы,\nrevision", TASK_ACCENT_3)

sse_pub = task(1100, "rt", 300, 110, "SSE publish:\ncard.* / cards:changed\nchat stream", MSG, fill="#eef5fb")
sse_client = task(1480, "spa", 285, 110, "startCardsSse()\nstartMessagesSse()\nfallback polling", MSG, fill="#f7fbff")
sse_apply = task(1810, "spa", 290, 110, "applyServerEvent() /\napplyCardsLiveSummary()\nrefresh current views", MSG, fill="#f7fbff")
end = event(2980, "user", 76, "Результат", fill="#f3efe9", double=True)


# Core arrows
arrow(start["right"], open_url["left"])
orth_arrow(open_url["bottom"], spa_boot["top"], mid_x=560)
orth_arrow(open_url["bottom"], server_fallback["top"], mid_x=630, dashed=True, color=MSG)
orth_arrow(server_fallback["bottom"], static_assets["top"], mid_x=590, color=MSG)
orth_arrow(static_assets["top"], spa_boot["bottom"], mid_x=620, dashed=True, color=MSG)
arrow(spa_boot["right"], prep["left"])
orth_arrow(prep["bottom"], session_req["top"], mid_x=890, label="/api/session", color=MSG, dashed=True)
orth_arrow(session_req["bottom"], session_store["top"], mid_x=890, color=MSG)
orth_arrow(session_store["top"], auth_ok["bottom"], mid_x=970, dashed=True, color=MSG)
arrow(prep["right"], auth_ok["left"])

arrow(auth_ok["right"], auth_overlay["left"], label="нет")
orth_arrow(auth_overlay["top"], enter_pwd["bottom"], mid_x=1320)
orth_arrow(enter_pwd["bottom"], login_req["top"], mid_x=1310, label="submit", color=MSG, dashed=True)
arrow(login_req["right"], login_valid["left"])
orth_arrow(login_valid["bottom"], session_store["top"], mid_x=1605, label="set cookie", color=MSG, dashed=True)
orth_arrow(login_valid["top"], boot_app["bottom"], mid_x=1605, label="success", color=MSG, dashed=True)

arrow(auth_ok["bottom"], boot_app["top"], label="да")
arrow(boot_app["right"], route_loading["left"])
arrow(route_loading["right"], scope_pick["left"])
orth_arrow(scope_pick["bottom"], data_req["top"], mid_x=2320, label="route-critical\nscope", color=MSG, dashed=True)
arrow(data_req["right"], db_main["left"], label="read")
orth_arrow(db_main["top"], render_shell["bottom"], mid_x=2670, label="payload", color=MSG, dashed=True)
arrow(scope_pick["right"], render_shell["left"], label="scope ready")
arrow(render_shell["right"], security_gate["left"])
orth_arrow(security_gate["bottom"], security_req["top"], mid_x=2860, label="yes", color=MSG, dashed=True)
arrow(security_req["right"], security_store["left"], label="read")
orth_arrow(security_store["top"], bg_hydrate["bottom"], mid_x=2865, color=MSG, dashed=True)
arrow(security_gate["bottom"], bg_hydrate["top"], label="no / after load")

# navigation and route loop
orth_arrow(nav["bottom"], route_change["top"], mid_x=980)
arrow(route_change["right"], route_access["left"])
arrow(route_access["right"], page_branch["left"], label="да")
arrow(page_branch["right"], render_shell["left"], label="render page")
note(1310, LANES["spa"][0] + 32, 360, 66, "URL — источник истины.\npopstate обязателен.\nБез forced redirect на boot.")

# denied route branch
deny_box = task(1325, "spa", 240, 88, "redirect to /\nили unauthorized", TASK_ACCENT_2, fill="#fff4ef")
orth_arrow(route_access["bottom"], deny_box["top"], mid_x=1240, label="нет")
orth_arrow(deny_box["left"], auth_overlay["right"], mid_y=LANES["spa"][0] + 285)

# action/save/realtime branch
orth_arrow(render_shell["top"], user_action["bottom"], mid_x=1890)
orth_arrow(user_action["bottom"], local_state["top"], mid_x=2210)
orth_arrow(local_state["bottom"], save_req["top"], mid_x=2510, label="saveData()", color=MSG, dashed=True)
arrow(save_req["right"], persist["left"], label="write")
orth_arrow(persist["bottom"], sse_pub["top"], mid_x=2780, color=MSG, dashed=True)
arrow(sse_pub["right"], sse_client["left"], label="/api/events/stream\n/api/chat/stream", color=MSG, dashed=True)
arrow(sse_client["right"], sse_apply["left"], label="live patch", color=MSG)
orth_arrow(sse_apply["top"], render_shell["bottom"], mid_x=1960, label="refresh rows /\nroute view", color=MSG)

# background hydration feedback
orth_arrow(bg_hydrate["left"], render_shell["bottom"], mid_y=LANES["spa"][0] + 305, label="full data\n+ rerender")

# finish
orth_arrow(render_shell["top"], end["left"], mid_y=LANES["user"][0] + 250)
orth_arrow(sse_apply["top"], end["bottom"], mid_x=3020, dashed=True, color=MSG)


# Legend and notes
legend_x = 80
legend_y = HEIGHT - 212
draw.rounded_rectangle((legend_x, legend_y, 1260, HEIGHT - 40), radius=20, fill="#f9f5ec", outline=GRID, width=2)
draw.text((legend_x + 18, legend_y + 12), "Легенда", font=FONT_BOX_BOLD, fill=INK)

draw.ellipse((legend_x + 18, legend_y + 48, legend_x + 58, legend_y + 88), fill=EVENT_FILL, outline=INK, width=3)
draw.text((legend_x + 74, legend_y + 54), "Событие BPMN", font=FONT_SMALL, fill=INK)
draw.rounded_rectangle((legend_x + 280, legend_y + 44, legend_x + 410, legend_y + 92), radius=14, fill=TASK_FILL, outline=INK, width=3)
draw.line((legend_x + 280, legend_y + 44, legend_x + 280, legend_y + 92), fill=TASK_ACCENT, width=8)
draw.text((legend_x + 428, legend_y + 54), "Задача / под-процесс", font=FONT_SMALL, fill=INK)
draw.polygon([(legend_x + 730, legend_y + 42), (legend_x + 780, legend_y + 67), (legend_x + 730, legend_y + 92), (legend_x + 680, legend_y + 67)], fill=GATE_FILL, outline=INK)
draw.text((legend_x + 804, legend_y + 54), "Gateway / решение", font=FONT_SMALL, fill=INK)
draw.rounded_rectangle((legend_x + 18, legend_y + 112, legend_x + 160, legend_y + 162), radius=14, fill=STORE_FILL, outline=INK, width=3)
draw.text((legend_x + 180, legend_y + 123), "Хранилище / данные", font=FONT_SMALL, fill=INK)
arrow((legend_x + 455, legend_y + 137), (legend_x + 560, legend_y + 137), color=INK)
draw.text((legend_x + 580, legend_y + 126), "Сплошная стрелка: control flow", font=FONT_SMALL, fill=INK)
arrow((legend_x + 920, legend_y + 137), (legend_x + 1025, legend_y + 137), color=MSG, dashed=True)
draw.text((legend_x + 1045, legend_y + 126), "Пунктир: message / API / SSE", font=FONT_SMALL, fill=INK)

note(
    2330,
    HEIGHT - 212,
    790,
    150,
    "Детализация диаграммы опирается на:\n"
    "- js/app.99.init.js, js/app.50.auth.js, js/app.00.state.js, js/app.40.store.js, js/app.81.navigation.js\n"
    "- docs/architecture/spa-boot.md\n"
    "- server.js SPA fallback и security/data endpoints\n"
    "Схема агрегирует однотипные route-ветки в общий BPMN-процесс."
)


OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT)
print(OUT)
