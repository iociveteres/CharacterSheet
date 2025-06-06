from pathlib import Path

html_template = '''
{tables}
'''

skills = [
    "Acrobatics", "Athletics", "Awareness", "Charm", "Command", "Commerce", "Deceive",
    "Dodge", "Inquiry", "Interrogation", "Intimidate", "Logic", "Medicae",
    {"Navigate": ["Surface", "Stellar", "Warp"]},
    {"Operate": ["Surface", "Aeronautica", "Void"]},
    "Parry", "Psyniscience", "Scrutiny", "Security", "Sleight of Hand", "Stealth",
    "Survival", "Tech-Use"
]

named_skills = ["Linguistics", "Trade", "Common Lore", "Scholastic Lore", "Forbidden Lore"]
# specify per‑skill counts here; any missing skill uses default_repeat
named_counts = {
    "Linguistics": 5,
    "Trade": 5,
    "Common Lore": 5,
    "Scholastic Lore": 5,
    "Forbidden Lore": 5
    # "Common Lore": uses default_repeat
}
default_repeat = 4

offsets = [0, 10, 20, 30]
select_opts = ["WS", "BS", "S", "T", "A", "P", "I", "W", "F", "Inf", "Cor"]

# improved default map (keys use spaces, lowercase)
default_map = {
    "acrobatics": "A",
    "athletics": "S",
    "awareness": "P",
    "charm": "F",
    "command": "F",
    "commerce": "I",
    "deceive": "I",
    "dodge": "A",
    "inquiry": "F",
    "interrogation": "W",
    "intimidate": "W",
    "logic": "I",
    "medicae": "I",
    "navigate surface": "I",
    "navigate stellar": "I",
    "navigate warp": "I",
    "operate surface": "A",
    "operate aeronautica": "A",
    "operate void": "I",
    "parry": "WS",
    "psyniscience": "P",
    "scrutiny": "P",
    "security": "I",
    "sleight_of_hand": "A",
    "stealth": "A",
    "survival": "P",
    "tech-use": "I",
    "linguistics": "I",
    "trade": "I",
    "common lore": "I",
    "scholastic lore": "I",
    "forbidden lore": "I"
}

def make_select_cell(base_id: str, default: str = None):
    opts = "".join(
        f'<option value="{opt}"{" selected" if opt == default else ""}>{opt}</option>'
        for opt in select_opts
    )
    return f'<td><select data-id="characteristic">{opts}</select></td>'

def make_test_cell(base_id: str):
    return f'<td><input type="text" class="short uneditable" data-id="difficulty" readonly></td>'

def make_checkbox_cells():
    return "".join(
                f'<td><input type="checkbox" data-id="+{off}"></td>'
                for off in offsets
            )

lines = ['<table data-id="skills-first">']
for item in skills:
    if isinstance(item, str):
        key = item.lower()
        base_id = item.replace(" ", "_").lower()
        base = f'{base_id}'
        default = default_map.get(key)
        check_cells = make_checkbox_cells()
        lines.append(
            f'<tr data-id={base}>\n'
            f'    <td>{item}</td>\n'
            f'    {make_select_cell(base, default)}\n'
            f'    {check_cells}\n'
            f'    {make_test_cell(base)}\n'
            "</tr>"
        )
    else:
        parent, subs = next(iter(item.items()))
        lines.append(f"<tr>\n    <td>{parent}</td>\n</tr>")
        for sub in subs:
            lookup = f"{parent} {sub}".lower()
            base_key = f"{parent}_{sub}".replace(" ", "_").lower()
            base = f'{base_key}'
            default = default_map.get(lookup)
            check_cells = make_checkbox_cells()
            lines.append(
                f'<tr class="subskill" data-id="{base}">\n'
                f'    <td>{sub}</td>\n'
                f'    {make_select_cell(base, default)}\n'
                f'    {check_cells}\n'
                f'    {make_test_cell(base)}\n'
                "</tr>"
            )
lines.append("</table>")

lines.append('<table data-id="skills-second">')
for skill in named_skills:
    count = named_counts.get(skill, default_repeat)
    key = skill.lower()
    base_skill = skill.replace(" ", "_").lower()
    default = default_map.get(key)
    lines.append(f"<tr><td>{skill}</td></tr>")
    for i in range(1, count + 1):
        base = f'{i}_{base_skill}'
        name_cell   = f'<td><input data-id="name"></td>'
        select_cell = make_select_cell(base, default)
        check_cells = make_checkbox_cells()
        test_cell   = make_test_cell(base)
        lines.append(
            f'<tr data-id="{base}">\n'
            f"    {name_cell}\n"
            f"    {select_cell}\n"
            f"    {check_cells}\n"
            f"    {test_cell}\n"
            "</tr>"
        )
lines.append("</table>")

tables_html = "\n".join(lines)
final_html = html_template.format(tables=tables_html)

out = Path("./_python/skills.html")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(final_html, encoding="utf-8")
print(f"HTML file '{out.name}' generated.")
