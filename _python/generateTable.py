html_template = '''<div class="skill-list">
{tables}
</div>
'''

skills = [
    "Acrobatics", "Athletics", "Awareness", "Charm", "Command", "Commerce", "Deceive",
    "Dodge", "Inquiry", "Interrogation", "Intimidate", "Logic", "Medicae",
    {"Navigate": ["Surface", "Stellar", "Warp"]},
    {"Operate": ["Surface", "Aeronautica", "Void"]},
    "Parry", "Psyniscience", "Scrutiny", "Security", "Sleight of Hand", "Stealth",
    "Survival", "Tech-Use"
]

table1 = ['<table>']

def make_row(skill_name):
    row = f'        <tr>\n            <td>{skill_name}</td>'
    for i in range(0, 40, 10):
        row += f'\n<td><input type="checkbox" data-id="attr_{skill_name.replace(" ", "_")}{i}" value="10"></td>'
    row += '\n</tr>'
    return row

for item in skills:
    if isinstance(item, str):
        table1.append(make_row(item))
    elif isinstance(item, dict):
        for parent, subskills in item.items():
            table1.append(f'<tr>\n<td>{parent}</td>\n</tr>')
            for sub in subskills:
                table1.append(f'<tr class="subskill">\n<td>{sub}</td>')
                for i in range(0, 40, 10):
                    data_id = f'attr_{parent}{sub}{i}'.replace(" ", "_")
                    table1.append(f'<td><input type="checkbox" data-id="{data_id}" value="10"></td>')
                table1.append('</tr>')

table1.append('</table>')

# Named skill rows (table 2)
def make_named_rows(skill, repeat):
    rows = [f'    <tr><td>{skill}</td></tr>']
    for i in range(1, repeat + 1):
        rows.append(f'''    <tr>
        <td><input data-id="attr_{i}_{skill}_name"></td>
        <td><input type="checkbox" data-id="attr_{i}_{skill}_0" value="10"></td>
        <td><input type="checkbox" data-id="attr_{i}_{skill}_10" value="10"></td>
        <td><input type="checkbox" data-id="attr_{i}_{skill}_20" value="10"></td>
        <td><input type="checkbox" data-id="attr_{i}_{skill}_30" value="10"></td>
    </tr>''')
    return rows

named_skills = ["Linguistics", "Trade", "Common Lore", "Scholastic Lore", "Forbidden Lore"]
table2 = ['<table>']
for skill in named_skills:
    table2.extend(make_named_rows(skill, 4))
table2.append('</table>')

# Combine both tables into a single list of lines
all_tables = table1 + table2

# Join that list into one big string
tables_html = '\n'.join(all_tables)

# Plug into your template
final_html = html_template.format(tables=tables_html)

# Write it out
with open("./_python/skills.html", "w", encoding="utf-8") as f:
    f.write(final_html)

print("HTML file 'skills.html' generated.")
