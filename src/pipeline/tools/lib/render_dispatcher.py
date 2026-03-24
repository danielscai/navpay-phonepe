#!/usr/bin/env python3
import sys

TEMPLATE_TOKEN = "##MODULE_CALLS##"

def render_block(index: int, entry: str) -> str:
    return """
    :try_start_{i}
    invoke-static {{p0}}, {entry}
    :try_end_{i}
    goto :after_{i}
    .catch Ljava/lang/Throwable; {{:try_start_{i} .. :try_end_{i}}} :catch_{i}
    :catch_{i}
    move-exception v0
    :after_{i}
""".format(i=index, entry=entry)


def main():
    if len(sys.argv) < 4:
        print("Usage: render_dispatcher.py <template> <output> <entry1> [entry2 ...]")
        return 1

    template_path = sys.argv[1]
    output_path = sys.argv[2]
    entries = sys.argv[3:]

    with open(template_path, "r", encoding="utf-8") as f:
        template = f.read()

    blocks = "".join(render_block(i, entry) for i, entry in enumerate(entries))

    if TEMPLATE_TOKEN not in template:
        print("Template token not found")
        return 2

    rendered = template.replace(TEMPLATE_TOKEN, blocks.rstrip())

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(rendered)

    return 0


if __name__ == "__main__":
    sys.exit(main())
