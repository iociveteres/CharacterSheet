from pathlib import Path

def is_hidden(path: Path) -> bool:
    return path.name.startswith(".")

def print_tree(path: Path, prefix: str = "") -> None:
    entries = sorted(
        [p for p in path.iterdir() if p.is_dir() and not is_hidden(p)],
        key=lambda p: p.name.lower()
    )

    for i, entry in enumerate(entries):
        last = i == len(entries) - 1
        connector = "└── " if last else "├── "
        print(prefix + connector + entry.name)

        extension = "    " if last else "│   "
        print_tree(entry, prefix + extension)

if __name__ == "__main__":
    root = Path.cwd()
    print(root.name)
    print_tree(root)